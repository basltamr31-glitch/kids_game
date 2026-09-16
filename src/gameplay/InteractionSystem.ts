import { Raycaster, Vector2, Vector3, Plane, type Object3D } from 'three';
import type { GameContext } from '../core/GameContext';
import type { Player } from './Player';
import type { CameraRig } from './CameraRig';
import type { ActivitySystem } from './ActivitySystem';
import type { DayDirector } from './DayDirector';
import type { BuiltWorld } from '../world/WorldBuilder';
import type { AnimalAgent } from '../animals/AnimalAgent';
import type { FamilyAgent } from '../characters/FamilyAgent';
import type { ActivityDefinition } from '../content/Types';
import type { TapEvent } from './InputManager';

/**
 * Turns taps into intentions.
 *
 * A tap resolves, in priority order, to:
 *   1. The activity prompt currently floating over something nearby.
 *   2. An animal or parent -> a friendly greeting (always available, always
 *      free, no task needed — children pet the cow because they want to).
 *   3. A point on the ground -> walk there.
 *
 * The floating prompt is the game's entire tutorial: walk near a thing, a big
 * icon appears over it, tap it. Nothing is ever explained in words.
 */

export interface WorldPrompt {
  activity: ActivityDefinition;
  /** World position for the bubble. */
  position: Vector3;
  /** Distance from the child, for sorting. */
  distance: number;
}

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);
const PROMPT_RADIUS = 5.0;

export class InteractionSystem {
  /** The prompt currently offered, or null. Read by the HUD each frame. */
  activePrompt: WorldPrompt | null = null;

  private ctx: GameContext;
  private player: Player;
  private cameraRig: CameraRig;
  private activities: ActivitySystem;
  private director: DayDirector;
  private world: BuiltWorld;
  private animals: Map<string, AnimalAgent>;
  private parents: Map<string, FamilyAgent>;

  private raycaster = new Raycaster();
  private pickables: Object3D[] = [];
  private lastOfferedId: string | null = null;

  constructor(
    ctx: GameContext,
    refs: {
      player: Player;
      cameraRig: CameraRig;
      activities: ActivitySystem;
      director: DayDirector;
      world: BuiltWorld;
      animals: Map<string, AnimalAgent>;
      parents: Map<string, FamilyAgent>;
    },
  ) {
    this.ctx = ctx;
    this.player = refs.player;
    this.cameraRig = refs.cameraRig;
    this.activities = refs.activities;
    this.director = refs.director;
    this.world = refs.world;
    this.animals = refs.animals;
    this.parents = refs.parents;

    this.refreshPickables();
  }

  /** Rebuilt whenever an animal or parent is added or removed. */
  refreshPickables(): void {
    this.pickables = [
      ...[...this.animals.values()].map((a) => a.object),
      ...[...this.parents.values()].map((p) => p.group),
    ];
  }

  handleTap(tap: TapEvent): void {
    if (this.activities.isRunning) return;

    // 1. The offered activity wins — it is what the big bubble is pointing at.
    if (this.activePrompt && this.isTapNearPrompt(tap)) {
      this.tryStart(this.activePrompt.activity);
      return;
    }

    this.raycaster.setFromCamera(tap.ndc, this.cameraRig.camera);

    // 2. A character. Greeting is never gated on anything.
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    if (hits.length > 0) {
      const root = findTaggedRoot(hits[0].object);
      if (root) {
        this.greet(root);
        return;
      }
    }

    // 3. Ground. Project the ray onto the plane, then snap to the terrain.
    const point = new Vector3();
    if (this.raycaster.ray.intersectPlane(GROUND_PLANE, point)) {
      const destination = this.player.findWalkablePoint(point);
      this.player.walkTo(destination);
      this.ctx.audio.play('tap', 0.9);
      this.ctx.platform.haptic('light');
    }
  }

  /** Called every frame; decides which prompt to float. */
  update(): void {
    if (this.activities.isRunning) {
      this.activePrompt = null;
      return;
    }

    const childPosition = this.player.position;
    const completed = this.ctx.save.save.completedToday;
    let best: WorldPrompt | null = null;

    for (const activity of this.director.remainingToday) {
      const position = this.anchorPosition(activity.anchor);
      if (!position) continue;

      const distance = childPosition.distanceTo(position);
      if (distance > PROMPT_RADIUS) continue;
      if (this.activities.blockedReason(activity, completed)) continue;

      if (!best || distance < best.distance) {
        best = { activity, position, distance };
      }
    }

    // Also offer the *next* task's anchor at a wider radius so a child heading
    // in roughly the right direction still gets a hint.
    if (!best) {
      const next = this.director.remainingToday[0];
      if (next) {
        const position = this.anchorPosition(next.anchor);
        if (position && childPosition.distanceTo(position) < PROMPT_RADIUS * 1.6) {
          if (!this.activities.blockedReason(next, completed)) {
            best = { activity: next, position, distance: childPosition.distanceTo(position) };
          }
        }
      }
    }

    this.activePrompt = best;

    if (best && best.activity.id !== this.lastOfferedId) {
      this.lastOfferedId = best.activity.id;
      this.ctx.bus.emit('activity:offered', { activityId: best.activity.id });
    } else if (!best) {
      this.lastOfferedId = null;
    }
  }

  /** Where an activity's anchor currently is (animals and people move). */
  anchorPosition(anchorId: string): Vector3 | null {
    // The child is an anchor too: activity emotes float above their own head.
    if (anchorId === 'child') return this.player.position;

    const animal = this.animals.get(anchorId);
    if (animal) return animal.position;

    const parent = this.parents.get(anchorId);
    if (parent) return parent.position;

    const anchor = this.world.anchors.get(anchorId);
    return anchor ? anchor.position : null;
  }

  /** Bubble height for the current prompt. */
  promptHeight(anchorId: string): number {
    const animal = this.animals.get(anchorId);
    if (animal) return animal.definition.kind === 'cow' ? 2.2 : 1.3;
    const parent = this.parents.get(anchorId);
    if (parent) return parent.rig.height * 1.05;
    return this.world.anchors.get(anchorId)?.bubbleHeight ?? 1.7;
  }

  /** Starts an activity from the HUD task list or the world bubble. */
  tryStart(activity: ActivityDefinition): boolean {
    const blocked = this.activities.blockedReason(activity, this.ctx.save.save.completedToday);
    if (blocked) {
      // Always gentle: a soft sound and a friendly line, never a red X.
      this.ctx.audio.play('error');
      this.ctx.bus.emit('ui:toast', { textKey: blocked, icon: '🙂' });
      return false;
    }

    this.ctx.audio.play('confirm');
    this.ctx.platform.haptic('medium');
    this.activePrompt = null;
    return this.activities.start(activity.id);
  }

  private greet(target: { kind: 'animal' | 'parent'; id: string }): void {
    if (target.kind === 'animal') {
      const animal = this.animals.get(target.id);
      if (!animal) return;
      // Walk over, then react — tapping a distant cow should not teleport a moo.
      const distance = this.player.position.distanceTo(animal.position);
      if (distance > 2.6) {
        const approach = new Vector3()
          .subVectors(this.player.position, animal.position)
          .setY(0)
          .normalize()
          .multiplyScalar(1.6)
          .add(animal.position);
        this.player.walkTo(approach);
        this.player.onArrive = () => this.petAnimal(target.id);
      } else {
        this.petAnimal(target.id);
      }
      return;
    }

    const parent = this.parents.get(target.id);
    if (!parent) return;
    parent.greet();
    this.player.faceToward(parent.position);
    this.player.setExpression('happy');
    this.ctx.audio.playVoice('hello', true);
    this.ctx.bus.emit('ui:speech', {
      actor: target.id,
      textKey: this.ctx.loc.tVariant(
        target.id === 'mother' ? 'speech.mother.thanks' : 'speech.father.thanks',
        this.ctx.save.save.day,
      ),
      duration: 2.4,
    });
  }

  private petAnimal(animalId: string): void {
    const animal = this.animals.get(animalId);
    if (!animal) return;

    this.player.faceToward(animal.position);
    this.player.playClip('crouchPet');
    this.player.setExpression('happy');
    animal.react('happy');

    this.ctx.audio.playAnimal(animal.definition.voice.kind, animal.definition.voice.base);
    this.ctx.audio.playVoice('happy', false);
    this.ctx.platform.haptic('light');
    this.ctx.bus.emit('emote', { actor: animal.id, emote: '💗' });

    // Petting an animal for the first time each day is worth a heart. This is
    // the one reward in the game that exists purely for affection.
    if (!animal.state.petToday) {
      animal.state.petToday = true;
      this.ctx.save.update((data) => {
        data.hearts += 1;
        if (!data.stickers.includes('animalfriend')) data.stickers.push('animalfriend');
      });
      this.ctx.bus.emit('ui:toast', {
        textKey: 'toast.fed',
        icon: '💗',
        params: { name: this.ctx.loc.t(animal.definition.nameKey) },
      });
      this.ctx.audio.play('heart');
    }
  }

  private isTapNearPrompt(tap: TapEvent): boolean {
    if (!this.activePrompt) return false;
    // Project the bubble to screen space and accept a generous radius. Small
    // fingers miss; a 90px target is the minimum that feels fair.
    const world = this.activePrompt.position.clone();
    world.y += this.promptHeight(this.activePrompt.activity.anchor);
    world.project(this.cameraRig.camera);

    const screen = new Vector2(world.x, world.y);
    return screen.distanceTo(tap.ndc) < 0.22;
  }
}

/**
 * Walks up from a raycast hit to the object we tagged with an interaction id.
 * Meshes deep inside a rig do not know what they belong to.
 */
function findTaggedRoot(object: Object3D): { kind: 'animal' | 'parent'; id: string } | null {
  let node: Object3D | null = object;
  while (node) {
    const tag = node.userData as { interactKind?: 'animal' | 'parent'; interactId?: string };
    if (tag.interactKind && tag.interactId) {
      return { kind: tag.interactKind, id: tag.interactId };
    }
    node = node.parent;
  }
  return null;
}
