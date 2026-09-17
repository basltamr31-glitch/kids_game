import { Object3D, Vector3, Quaternion, Matrix4 } from 'three';
import type { ClipName } from '../../characters/CharacterRig';

/**
 * The interaction framework.
 *
 * This is the backbone of "the child actually lives here". Instead of a menu
 * entry that teleports an outcome into existence, the world holds real objects
 * with real state, and every daily action is a short sequence of physical
 * operations on them: pick this up, carry it there, put it down, sit, eat.
 *
 * DESIGN RULES
 *  - An interactable never opens a menu. It offers exactly one verb at a time,
 *    shown as a single icon over the object.
 *  - Everything is data plus a small state machine, so a new interactive object
 *    is a registration call, not an engine change.
 *  - Nothing can fail. If a precondition is unmet the object simply does not
 *    offer its verb, so the child never taps into a dead end.
 */

export type InteractVerb =
  | 'take'
  | 'place'
  | 'open'
  | 'close'
  | 'sit'
  | 'stand'
  | 'use'
  | 'wash'
  | 'brush'
  | 'eat'
  | 'drink'
  | 'pour'
  | 'pet'
  | 'feed'
  | 'milk'
  | 'collect'
  | 'look';

/** Icons shown in the world bubble. One glyph, no text needed. */
export const VERB_ICON: Record<InteractVerb, string> = {
  take: '✋', place: '⬇️', open: '🚪', close: '🚪', sit: '🪑', stand: '🧍',
  use: '✋', wash: '🧼', brush: '🪥', eat: '🍽️', drink: '🥛', pour: '🫗',
  pet: '💗', feed: '🌾', milk: '🥛', collect: '🧺', look: '👀',
};

/** Localization key for the verb label. */
export const VERB_KEY: Record<InteractVerb, string> = {
  take: 'prompt.take', place: 'prompt.place', open: 'prompt.open', close: 'prompt.close',
  sit: 'prompt.sit', stand: 'prompt.stand', use: 'prompt.use', wash: 'prompt.wash',
  brush: 'prompt.brush', eat: 'prompt.eat', drink: 'prompt.drink', pour: 'prompt.pour',
  pet: 'prompt.pet', feed: 'prompt.feed', milk: 'prompt.milk', collect: 'prompt.collect',
  look: 'prompt.look',
};

/**
 * A place an object can rest: a spot on a table, a nest, a shelf.
 *
 * Sockets are what make "put the plate on the table" a real operation. Each
 * holds at most one prop and knows the transform it should sit at.
 */
export class Socket {
  readonly id: string;
  readonly node: Object3D;
  /** What kind of prop this socket accepts; empty means anything. */
  readonly accepts: Set<string>;
  private held: Prop | null = null;

  constructor(id: string, node: Object3D, accepts: string[] = []) {
    this.id = id;
    this.node = node;
    this.accepts = new Set(accepts);
  }

  get isEmpty(): boolean {
    return this.held === null;
  }

  get contents(): Prop | null {
    return this.held;
  }

  canAccept(prop: Prop): boolean {
    if (this.held) return false;
    return this.accepts.size === 0 || this.accepts.has(prop.kind);
  }

  /** Reparents a prop onto this socket, preserving nothing — it snaps home. */
  put(prop: Prop): void {
    this.held = prop;
    prop.socket = this;
    this.node.add(prop.object);
    prop.object.position.set(0, 0, 0);
    prop.object.quaternion.identity();
    prop.object.scale.setScalar(1);
    prop.object.visible = true;
  }

  take(): Prop | null {
    const prop = this.held;
    if (prop) {
      prop.socket = null;
      this.held = null;
    }
    return prop;
  }
}

/** A physical object the child can pick up and put down. */
export class Prop {
  readonly id: string;
  /** Item kind, matching `content/Items.ts`. */
  readonly kind: string;
  readonly object: Object3D;
  socket: Socket | null = null;

  constructor(id: string, kind: string, object: Object3D) {
    this.id = id;
    this.kind = kind;
    this.object = object;
    object.name = `prop-${id}`;
  }

  get worldPosition(): Vector3 {
    return this.object.getWorldPosition(new Vector3());
  }
}

/**
 * Something in the world the child can act on.
 *
 * `verb()` is queried every frame, so an object can change what it offers as
 * the world changes: an empty plate offers nothing, a plate with bread on it
 * offers "eat", a chair offers "sit" until you are on it and then "stand".
 */
export interface Interactable {
  id: string;
  /** Used for the world bubble and for raycast picking. */
  node: Object3D;
  /** Where the child stands to use it, in world space. */
  standAt: Vector3;
  /** What the child turns to face. Defaults to the node's own position. */
  facePoint?: Vector3;
  /** Height above `node` for the prompt bubble. */
  bubbleHeight: number;
  /** Area id, for premium gating and ambience. */
  area: string;
  /** Null means "nothing to do here right now" and no bubble is shown. */
  verb(): InteractVerb | null;
  /** Localization key describing the action, e.g. "activity.eatbread". */
  labelKey?(): string;
  /** Produces the physical steps to perform. */
  run(): InteractStep[];
  /** Per-frame update, for doors swinging and lids lifting. */
  update?(dt: number): void;
  enabled: boolean;
}

/**
 * The step vocabulary.
 *
 * Deliberately small and physical. Anything a daily routine needs should be
 * expressible as a sequence of these, and each maps to something the player
 * can actually see happen.
 */
export type InteractStep =
  | { kind: 'walkTo'; point: Vector3; face?: Vector3 }
  | { kind: 'face'; point: Vector3 }
  | { kind: 'animate'; clip: ClipName; duration: number; sound?: string }
  | { kind: 'wait'; duration: number }
  /** Move a prop from wherever it is into the child's hand. */
  | { kind: 'takeProp'; prop: Prop; duration?: number }
  /** Move the carried prop into a socket. */
  | { kind: 'placeProp'; socket: Socket; duration?: number }
  /** Create a prop and put it straight into a socket (milk into a bucket). */
  | { kind: 'spawnProp'; kind2: string; socket: Socket }
  /** Remove a prop from the world (bread eaten). */
  | { kind: 'consumeProp'; prop: Prop }
  | { kind: 'sit'; seat: Seat }
  | { kind: 'stand' }
  /** Swing a door or lift a lid. */
  | { kind: 'swing'; hinge: Hinge; open: boolean; duration?: number }
  | { kind: 'expression'; value: string; duration?: number }
  | { kind: 'emote'; emoji: string; duration?: number }
  | { kind: 'speech'; actor: string; textKey: string; duration?: number }
  | { kind: 'sound'; name: string }
  | { kind: 'reward'; hearts?: number; item?: string; count?: number }
  | { kind: 'call'; fn: () => void };

/** A place the child can sit: the seat transform plus where to stand first. */
export interface Seat {
  id: string;
  node: Object3D;
  /** Local offset from `node` to the actual sitting position. */
  offset: Vector3;
  /** Facing when seated, radians. */
  yaw: number;
  occupied: boolean;
  approachFrom: Vector3;
}

/**
 * A hinged part: a door, a wardrobe leaf, a nest-box lid.
 *
 * Animated on its own so it can swing while the child walks through, which is
 * the difference between a door and a wall that disappears.
 */
export class Hinge {
  readonly node: Object3D;
  private closedAngle: number;
  private openAngle: number;
  private current: number;
  private target: number;
  private axis: 'y' | 'x';
  private speed: number;

  constructor(
    node: Object3D,
    options: { closed?: number; open: number; axis?: 'y' | 'x'; speed?: number },
  ) {
    this.node = node;
    this.closedAngle = options.closed ?? 0;
    this.openAngle = options.open;
    this.current = this.closedAngle;
    this.target = this.closedAngle;
    this.axis = options.axis ?? 'y';
    this.speed = options.speed ?? 3.2;
    this.apply();
  }

  get isOpen(): boolean {
    return this.target === this.openAngle;
  }

  set(open: boolean): void {
    this.target = open ? this.openAngle : this.closedAngle;
  }

  toggle(): void {
    this.set(!this.isOpen);
  }

  update(dt: number): void {
    if (Math.abs(this.current - this.target) < 0.001) return;
    // Ease toward the target; doors decelerate as they arrive.
    this.current += (this.target - this.current) * Math.min(1, this.speed * dt);
    this.apply();
  }

  private apply(): void {
    if (this.axis === 'y') this.node.rotation.y = this.current;
    else this.node.rotation.x = this.current;
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const _world = new Vector3();

/**
 * Holds every interactable and answers "what is the child near?".
 *
 * A flat scan is fine: the whole farm has on the order of 60 interactables and
 * the query runs once a frame. Spatial partitioning here would be complexity
 * bought with nothing.
 */
export class InteractableRegistry {
  private items = new Map<string, Interactable>();
  private sockets = new Map<string, Socket>();
  private seats = new Map<string, Seat>();
  private hinges: Hinge[] = [];

  add(interactable: Interactable): void {
    this.items.set(interactable.id, interactable);
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  get(id: string): Interactable | undefined {
    return this.items.get(id);
  }

  addSocket(socket: Socket): Socket {
    this.sockets.set(socket.id, socket);
    return socket;
  }

  socket(id: string): Socket | undefined {
    return this.sockets.get(id);
  }

  addSeat(seat: Seat): Seat {
    this.seats.set(seat.id, seat);
    return seat;
  }

  seat(id: string): Seat | undefined {
    return this.seats.get(id);
  }

  addHinge(hinge: Hinge): Hinge {
    this.hinges.push(hinge);
    return hinge;
  }

  get all(): Interactable[] {
    return [...this.items.values()];
  }

  /** Every node that should be hit-testable by a tap. */
  get pickables(): Object3D[] {
    return this.all.filter((i) => i.enabled).map((i) => i.node);
  }

  /**
   * The best interactable within `radius` of a point.
   *
   * Scored by distance, but an object the child is facing wins over one behind
   * them at the same range, which stops the prompt flickering between a table
   * and the chair behind it.
   */
  findNearest(
    position: Vector3,
    facing: Vector3,
    radius: number,
  ): { interactable: Interactable; verb: InteractVerb; distance: number } | null {
    let best: { interactable: Interactable; verb: InteractVerb; distance: number } | null = null;
    let bestScore = Infinity;

    for (const item of this.items.values()) {
      if (!item.enabled) continue;
      const verb = item.verb();
      if (!verb) continue;

      item.node.getWorldPosition(_world);
      const dx = _world.x - position.x;
      const dz = _world.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;

      // Facing bonus: up to 35% closer in scoring terms.
      let score = distance;
      if (distance > 0.2) {
        const dot = (dx / distance) * facing.x + (dz / distance) * facing.z;
        score *= 1 - Math.max(0, dot) * 0.35;
      }

      if (score < bestScore) {
        bestScore = score;
        best = { interactable: item, verb, distance };
      }
    }
    return best;
  }

  update(dt: number): void {
    for (const hinge of this.hinges) hinge.update(dt);
    for (const item of this.items.values()) item.update?.(dt);
  }

  clear(): void {
    this.items.clear();
    this.sockets.clear();
    this.seats.clear();
    this.hinges.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const _m = new Matrix4();
const _q = new Quaternion();

/**
 * Reparents an object while keeping it visually where it is.
 *
 * Used when a prop moves from a table into a hand: without this the prop would
 * teleport, and the whole point is that the player watches it move.
 */
export function reparentKeepingWorld(object: Object3D, newParent: Object3D): void {
  object.updateWorldMatrix(true, false);
  newParent.updateWorldMatrix(true, false);
  _m.copy(newParent.matrixWorld).invert().multiply(object.matrixWorld);
  newParent.add(object);
  _m.decompose(object.position, _q, object.scale);
  object.quaternion.copy(_q);
}
