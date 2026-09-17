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
import type { InteractionRunner } from './interact/InteractionRunner';
import {
  VERB_ICON,
  VERB_KEY,
  type Interactable,
  type InteractVerb,
  type InteractableRegistry,
} from './interact/Interactable';

/**
 * Turns taps into intentions.
 *
 * Two sources of things to do, in priority order:
 *
 *   1. PHYSICAL INTERACTABLES - the plate on the counter, the chair, the door.
 *      These are the primary way the child acts on the world, and they always
 *      win when one is in reach, because they are what the player is looking
 *      at.
 *   2. SCHEDULED ACTIVITIES   - today's chores. These are the guided path: one
 *      tap plays a whole chain of the same physical operations.
 *
 * A tap that hits neither walks the child to the tapped point.
 *
 * There is no menu anywhere in this file, and that is deliberate.
 */

export interface WorldPrompt {
  /** World position for the bubble. */
  position: Vector3;
  bubbleHeight: number;
  icon: string;
  /** Localization key for the label under the bubble. */
  labelKey: string;
  distance: number;
  source: 'interactable' | 'activity';
  interactable?: Interactable;
  activity?: ActivityDefinition;
}

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);
/** How far the child can be from an object and still be offered it. */
const INTERACT_RADIUS = 2.6;
const ACTIVITY_RADIUS = 5.0;

export class InteractionSystem {
  activePrompt: WorldPrompt | null = null;

  private ctx: GameContext;
  private player: Player;
  private cameraRig: CameraRig;
  private activities: ActivitySystem;
  private director: DayDirector;
  private world: BuiltWorld;
  private animals: Map<string, AnimalAgent>;
  private parents: Map<string, FamilyAgent>;
  private registry: InteractableRegistry;
  private runner: InteractionRunner;

  private raycaster = new Raycaster();
  private pickables: Object3D[] = [];
  private lastOfferedId: string | null = null;
  private facing = new Vector3(0, 0, 1);

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
      registry: InteractableRegistry;
      runner: InteractionRunner;
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
    this.registry = refs.registry;
    this.runner = refs.runner;

    this.refreshPickables();
  }

  refreshPickables(): void {
    this.pickables = [
      ...[...this.animals.values()].map((a) => a.object),
      ...[...this.parents.values()].map((p) => p.group),
    ];
  }

  get isBusy(): boolean {
    return this.activities.isRunning || this.runner.isRunning;
  }

  /* ------------------------------------------------------------------ */
  /* Per-frame                                                           */
  /* ------------------------------------------------------------------ */

  update(): void {
    if (this.isBusy) {
      this.activePrompt = null;
      return;
    }

    const position = this.player.position;
    this.facing.set(
      Math.sin(this.player.group.rotation.y),
      0,
      Math.cos(this.player.group.rotation.y),
    );

    /* --- 1. physical interactables --- */
    const hit = this.registry.findNearest(position, this.facing, INTERACT_RADIUS);
    if (hit) {
      const world = hit.interactable.node.getWorldPosition(new Vector3());
      this.activePrompt = {
        position: world,
        bubbleHeight: hit.interactable.bubbleHeight,
        icon: VERB_ICON[hit.verb],
        labelKey: hit.interactable.labelKey?.() ?? VERB_KEY[hit.verb],
        distance: hit.distance,
        source: 'interactable',
        interactable: hit.interactable,
      };
      this.announce(hit.interactable.id);
      return;
    }

    /* --- 2. today's activities --- */
    const completed = this.ctx.save.save.completedToday;
    let best: WorldPrompt | null = null;

    for (const activity of this.director.remainingToday) {
      const point = this.anchorPosition(activity.anchor);
      if (!point) continue;
      const distance = position.distanceTo(point);
      if (distance > ACTIVITY_RADIUS) continue;
      if (this.activities.blockedReason(activity, completed)) continue;
      if (!best || distance < best.distance) {
        best = {
          position: point.clone(),
          bubbleHeight: this.promptHeight(activity.anchor),
          icon: activity.icon,
          labelKey: activity.titleKey,
          distance,
          source: 'activity',
          activity,
        };
      }
    }

    this.activePrompt = best;
    this.announce(best?.activity?.id ?? null);
  }

  private announce(id: string | null): void {
    if (id && id !== this.lastOfferedId) {
      this.lastOfferedId = id;
      this.ctx.bus.emit('activity:offered', { activityId: id });
    } else if (!id) {
      this.lastOfferedId = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tap handling                                                        */
  /* ------------------------------------------------------------------ */

  handleTap(tap: TapEvent): void {
    if (this.isBusy) return;

    // 1. The floating bubble. Generous hit area — small fingers miss.
    if (this.activePrompt && this.isTapNearPrompt(tap)) {
      this.runPrompt(this.activePrompt);
      return;
    }

    this.raycaster.setFromCamera(tap.ndc, this.cameraRig.camera);

    // 2. Tapping an interactable directly, even from across the room: the
    //    child walks over and does it. This is how a four-year-old expects a
    //    touchscreen to work.
    const interactHits = this.raycaster.intersectObjects(this.registry.pickables, true);
    if (interactHits.length > 0) {
      const found = this.findInteractable(interactHits[0].object);
      if (found && found.verb()) {
        this.run(found);
        return;
      }
    }

    // 3. A character. Greeting is never gated on anything.
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    if (hits.length > 0) {
      const root = findTaggedRoot(hits[0].object);
      if (root) {
        this.greet(root);
        return;
      }
    }

    // 4. Ground: walk there.
    const point = new Vector3();
    if (this.raycaster.ray.intersectPlane(GROUND_PLANE, point)) {
      if (this.player.isSeated) this.runner.forceStand();
      const destination = this.player.findWalkablePoint(point);
      this.player.walkTo(destination);
      this.ctx.audio.play('tap', 0.9);
      this.ctx.platform.haptic('light');
    }
  }

  private runPrompt(prompt: WorldPrompt): void {
    if (prompt.source === 'interactable' && prompt.interactable) {
      this.run(prompt.interactable);
    } else if (prompt.activity) {
      this.tryStart(prompt.activity);
    }
  }

  /** Plays an interactable's physical sequence. */
  run(interactable: Interactable): void {
    const verb = interactable.verb();
    if (!verb) return;
    this.ctx.audio.play('confirm');
    this.ctx.platform.haptic('medium');
    this.activePrompt = null;
    this.runner.play(interactable.run());
  }

  /** Starts a scheduled activity. */
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
    if (this.player.isSeated) this.runner.forceStand();
    return this.activities.start(activity.id);
  }

  /* ------------------------------------------------------------------ */
  /* Lookups                                                             */
  /* ------------------------------------------------------------------ */

  /** Where an activity's anchor currently is. Animals and people move. */
  anchorPosition(anchorId: string): Vector3 | null {
    if (anchorId === 'child') return this.player.position;

    const animal = this.animals.get(anchorId);
    if (animal) return animal.position;

    const parent = this.parents.get(anchorId);
    if (parent) return parent.position;

    const interactable = this.registry.get(anchorId);
    if (interactable) return interactable.node.getWorldPosition(new Vector3());

    const anchor = this.world.anchors.get(anchorId);
    return anchor ? anchor.position : null;
  }

  promptHeight(anchorId: string): number {
    const animal = this.animals.get(anchorId);
    if (animal) return animal.definition.kind === 'cow' ? 2.2 : 1.3;
    const parent = this.parents.get(anchorId);
    if (parent) return parent.rig.height * 1.05;
    const interactable = this.registry.get(anchorId);
    if (interactable) return interactable.bubbleHeight;
    return this.world.anchors.get(anchorId)?.bubbleHeight ?? 1.7;
  }

  private findInteractable(object: Object3D): Interactable | null {
    let node: Object3D | null = object;
    while (node) {
      for (const item of this.registry.all) {
        if (item.node === node) return item;
      }
      node = node.parent;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Greetings                                                           */
  /* ------------------------------------------------------------------ */

  private greet(target: { kind: 'animal' | 'parent'; id: string }): void {
    if (this.player.isSeated) this.runner.forceStand();

    if (target.kind === 'animal') {
      const animal = this.animals.get(target.id);
      if (!animal) return;
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
    this.player.setExpression('laugh');
    animal.react('happy');

    this.ctx.audio.playAnimal(animal.definition.voice.kind, animal.definition.voice.base);
    this.ctx.audio.playVoice('laugh', false);
    this.ctx.platform.haptic('light');
    this.ctx.bus.emit('emote', { actor: animal.id, emote: '💗' });

    // The first pet of the day is worth a heart. This is the one reward in the
    // game that exists purely for affection.
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
    const world = this.activePrompt.position.clone();
    world.y += this.activePrompt.bubbleHeight;
    world.project(this.cameraRig.camera);
    const screen = new Vector2(world.x, world.y);
    return screen.distanceTo(tap.ndc) < 0.22;
  }

  /** Exposed so the HUD can offer the same verbs in its task list. */
  get verbIcon(): typeof VERB_ICON {
    return VERB_ICON;
  }
}

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

export type { InteractVerb };
