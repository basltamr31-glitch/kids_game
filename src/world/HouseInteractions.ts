import { Group, Object3D, Vector3, type Material } from 'three';
import { Door } from './Door';
import type { CollisionWorld } from './Collision';
import {
  Hinge,
  Prop,
  Socket,
  type Interactable,
  type InteractStep,
  type InteractVerb,
  type InteractableRegistry,
  type Seat,
} from '../gameplay/interact/Interactable';
import { makeProp } from '../gameplay/interact/PropFactory';
import {
  buildBathroom,
  buildBedroom,
  buildDiningSet,
  buildDoor,
  buildKitchen,
  buildLivingRoom,
} from './Furniture';

/**
 * The house as a place the child lives in.
 *
 * Every object here offers exactly one verb at a time, decided from the current
 * state of the world. An empty plate on the counter offers "take"; once it is
 * in your hands the table offers "put down"; once the plate is on the table
 * with bread on it, the chair offers "sit" and then the plate offers "eat".
 *
 * That chain is what turns "have breakfast" from a button into a morning.
 */

/** Names of the physical routines this module supplies. See FARM_ROUTINE_IDS. */
export const HOUSE_ROUTINE_IDS = ['breakfast', 'bedtime'] as const;

export interface HouseState {
  registry: InteractableRegistry;
  /** What the child is holding right now, if anything. */
  getCarried: () => Prop | null;
  /** True while the child is sitting down. */
  isSeated: () => boolean;
  group: Group;
  nodes: Map<string, Object3D>;
  /** The breakfast sequence, assembled from real interactions. */
  breakfastSteps: () => InteractStep[];
  /** Bedtime: wash, brush, then bed. */
  bedtimeSteps: () => InteractStep[];
  /** Where the child stands beside the bed, in world space, computed now. */
  bedside: () => Vector3;
  frontDoor: Hinge;
  /** The front door as a physical object: solid when shut, a gap when open. */
  door: Door;
  /** Footprints of the large furniture, in house-local space. */
  solidFurniture: [number, number, number, number][];
  /** Per-frame house behaviour. */
  update: (dt: number, childPosition: Vector3) => void;
}

const _v = new Vector3();

/** World position of a node. */
function worldOf(node: Object3D, out = new Vector3()): Vector3 {
  return node.getWorldPosition(out);
}

/**
 * Computes where the child should stand to use something: a fixed offset from
 * the object, projected into world space so it follows the house's transform.
 */
function standOffset(node: Object3D, dx: number, dz: number): Vector3 {
  const base = worldOf(node, new Vector3());
  // The house is axis-aligned, so a world-space offset is correct and avoids
  // having to invert a matrix every frame.
  return new Vector3(base.x + dx, base.y, base.z + dz);
}

interface MakeOptions {
  id: string;
  node: Object3D;
  stand: Vector3;
  area?: string;
  bubbleHeight?: number;
  verb: () => InteractVerb | null;
  run: () => InteractStep[];
  labelKey?: () => string;
}

function make(options: MakeOptions): Interactable {
  return {
    id: options.id,
    node: options.node,
    standAt: options.stand,
    bubbleHeight: options.bubbleHeight ?? 0.9,
    area: options.area ?? 'house',
    enabled: true,
    verb: options.verb,
    run: options.run,
    labelKey: options.labelKey,
  };
}

/**
 * Builds the whole interior and wires up every interaction.
 */
export function buildHouseInteractions(
  registry: InteractableRegistry,
  getCarried: () => Prop | null,
  isSeated: () => boolean,
  /** The chalet's shell material, so the front door ghosts with the wall. */
  shellMaterial: Material,
  collision: CollisionWorld,
  getPlayerPosition: () => Vector3,
): HouseState {
  const group = new Group();
  group.name = 'house-interior-live';
  const nodes = new Map<string, Object3D>();

  /* ---------------- furniture ---------------- */
  const kitchen = buildKitchen(registry);
  kitchen.group.position.set(-4.0, 0, -4.0);
  group.add(kitchen.group);

  const dining = buildDiningSet(registry);
  dining.group.position.set(-1.4, 0, -1.0);
  group.add(dining.group);

  const bathroom = buildBathroom(registry);
  bathroom.group.position.set(5.9, 0, 1.6);
  bathroom.group.rotation.y = -Math.PI / 2;
  group.add(bathroom.group);

  const bedroom = buildBedroom(registry);
  bedroom.group.position.set(4.6, 0, -3.0);
  group.add(bedroom.group);

  const living = buildLivingRoom(registry);
  living.group.position.set(-4.2, 0, 2.8);

  /* ---------------- furniture you cannot walk through ---------------- */
  // Registered in house-local space and offset by the house's own placement,
  // which the caller supplies. Only the big pieces: a child squeezing past a
  // chair is fine, a child standing inside the kitchen counter is not.
  const solid: [number, number, number, number][] = [
    // [x, z, halfX, halfZ] in house-local metres
    [-4.0, -4.9, 2.6, 0.45],   // kitchen counter run
    [-1.4, -1.0, 1.5, 0.75],   // dining table
    [4.6, -3.6, 1.1, 0.95],    // bed
    [4.6, -1.4, 0.55, 0.35],   // wardrobe
    [-4.2, 3.0, 1.35, 0.5],    // sofa
    [-6.3, 1.2, 0.4, 1.05],    // fireplace
  ];
  group.add(living.group);

  for (const [key, node] of [...kitchen.nodes, ...dining.nodes, ...bathroom.nodes,
    ...bedroom.nodes, ...living.nodes]) {
    nodes.set(key, node);
  }

  /* ---------------- front door ---------------- */
  const door = buildDoor(registry, {
    id: 'front-door', width: 1.5, height: 2.4, hand: 1, material: shellMaterial,
  });
  door.group.position.set(0, 0.72, 5.42);
  group.add(door.group);
  nodes.set('frontDoor', door.pivot);

  // The door as a physical object. Its world position comes from the group's
  // placement, which the caller sets, so this is resolved after the group is
  // parented rather than guessed here.
  const frontDoor = new Door({
    hinge: door.hinge,
    collision,
    centre: new Vector3(0, 0, 0),
    halfWidth: 0.95,
    halfDepth: 0.3,
    rot: 0,
  });

  // Tapping it opens or shuts it, with the child standing in front and
  // reaching for the handle. This is the difference between a door that moves
  // and a door the child opens.
  registry.add({
    id: 'house.frontDoor',
    node: door.pivot,
    standAt: worldOf(door.pivot, new Vector3()),
    bubbleHeight: 1.5,
    area: 'farmyard',
    enabled: true,
    labelKey: () => (frontDoor.isOpen ? 'interact.closedoor' : 'interact.opendoor'),
    verb: () => 'open',
    run: () => {
      const doorPoint = frontDoor.centre;
      const wantOpen = !frontDoor.isOpen;
      // Stand on whichever side they are already on; walking round a door to
      // open it is exactly the kind of thing that reads as a bug.
      const fromInside = getPlayerPosition().z < doorPoint.z;
      const stand = new Vector3(doorPoint.x, 0, doorPoint.z + (fromInside ? -1.25 : 1.25));
      return [
        { kind: 'walkTo', point: stand, face: doorPoint.clone() },
        { kind: 'animate', clip: 'openDoor', duration: 0.7, sound: 'door' },
        // The state is decided now, when the child is told to do it, rather
        // than on arrival: by then anything could have moved the door.
        { kind: 'call', fn: () => frontDoor.setOpen(wantOpen) },
      ];
    },
  });

  /* ---------------- starting props ---------------- */
  // The house begins the day stocked: plates on the counter, a loaf on the
  // board, a jug of milk, glasses, a toothbrush in its cup, a teddy in the
  // basket. These are real objects, not inventory counts.
  const stock = (socketId: string, kind: Parameters<typeof makeProp>[0]): Prop | null => {
    const socket = registry.socket(socketId);
    if (!socket) return null;
    const prop = makeProp(kind);
    socket.put(prop);
    return prop;
  };

  stock('kitchen.plates', 'plate');
  stock('kitchen.bread', 'bread');
  stock('kitchen.jug', 'milkJug');
  stock('kitchen.glasses', 'glass');
  stock('bath.brush', 'toothbrush');
  stock('bedroom.toys', 'teddy');

  /* ---------------- interactables ---------------- */

  const socket = (id: string): Socket => registry.socket(id)!;
  const seat = (id: string): Seat => registry.seat(id)!;

  /* --- counter items: take whatever is on them --- */
  const takeable: { socketId: string; nodeKey: string; label: string; dx: number; dz: number }[] = [
    { socketId: 'kitchen.plates', nodeKey: 'plates', label: 'interact.takeplate', dx: 0, dz: 0.95 },
    { socketId: 'kitchen.bread', nodeKey: 'bread', label: 'interact.takebread', dx: 0, dz: 0.95 },
    { socketId: 'kitchen.jug', nodeKey: 'jug', label: 'interact.takemilk', dx: 0, dz: 0.95 },
    { socketId: 'kitchen.glasses', nodeKey: 'glasses', label: 'interact.takeglass', dx: 0, dz: 0.95 },
  ];

  for (const spec of takeable) {
    const node = nodes.get(spec.nodeKey)!;
    registry.add(
      make({
        id: `take.${spec.nodeKey}`,
        node,
        stand: standOffset(node, spec.dx, spec.dz),
        bubbleHeight: 0.35,
        labelKey: () => spec.label,
        verb: () => {
          // Only offered when there is something there and hands are free.
          if (getCarried()) return null;
          if (isSeated()) return null;
          return socket(spec.socketId).isEmpty ? null : 'take';
        },
        run: () => {
          const held = socket(spec.socketId).contents!;
          return [
            { kind: 'walkTo', point: standOffset(node, spec.dx, spec.dz), face: worldOf(node) },
            { kind: 'takeProp', prop: held },
            { kind: 'expression', value: 'happy' },
          ];
        },
      }),
    );
  }

  /* --- table places: put down what you are carrying --- */
  for (let i = 0; i < 4; i++) {
    for (const kind of ['plate', 'glass'] as const) {
      const socketId = `table.${kind}.${i}`;
      const target = socket(socketId);
      registry.add(
        make({
          id: `place.${socketId}`,
          node: target.node,
          stand: standOffset(target.node, 0, i < 2 ? -0.85 : 0.85),
          bubbleHeight: 0.3,
          labelKey: () => 'interact.puton',
          verb: () => {
            const carried = getCarried();
            if (!carried || isSeated()) return null;
            return target.canAccept(carried) ? 'place' : null;
          },
          run: () => [
            {
              kind: 'walkTo',
              point: standOffset(target.node, 0, i < 2 ? -0.85 : 0.85),
              face: worldOf(target.node),
            },
            { kind: 'placeProp', socket: target },
            { kind: 'expression', value: 'happy' },
          ],
        }),
      );
    }
  }

  /* --- chairs --- */
  for (const id of ['chair.a', 'chair.b', 'chair.c', 'chair.d']) {
    const s = seat(id);
    registry.add(
      make({
        id: `sit.${id}`,
        node: s.node,
        stand: worldOf(s.node).clone().add(
          new Vector3(s.approachFrom.x - s.node.position.x, 0, s.approachFrom.z - s.node.position.z),
        ),
        bubbleHeight: 1.0,
        labelKey: () => 'interact.sit',
        verb: () => {
          if (isSeated() || s.occupied) return null;
          if (getCarried()) return null;
          return 'sit';
        },
        run: () => [
          { kind: 'walkTo', point: seatApproach(s), face: worldOf(s.node) },
          { kind: 'sit', seat: s },
        ],
      }),
    );
  }

  /* --- eating and drinking, only while seated --- */
  for (let i = 0; i < 4; i++) {
    const plateSocket = socket(`table.plate.${i}`);
    registry.add(
      make({
        id: `eat.${i}`,
        node: plateSocket.node,
        stand: standOffset(plateSocket.node, 0, 0.6),
        bubbleHeight: 0.3,
        labelKey: () => 'interact.eat',
        verb: () => {
          if (!isSeated()) return null;
          const plate = plateSocket.contents;
          if (!plate) return null;
          // A plate with bread on it can be eaten from.
          return plate.object.userData.hasFood ? 'eat' : null;
        },
        run: () => {
          const plate = plateSocket.contents!;
          return [
            { kind: 'animate', clip: 'sitEat', duration: 3.4 },
            { kind: 'call', fn: () => clearFood(plate) },
            { kind: 'expression', value: 'delighted', duration: 1.0 },
            { kind: 'emote', emoji: '😋', duration: 1.2 },
            { kind: 'reward', hearts: 1 },
          ];
        },
      }),
    );

    const glassSocket = socket(`table.glass.${i}`);
    registry.add(
      make({
        id: `drink.${i}`,
        node: glassSocket.node,
        stand: standOffset(glassSocket.node, 0, 0.6),
        bubbleHeight: 0.3,
        labelKey: () => 'interact.drink',
        verb: () => {
          if (!isSeated()) return null;
          const glass = glassSocket.contents;
          return glass && glass.kind === 'glassFull' ? 'drink' : null;
        },
        run: () => {
          const glass = glassSocket.contents!;
          return [
            { kind: 'animate', clip: 'sitDrink', duration: 2.6 },
            { kind: 'consumeProp', prop: glass },
            { kind: 'call', fn: () => { glassSocket.put(makeProp('glass')); } },
            { kind: 'expression', value: 'happy', duration: 1.0 },
            { kind: 'reward', hearts: 1 },
          ];
        },
      }),
    );
  }

  /* --- pouring: jug in hand, glass on the table --- */
  for (let i = 0; i < 4; i++) {
    const glassSocket = socket(`table.glass.${i}`);
    registry.add(
      make({
        id: `pour.${i}`,
        node: glassSocket.node,
        stand: standOffset(glassSocket.node, 0, 0.7),
        bubbleHeight: 0.3,
        labelKey: () => 'interact.pour',
        verb: () => {
          const carried = getCarried();
          if (!carried || carried.kind !== 'milkJug') return null;
          const glass = glassSocket.contents;
          return glass && glass.kind === 'glass' ? 'pour' : null;
        },
        run: () => {
          const empty = glassSocket.contents!;
          return [
            { kind: 'walkTo', point: standOffset(glassSocket.node, 0, 0.7), face: worldOf(glassSocket.node) },
            { kind: 'animate', clip: 'pour', duration: 2.0, sound: 'pour' },
            { kind: 'consumeProp', prop: empty },
            { kind: 'spawnProp', kind2: 'glassFull', socket: glassSocket },
            { kind: 'expression', value: 'happy' },
            { kind: 'reward', hearts: 1 },
          ];
        },
      }),
    );
  }

  /* --- putting bread on a plate --- */
  for (let i = 0; i < 4; i++) {
    const plateSocket = socket(`table.plate.${i}`);
    registry.add(
      make({
        id: `serve.${i}`,
        node: plateSocket.node,
        stand: standOffset(plateSocket.node, 0, 0.7),
        bubbleHeight: 0.3,
        labelKey: () => 'interact.puton',
        verb: () => {
          const carried = getCarried();
          if (!carried || carried.kind !== 'bread') return null;
          const plate = plateSocket.contents;
          return plate && !plate.object.userData.hasFood ? 'place' : null;
        },
        run: () => {
          const plate = plateSocket.contents!;
          const bread = getCarried()!;
          return [
            { kind: 'walkTo', point: standOffset(plateSocket.node, 0, 0.7), face: worldOf(plateSocket.node) },
            { kind: 'animate', clip: 'place', duration: 1.0 },
            { kind: 'call', fn: () => putFoodOnPlate(plate, bread) },
            { kind: 'expression', value: 'happy' },
          ];
        },
      }),
    );
  }

  /* --- stand up --- */
  {
    const node = nodes.get('tableCentre')!;
    registry.add(
      make({
        id: 'standup',
        node,
        stand: standOffset(node, 0, 0),
        bubbleHeight: 0.8,
        labelKey: () => 'interact.standup',
        verb: () => (isSeated() ? 'stand' : null),
        run: () => [{ kind: 'stand' }],
      }),
    );
  }

  /* --- bathroom --- */
  {
    const basin = nodes.get('basin')!;
    const stand = standOffset(basin, -0.95, 0);
    registry.add(
      make({
        id: 'wash',
        node: basin,
        stand,
        bubbleHeight: 0.6,
        labelKey: () => 'interact.wash',
        verb: () => (getCarried() || isSeated() ? null : 'wash'),
        run: () => [
          { kind: 'walkTo', point: stand, face: worldOf(basin) },
          { kind: 'animate', clip: 'washHands', duration: 3.0, sound: 'water' },
          { kind: 'expression', value: 'happy' },
          { kind: 'emote', emoji: '🫧', duration: 1.2 },
          { kind: 'reward', hearts: 1 },
        ],
      }),
    );

    const cup = nodes.get('brushCup')!;
    registry.add(
      make({
        id: 'brush',
        node: cup,
        stand,
        bubbleHeight: 0.3,
        labelKey: () => 'interact.brush',
        verb: () => {
          if (isSeated()) return null;
          return socket('bath.brush').isEmpty ? null : 'brush';
        },
        run: () => {
          const brush = socket('bath.brush').contents!;
          return [
            { kind: 'walkTo', point: stand, face: worldOf(basin) },
            { kind: 'takeProp', prop: brush, duration: 0.6 },
            { kind: 'animate', clip: 'brushTeeth', duration: 3.4, sound: 'water' },
            { kind: 'placeProp', socket: socket('bath.brush'), duration: 0.6 },
            { kind: 'expression', value: 'happy' },
            { kind: 'emote', emoji: '✨', duration: 1.2 },
            { kind: 'reward', hearts: 1 },
          ];
        },
      }),
    );
  }

  /* --- bedroom --- */
  {
    const bed = nodes.get('bed')!;
    const bedStand = standOffset(bed, 1.15, 0);
    registry.add(
      make({
        id: 'bed',
        node: bed,
        stand: bedStand,
        bubbleHeight: 0.6,
        labelKey: () => 'interact.sleep',
        verb: () => (getCarried() || isSeated() ? null : 'look'),
        run: () => [
          { kind: 'walkTo', point: bedStand, face: worldOf(bed) },
          { kind: 'animate', clip: 'yawn', duration: 1.6 },
          { kind: 'expression', value: 'sleepy' },
        ],
      }),
    );

    const wardrobe = nodes.get('wardrobe')!;
    const wardrobeStand = standOffset(wardrobe, 0, 1.2);
    registry.add(
      make({
        id: 'wardrobe',
        node: wardrobe,
        stand: wardrobeStand,
        bubbleHeight: 1.6,
        labelKey: () => 'interact.getdressed',
        verb: () => (getCarried() || isSeated() ? null : 'open'),
        run: () => [
          { kind: 'walkTo', point: wardrobeStand, face: worldOf(wardrobe) },
          { kind: 'animate', clip: 'openDoor', duration: 1.1, sound: 'door' },
          { kind: 'animate', clip: 'reach', duration: 1.2 },
          { kind: 'expression', value: 'happy' },
          { kind: 'emote', emoji: '👕', duration: 1.2 },
          { kind: 'reward', hearts: 1 },
        ],
      }),
    );

    const toys = nodes.get('toys')!;
    const toyStand = standOffset(toys, 0, 0.8);
    registry.add(
      make({
        id: 'teddy',
        node: toys,
        stand: toyStand,
        bubbleHeight: 0.35,
        labelKey: () => 'interact.play',
        verb: () => {
          if (isSeated()) return null;
          const carried = getCarried();
          if (carried) return carried.kind === 'teddy' ? 'place' : null;
          return socket('bedroom.toys').isEmpty ? null : 'take';
        },
        run: () => {
          const carried = getCarried();
          if (carried && carried.kind === 'teddy') {
            return [
              { kind: 'walkTo', point: toyStand, face: worldOf(toys) },
              { kind: 'placeProp', socket: socket('bedroom.toys') },
            ];
          }
          const teddy = socket('bedroom.toys').contents!;
          return [
            { kind: 'walkTo', point: toyStand, face: worldOf(toys) },
            { kind: 'takeProp', prop: teddy },
            { kind: 'expression', value: 'delighted' },
            { kind: 'emote', emoji: '🧸', duration: 1.4 },
          ];
        },
      }),
    );
  }

  /* --- sofa --- */
  for (const id of ['sofa.0', 'sofa.1']) {
    const s = seat(id);
    registry.add(
      make({
        id: `sit.${id}`,
        node: s.node,
        stand: seatApproach(s),
        bubbleHeight: 0.9,
        labelKey: () => 'interact.sit',
        verb: () => (isSeated() || s.occupied || getCarried() ? null : 'sit'),
        run: () => [
          { kind: 'walkTo', point: seatApproach(s), face: worldOf(s.node) },
          { kind: 'sit', seat: s },
        ],
      }),
    );
  }

  /* --- front door --- */
  {
    const node = door.pivot;
    const stand = standOffset(node, -0.2, 1.3);
    registry.add(
      make({
        id: 'frontdoor',
        node,
        stand,
        area: 'farmyard',
        bubbleHeight: 1.6,
        labelKey: () => (door.hinge.isOpen ? 'prompt.close' : 'prompt.open'),
        verb: () => (isSeated() ? null : door.hinge.isOpen ? 'close' : 'open'),
        run: () => [
          { kind: 'walkTo', point: stand, face: worldOf(node) },
          { kind: 'animate', clip: 'openDoor', duration: 1.1 },
          { kind: 'swing', hinge: door.hinge, open: !door.hinge.isOpen },
        ],
      }),
    );
  }

  /* ---------------- composed routines ---------------- */

  /**
   * Breakfast, as a chain of the same physical operations the child could do
   * themselves by tapping objects. Tapping the task in the list simply plays
   * the whole chain instead of requiring eleven separate taps from a
   * four-year-old.
   */
  const breakfastSteps = (): InteractStep[] => {
    const plateSocket = socket('table.plate.0');
    const glassSocket = socket('table.glass.0');
    const chair = seat('chair.a');
    const steps: InteractStep[] = [];

    const plate = socket('kitchen.plates').contents;
    const bread = socket('kitchen.bread').contents;
    const jug = socket('kitchen.jug').contents;
    const glass = socket('kitchen.glasses').contents;

    const kitchenStand = standOffset(nodes.get('plates')!, 0, 0.95);
    const tableStand = standOffset(plateSocket.node, 0, -0.85);

    if (plate && plateSocket.isEmpty) {
      steps.push(
        { kind: 'walkTo', point: kitchenStand, face: worldOf(nodes.get('plates')!) },
        { kind: 'takeProp', prop: plate },
        { kind: 'walkTo', point: tableStand, face: worldOf(plateSocket.node) },
        { kind: 'placeProp', socket: plateSocket },
      );
    }
    if (bread) {
      steps.push(
        { kind: 'walkTo', point: kitchenStand, face: worldOf(nodes.get('bread')!) },
        { kind: 'takeProp', prop: bread },
        { kind: 'walkTo', point: tableStand, face: worldOf(plateSocket.node) },
        { kind: 'animate', clip: 'place', duration: 1.0 },
        { kind: 'call', fn: () => putFoodOnPlate(plateSocket.contents!, bread) },
      );
    }
    if (glass && glassSocket.isEmpty) {
      steps.push(
        { kind: 'walkTo', point: kitchenStand, face: worldOf(nodes.get('glasses')!) },
        { kind: 'takeProp', prop: glass },
        { kind: 'walkTo', point: tableStand, face: worldOf(glassSocket.node) },
        { kind: 'placeProp', socket: glassSocket },
      );
    }
    if (jug) {
      steps.push(
        { kind: 'walkTo', point: kitchenStand, face: worldOf(nodes.get('jug')!) },
        { kind: 'takeProp', prop: jug },
        { kind: 'walkTo', point: tableStand, face: worldOf(glassSocket.node) },
        { kind: 'animate', clip: 'pour', duration: 2.0, sound: 'pour' },
        { kind: 'call', fn: () => {
          const empty = glassSocket.take();
          if (empty) empty.object.removeFromParent();
          glassSocket.put(makeProp('glassFull'));
        } },
        { kind: 'walkTo', point: kitchenStand, face: worldOf(nodes.get('jug')!) },
        { kind: 'placeProp', socket: socket('kitchen.jug') },
      );
    }

    steps.push(
      { kind: 'walkTo', point: seatApproach(chair), face: worldOf(chair.node) },
      { kind: 'sit', seat: chair },
      { kind: 'speech', actor: 'mother', textKey: 'speech.mother.goodmorning', duration: 2.6 },
      { kind: 'animate', clip: 'sitEat', duration: 3.6 },
      { kind: 'call', fn: () => clearFood(plateSocket.contents) },
      { kind: 'animate', clip: 'sitDrink', duration: 2.6 },
      { kind: 'call', fn: () => {
        const full = glassSocket.take();
        if (full) full.object.removeFromParent();
        glassSocket.put(makeProp('glass'));
      } },
      { kind: 'expression', value: 'delighted', duration: 1.2 },
      { kind: 'emote', emoji: '😋', duration: 1.4 },
      { kind: 'stand' },
    );

    return steps;
  };

  const bedtimeSteps = (): InteractStep[] => {
    const basin = nodes.get('basin')!;
    const bed = nodes.get('bed')!;
    const washStand = standOffset(basin, -0.95, 0);
    const brushSocket = socket('bath.brush');
    const steps: InteractStep[] = [
      { kind: 'walkTo', point: washStand, face: worldOf(basin) },
      { kind: 'animate', clip: 'washHands', duration: 2.6, sound: 'water' },
    ];
    if (!brushSocket.isEmpty) {
      steps.push(
        { kind: 'takeProp', prop: brushSocket.contents!, duration: 0.6 },
        { kind: 'animate', clip: 'brushTeeth', duration: 3.2 },
        { kind: 'placeProp', socket: brushSocket, duration: 0.6 },
      );
    }
    steps.push(
      { kind: 'expression', value: 'sleepy' },
      { kind: 'walkTo', point: standOffset(bed, 1.15, 0), face: worldOf(bed) },
      { kind: 'animate', clip: 'yawn', duration: 1.6 },
      { kind: 'speech', actor: 'mother', textKey: 'speech.mother.goodnight', duration: 2.6 },
      { kind: 'animate', clip: 'sleep', duration: 2.2, sound: 'sleep' },
    );
    return steps;
  };

  return {
    registry,
    getCarried,
    isSeated,
    group,
    nodes,
    breakfastSteps,
    bedtimeSteps,
    bedside: () => standOffset(nodes.get('bed')!, 1.15, 0),
    frontDoor: door.hinge,
    door: frontDoor,
    solidFurniture: solid,
    update: (dt, childPosition) => {
      void childPosition;
      frontDoor.update(dt);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Plate contents                                                      */
/* ------------------------------------------------------------------ */

/**
 * Bread sits ON the plate rather than replacing it, so the player sees the
 * plate fill and then empty. The bread becomes a child of the plate, which
 * means moving the plate moves the meal with it.
 */
function putFoodOnPlate(plate: Prop | null, bread: Prop): void {
  if (!plate) return;
  if (bread.socket) bread.socket.take();
  plate.object.add(bread.object);
  bread.object.position.set(0, 0.03, 0);
  bread.object.quaternion.identity();
  plate.object.userData.hasFood = true;
  plate.object.userData.food = bread.object;
}

function clearFood(plate: Prop | null): void {
  if (!plate || !plate.object.userData.hasFood) return;
  const food = plate.object.userData.food as Object3D | undefined;
  food?.removeFromParent();
  plate.object.userData.hasFood = false;
  plate.object.userData.food = undefined;
}

/** World-space point the child walks to before sitting. */
function seatApproach(seat: Seat): Vector3 {
  seat.node.updateWorldMatrix(true, false);
  const world = worldOf(seat.node, _v.clone());
  // approachFrom is expressed in the same local frame as the seat node's
  // parent, so the delta from the node's own position transfers to world space.
  return new Vector3(
    world.x + (seat.approachFrom.x - seat.node.position.x),
    world.y,
    world.z + (seat.approachFrom.z - seat.node.position.z),
  );
}
