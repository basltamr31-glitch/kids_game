import { Group, Object3D, Vector3 } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { M } from '../art/Materials';
import {
  Socket,
  type Interactable,
  type InteractStep,
  type InteractVerb,
  type InteractableRegistry,
  type Prop,
} from '../gameplay/interact/Interactable';
import { makeProp } from '../gameplay/interact/PropFactory';
import type { AnimalAgent } from '../animals/AnimalAgent';
import { LAYOUT } from './WorldBuilder';
import type { Terrain } from './Terrain';

/**
 * The farm as a place the child works in.
 *
 * Same principle as the house: no "tap cow, milk appears". Milking means
 * fetching the bucket from the well, walking it to Bella, crouching beside her
 * for a while, and carrying a heavier, fuller bucket back. Feeding means
 * picking up an armful of hay and putting it in front of an animal that then
 * walks over and eats it.
 *
 * Because every step is a real operation on a real object, a four-year-old can
 * also do them out of order, or just carry the bucket around, and nothing
 * breaks.
 */

/**
 * Names of the physical routines this module registers.
 *
 * Declared separately from the implementation so content validation can check
 * that every `routine` step in an activity resolves, without having to build
 * a WebGL scene to find out.
 */
export const FARM_ROUTINE_IDS = [
  'feedcow',
  'feedsheep',
  'feedchickens',
  'milkcow',
  'collecteggs',
  'watercow',
] as const;

export interface FarmState {
  group: Group;
  /** Physical routines the scheduled activities hand off to. */
  routines: Record<string, () => InteractStep[]>;
}

function worldOf(node: Object3D, out = new Vector3()): Vector3 {
  return node.getWorldPosition(out);
}

/** A point `distance` metres from `node`, on the side the child is coming from. */
function approach(node: Object3D, from: Vector3, distance: number): Vector3 {
  const target = worldOf(node, new Vector3());
  const dir = new Vector3().subVectors(from, target).setY(0);
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
  return dir.normalize().multiplyScalar(distance).add(target);
}

interface MakeOptions {
  id: string;
  node: Object3D;
  area: string;
  bubbleHeight?: number;
  verb: () => InteractVerb | null;
  run: () => InteractStep[];
  labelKey?: () => string;
}

function make(o: MakeOptions): Interactable {
  return {
    id: o.id,
    node: o.node,
    standAt: worldOf(o.node, new Vector3()),
    bubbleHeight: o.bubbleHeight ?? 1.0,
    area: o.area,
    enabled: true,
    verb: o.verb,
    run: o.run,
    labelKey: o.labelKey,
  };
}

export function buildFarmInteractions(
  registry: InteractableRegistry,
  animals: Map<string, AnimalAgent>,
  terrain: Terrain,
  getCarried: () => Prop | null,
  getPlayerPosition: () => Vector3,
  onProduce: (item: string, count: number) => void,
): FarmState {
  const group = new Group();
  group.name = 'farm-interactives';

  const ground = (x: number, z: number): number => terrain.heightAt(x, z);

  /* ---------------- stations ---------------- */

  /** A named empty at a world position, used as an interactable's anchor. */
  const station = (name: string, x: number, y: number, z: number): Object3D => {
    const node = new Object3D();
    node.name = name;
    node.position.set(x, y, z);
    group.add(node);
    return node;
  };

  const hayStation = station('hay-station', LAYOUT.haystack.x - 2.0,
    ground(LAYOUT.haystack.x - 2.0, LAYOUT.haystack.z) + 1.0, LAYOUT.haystack.z);
  const grainStation = station('grain-station', LAYOUT.coop.x - 2.4,
    ground(LAYOUT.coop.x - 2.4, LAYOUT.coop.z + 1.6) + 0.4, LAYOUT.coop.z + 1.6);
  const wellStation = station('well-station', LAYOUT.well.x,
    ground(LAYOUT.well.x, LAYOUT.well.z) + 1.2, LAYOUT.well.z);
  const troughStation = station('trough-station', LAYOUT.trough.x,
    ground(LAYOUT.trough.x, LAYOUT.trough.z) + 0.7, LAYOUT.trough.z);

  /* ---------------- the grain sack, as a real object ---------------- */
  const sack = new PartBuilder();
  sack.lathe(
    [[0, 0], [0.26, 0.02], [0.28, 0.32], [0.2, 0.5], [0.1, 0.56], [0.12, 0.6], [0, 0.6]],
    'hayDark', {}, 12,
  );
  sack.torus(0.11, 0.022, 'trunk', { pos: [0, 0.56, 0], rot: [Math.PI / 2, 0, 0] }, 10);
  for (let i = 0; i < 8; i++) {
    sack.sphere(0.028, 'hay', {
      pos: [(i % 4) * 0.07 - 0.1, 0.04, Math.floor(i / 4) * 0.08 + 0.26],
    }, 5);
  }
  const sackMesh = sack.toMesh('grain-sack', M.built('organic', 3.0), { groundY: 0 });
  sackMesh.position.set(grainStation.position.x, ground(grainStation.position.x, grainStation.position.z), grainStation.position.z);
  group.add(sackMesh);

  /* ---------------- egg basket at the coop ---------------- */
  const basketNode = station('egg-basket', LAYOUT.coop.x + 3.2,
    ground(LAYOUT.coop.x + 3.2, LAYOUT.coop.z - 1.4) + 0.06, LAYOUT.coop.z - 1.4);
  const basketSocket = registry.addSocket(new Socket('coop.basket', basketNode, ['basket']));
  basketSocket.put(makeProp('basket'));

  /* ---------------- take hay ---------------- */
  registry.add(
    make({
      id: 'farm.hay',
      node: hayStation,
      area: 'farmyard',
      bubbleHeight: 0.8,
      labelKey: () => 'interact.takehay',
      verb: () => (getCarried() ? null : 'take'),
      run: () => {
        const hay = makeProp('hay');
        hay.object.position.copy(worldOf(hayStation));
        group.add(hay.object);
        return [
          { kind: 'walkTo', point: approach(hayStation, getPlayerPosition(), 1.3), face: worldOf(hayStation) },
          { kind: 'takeProp', prop: hay },
          { kind: 'expression', value: 'happy' },
        ];
      },
    }),
  );

  /* ---------------- take grain ---------------- */
  registry.add(
    make({
      id: 'farm.grain',
      node: grainStation,
      area: 'coop',
      bubbleHeight: 0.8,
      labelKey: () => 'interact.takegrain',
      verb: () => (getCarried() ? null : 'take'),
      run: () => {
        const grain = makeProp('grain');
        grain.object.position.copy(worldOf(grainStation));
        group.add(grain.object);
        return [
          { kind: 'walkTo', point: approach(grainStation, getPlayerPosition(), 1.2), face: worldOf(grainStation) },
          { kind: 'animate', clip: 'pickUpLow', duration: 1.2 },
          { kind: 'takeProp', prop: grain },
          { kind: 'expression', value: 'happy' },
        ];
      },
    }),
  );

  /* ---------------- take / fill the bucket at the well ---------------- */
  registry.add(
    make({
      id: 'farm.bucket',
      node: wellStation,
      area: 'farmyard',
      bubbleHeight: 1.4,
      labelKey: () => 'interact.takebucket',
      verb: () => {
        const carried = getCarried();
        if (!carried) return 'take';
        // Carrying a full bucket to the well empties it back out.
        return carried.kind === 'bucketFull' ? 'pour' : null;
      },
      run: () => {
        const carried = getCarried();
        if (carried && carried.kind === 'bucketFull') {
          return [
            { kind: 'walkTo', point: approach(wellStation, getPlayerPosition(), 1.6), face: worldOf(wellStation) },
            { kind: 'animate', clip: 'pour', duration: 1.8, sound: 'pour' },
            { kind: 'consumeProp', prop: carried },
            { kind: 'call', fn: () => {} },
          ];
        }
        const bucket = makeProp('bucket');
        bucket.object.position.copy(worldOf(wellStation));
        group.add(bucket.object);
        return [
          { kind: 'walkTo', point: approach(wellStation, getPlayerPosition(), 1.6), face: worldOf(wellStation) },
          { kind: 'animate', clip: 'reach', duration: 0.9 },
          { kind: 'takeProp', prop: bucket },
          { kind: 'expression', value: 'happy' },
        ];
      },
    }),
  );

  /* ---------------- fill the trough ---------------- */
  registry.add(
    make({
      id: 'farm.trough',
      node: troughStation,
      area: 'pasture',
      bubbleHeight: 0.8,
      labelKey: () => 'interact.filltrough',
      verb: () => {
        const carried = getCarried();
        return carried && carried.kind === 'bucketFull' ? 'pour' : null;
      },
      run: () => {
        const carried = getCarried()!;
        return [
          { kind: 'walkTo', point: approach(troughStation, getPlayerPosition(), 1.3), face: worldOf(troughStation) },
          { kind: 'animate', clip: 'pour', duration: 2.2, sound: 'pour' },
          { kind: 'consumeProp', prop: carried },
          { kind: 'call', fn: () => { for (const a of animals.values()) a.state.watered = 1; } },
          { kind: 'expression', value: 'happy' },
          { kind: 'emote', emoji: '💧', duration: 1.2 },
          { kind: 'reward', hearts: 2 },
        ];
      },
    }),
  );

  /* ---------------- per-animal interactions ---------------- */
  for (const animal of animals.values()) {
    const kind = animal.definition.kind;
    const feedItem = animal.definition.eats === 'grain' ? 'grain' : 'hay';

    /* --- feed --- */
    registry.add(
      make({
        id: `farm.feed.${animal.id}`,
        node: animal.object,
        area: animal.definition.area,
        bubbleHeight: kind === 'cow' ? 2.0 : kind === 'sheep' ? 1.2 : 0.7,
        labelKey: () => 'interact.feedanimal',
        verb: () => {
          const carried = getCarried();
          if (!carried || carried.kind !== feedItem) return null;
          return 'feed';
        },
        run: () => {
          const food = getCarried()!;
          // The food is set down in front of the animal, which then comes to
          // eat it. The child does not hand-feed a cow; nobody does.
          const dropPoint = new Vector3();
          return [
            { kind: 'walkTo', point: approach(animal.object, getPlayerPosition(), 1.7), face: animal.position },
            { kind: 'animate', clip: 'place', duration: 1.2 },
            { kind: 'call', fn: () => {
              dropPoint.copy(animal.position);
              food.object.removeFromParent();
              group.add(food.object);
              food.object.position.set(
                dropPoint.x + Math.sin(animal.object.rotation.y) * 1.1,
                terrain.heightAt(dropPoint.x, dropPoint.z),
                dropPoint.z + Math.cos(animal.object.rotation.y) * 1.1,
              );
              food.object.quaternion.identity();
              animal.state.fed = 1;
              animal.beginEating(food.object.position.clone(), () => {
                food.object.removeFromParent();
              });
            } },
            { kind: 'call', fn: () => { /* hands are free again */ } },
            { kind: 'expression', value: 'delighted' },
            { kind: 'emote', emoji: '💛', duration: 1.4 },
            { kind: 'reward', hearts: 2 },
          ];
        },
      }),
    );

    /* --- milk --- */
    if (kind === 'cow') {
      registry.add(
        make({
          id: `farm.milk.${animal.id}`,
          node: animal.object,
          area: animal.definition.area,
          bubbleHeight: 2.0,
          labelKey: () => 'interact.milkcow',
          verb: () => {
            const carried = getCarried();
            if (!carried || carried.kind !== 'bucket') return null;
            return animal.state.milkReady ? 'milk' : null;
          },
          run: () => {
            const bucket = getCarried()!;
            // The full bucket is created up front but hidden, so the sequence
            // can reference it in a normal takeProp step. It appears on the
            // ground beside the cow at the moment milking finishes.
            const full = makeProp('bucketFull');
            full.object.visible = false;
            group.add(full.object);

            return [
              { kind: 'walkTo', point: approach(animal.object, getPlayerPosition(), 1.4), face: animal.position },
              { kind: 'animate', clip: 'place', duration: 0.9 },
              { kind: 'consumeProp', prop: bucket },
              { kind: 'animate', clip: 'milk', duration: 4.2, sound: 'milk' },
              { kind: 'call', fn: () => {
                animal.state.milkReady = false;
                animal.react('happy');
                full.object.visible = true;
                full.object.position.set(
                  animal.position.x,
                  terrain.heightAt(animal.position.x, animal.position.z),
                  animal.position.z,
                );
              } },
              { kind: 'takeProp', prop: full, duration: 0.9 },
              { kind: 'expression', value: 'delighted' },
              { kind: 'emote', emoji: '🥛', duration: 1.4 },
              { kind: 'reward', hearts: 3, item: 'milk', count: 1 },
            ];
          },
        }),
      );
    }

    /* --- pet --- */
    registry.add(
      make({
        id: `farm.pet.${animal.id}`,
        node: animal.object,
        area: animal.definition.area,
        bubbleHeight: kind === 'cow' ? 2.0 : kind === 'sheep' ? 1.2 : 0.7,
        labelKey: () => 'interact.petanimal',
        verb: () => (getCarried() ? null : 'pet'),
        run: () => [
          { kind: 'walkTo', point: approach(animal.object, getPlayerPosition(), 1.3), face: animal.position },
          { kind: 'animate', clip: 'crouchPet', duration: 2.6 },
          { kind: 'call', fn: () => animal.react('happy') },
          { kind: 'expression', value: 'laugh' },
          { kind: 'emote', emoji: '💗', duration: 1.6 },
          { kind: 'reward', hearts: animal.state.petToday ? 0 : 1 },
          { kind: 'call', fn: () => { animal.state.petToday = true; } },
        ],
      }),
    );
  }

  /* ---------------- collect eggs ---------------- */
  registry.add(
    make({
      id: 'farm.eggs',
      node: basketNode,
      area: 'coop',
      bubbleHeight: 0.5,
      labelKey: () => 'interact.collecteggs',
      verb: () => {
        const carried = getCarried();
        if (carried) return carried.kind === 'basket' ? 'place' : null;
        if (basketSocket.isEmpty) return null;
        const eggs = [...animals.values()]
          .filter((a) => a.definition.kind === 'chicken')
          .reduce((sum, a) => sum + a.state.eggsAvailable, 0);
        return eggs > 0 ? 'collect' : null;
      },
      run: () => {
        const carried = getCarried();
        if (carried && carried.kind === 'basket') {
          return [
            { kind: 'walkTo', point: approach(basketNode, getPlayerPosition(), 1.0), face: worldOf(basketNode) },
            { kind: 'placeProp', socket: basketSocket },
          ];
        }
        const basket = basketSocket.contents!;
        const hens = [...animals.values()].filter((a) => a.definition.kind === 'chicken');
        let collected = 0;
        return [
          { kind: 'walkTo', point: approach(basketNode, getPlayerPosition(), 1.0), face: worldOf(basketNode) },
          { kind: 'takeProp', prop: basket, duration: 0.7 },
          { kind: 'animate', clip: 'crouchPick', duration: 2.6, sound: 'egg' },
          { kind: 'call', fn: () => {
            // Eggs appear in the basket the child is holding, one per hen.
            for (const hen of hens) {
              while (hen.state.eggsAvailable > 0 && collected < 6) {
                hen.state.eggsAvailable--;
                const egg = makeProp('egg');
                basket.object.add(egg.object);
                const a = (collected / 4) * Math.PI * 2;
                egg.object.position.set(Math.cos(a) * 0.035, 0.03, Math.sin(a) * 0.035);
                egg.object.rotation.z = 0.3;
                collected++;
              }
            }
            onProduce('egg', collected);
          } },
          { kind: 'expression', value: 'delighted' },
          { kind: 'emote', emoji: '🥚', duration: 1.6 },
          { kind: 'reward', hearts: 2 },
        ];
      },
    }),
  );

  /* ---------------- composed routines ---------------- */

  const firstOf = (kind: string): AnimalAgent | undefined =>
    [...animals.values()].find((a) => a.definition.kind === kind);

  const feedRoutine = (kind: string): InteractStep[] => {
    const animal = firstOf(kind);
    if (!animal) return [];
    const isChicken = kind === 'chicken';
    const stationNode = isChicken ? grainStation : hayStation;
    const food = makeProp(isChicken ? 'grain' : 'hay');
    food.object.position.copy(worldOf(stationNode));
    group.add(food.object);
    const dropPoint = new Vector3(
      animal.position.x + 1.0,
      terrain.heightAt(animal.position.x + 1.0, animal.position.z),
      animal.position.z,
    );

    return [
      { kind: 'walkTo', point: approach(stationNode, getPlayerPosition(), 1.3), face: worldOf(stationNode) },
      { kind: 'animate', clip: 'pickUpLow', duration: 1.2 },
      { kind: 'takeProp', prop: food },
      { kind: 'walkTo', point: approach(animal.object, getPlayerPosition(), 1.7), face: animal.position },
      { kind: 'animate', clip: isChicken ? 'scatter' : 'place', duration: isChicken ? 2.4 : 1.2 },
      // Set the food down in front of the animal, then let it come and eat.
      // `dropProp` is what hands the prop back to the world and frees the
      // child's hands; without it the child walks off still holding the hay.
      { kind: 'dropProp', point: dropPoint, parent: group, duration: 0.7 },
      { kind: 'call', fn: () => {
        for (const a of animals.values()) {
          if (a.definition.kind === kind) a.state.fed = 1;
        }
        animal.beginEating(dropPoint.clone(), () => food.object.removeFromParent());
      } },
      { kind: 'expression', value: 'delighted' },
      { kind: 'emote', emoji: '💛', duration: 1.4 },
      { kind: 'reward', hearts: 2 },
    ];
  };

  const milkRoutine = (): InteractStep[] => {
    const cow = firstOf('cow');
    if (!cow) return [];
    const bucket = makeProp('bucket');
    bucket.object.position.copy(worldOf(wellStation));
    group.add(bucket.object);
    const full = makeProp('bucketFull');
    full.object.visible = false;
    group.add(full.object);

    return [
      { kind: 'walkTo', point: approach(wellStation, getPlayerPosition(), 1.6), face: worldOf(wellStation) },
      { kind: 'animate', clip: 'reach', duration: 0.9 },
      { kind: 'takeProp', prop: bucket },
      { kind: 'walkTo', point: approach(cow.object, getPlayerPosition(), 1.4), face: cow.position },
      { kind: 'animate', clip: 'place', duration: 0.9 },
      { kind: 'consumeProp', prop: bucket },
      { kind: 'animate', clip: 'milk', duration: 4.2, sound: 'milk' },
      { kind: 'call', fn: () => {
        cow.state.milkReady = false;
        cow.react('happy');
        full.object.visible = true;
        full.object.position.set(
          cow.position.x,
          terrain.heightAt(cow.position.x, cow.position.z),
          cow.position.z,
        );
      } },
      { kind: 'takeProp', prop: full, duration: 0.9 },
      { kind: 'expression', value: 'delighted' },
      { kind: 'emote', emoji: '🥛', duration: 1.6 },
      { kind: 'reward', hearts: 3, item: 'milk', count: 1 },
    ];
  };

  const eggRoutine = (): InteractStep[] => {
    const basket = basketSocket.contents;
    if (!basket) return [];
    const hens = [...animals.values()].filter((a) => a.definition.kind === 'chicken');
    let collected = 0;
    return [
      { kind: 'walkTo', point: approach(basketNode, getPlayerPosition(), 1.0), face: worldOf(basketNode) },
      { kind: 'takeProp', prop: basket, duration: 0.7 },
      { kind: 'animate', clip: 'crouchPick', duration: 2.6, sound: 'egg' },
      { kind: 'call', fn: () => {
        for (const hen of hens) {
          while (hen.state.eggsAvailable > 0 && collected < 6) {
            hen.state.eggsAvailable--;
            const egg = makeProp('egg');
            basket.object.add(egg.object);
            const a = (collected / 4) * Math.PI * 2;
            egg.object.position.set(Math.cos(a) * 0.035, 0.03, Math.sin(a) * 0.035);
            collected++;
          }
        }
        onProduce('egg', collected);
      } },
      { kind: 'expression', value: 'delighted' },
      { kind: 'emote', emoji: '🥚', duration: 1.6 },
      { kind: 'walkTo', point: approach(basketNode, getPlayerPosition(), 1.0), face: worldOf(basketNode) },
      { kind: 'placeProp', socket: basketSocket },
      { kind: 'reward', hearts: 2 },
    ];
  };

  const waterRoutine = (): InteractStep[] => {
    const bucket = makeProp('bucketFull');
    bucket.object.position.copy(worldOf(wellStation));
    group.add(bucket.object);
    return [
      { kind: 'walkTo', point: approach(wellStation, getPlayerPosition(), 1.6), face: worldOf(wellStation) },
      { kind: 'animate', clip: 'reach', duration: 1.0, sound: 'water' },
      { kind: 'takeProp', prop: bucket },
      { kind: 'walkTo', point: approach(troughStation, getPlayerPosition(), 1.3), face: worldOf(troughStation) },
      { kind: 'animate', clip: 'pour', duration: 2.2, sound: 'pour' },
      { kind: 'consumeProp', prop: bucket },
      { kind: 'call', fn: () => { for (const a of animals.values()) a.state.watered = 1; } },
      { kind: 'expression', value: 'happy' },
      { kind: 'emote', emoji: '💧', duration: 1.4 },
      { kind: 'reward', hearts: 2 },
    ];
  };

  const routines: Record<string, () => InteractStep[]> = {
    feedcow: () => feedRoutine('cow'),
    feedsheep: () => feedRoutine('sheep'),
    feedchickens: () => feedRoutine('chicken'),
    milkcow: milkRoutine,
    collecteggs: eggRoutine,
    watercow: waterRoutine,
  };

  // Keeps the declared list honest if someone adds a routine below and forgets
  // to declare it, or the other way round.
  for (const id of FARM_ROUTINE_IDS) {
    if (!routines[id]) throw new Error(`farm routine "${id}" is declared but not implemented`);
  }

  return { group, routines };
}
