import {
  LinearToneMapping,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Group,
} from 'three';

import type { GameContext } from './GameContext';
import { EventBus } from './EventBus';
import { AdaptiveQualityMonitor, detectFormFactor, detectQualityTier, qualityFor } from './DeviceProfile';
import { Rng, clamp } from './Rng';

import { buildWorld, updateCutaways, rebuildSeasonalContent, type BuiltWorld } from '../world/WorldBuilder';
import { updateSharedUniforms, setMaterialQuality } from '../art/Materials';
import { warmDetailTextures } from '../art/Textures';
import { Player } from '../gameplay/Player';
import { CameraRig } from '../gameplay/CameraRig';
import { InputManager } from '../gameplay/InputManager';
import { ActivitySystem } from '../gameplay/ActivitySystem';
import { InteractionSystem } from '../gameplay/InteractionSystem';
import { DayDirector } from '../gameplay/DayDirector';
import { WeatherSystem } from '../gameplay/WeatherSystem';
import { InteractableRegistry } from '../gameplay/interact/Interactable';
import { InteractionRunner } from '../gameplay/interact/InteractionRunner';
import { ChildNotices } from '../gameplay/ChildNotices';
import { setFaceResolution } from '../characters/Face';
import { ParentReactions } from '../gameplay/ParentReactions';
import type { SuggestionContext } from '../gameplay/Suggestions';
import { buildHouseInteractions, type HouseState } from '../world/HouseInteractions';
import { buildFarmInteractions, type FarmState } from '../world/FarmInteractions';
import { FarmFeatures } from '../world/FarmFeatures';
import { Storybook } from '../gameplay/Storybook';
import { CHALET_DIVIDERS } from '../world/Buildings';
import { AnimalAgent } from '../animals/AnimalAgent';
import { FamilyAgent } from '../characters/FamilyAgent';

import {
  animalsFor,
  ANIMALS_BY_ID,
  DISCOVERIES_BY_ID,
  AREAS_BY_ID,
  ITEMS_BY_ID,
  ACTIVITIES_BY_ID,
  MILESTONES,
  farmFeaturesAt,
} from '../content';
import type { AnimalSaveState } from '../save/SaveSchema';

import { UIRoot } from '../ui/UIRoot';
import { Hud } from '../ui/Hud';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import {
  buildCustomizeScreen,
  buildTitleScreen,
  buildMilestoneScreen,
  buildDayEndScreen,
  buildNatureBookScreen,
  buildParentGateScreen,
  buildParentAreaScreen,
  buildStoreScreen,
  buildConfirmScreen,
} from '../ui/Screens';
import { PRODUCT_FULL_GAME } from '../monetization/IStore';
import { APP_VERSION, LINKS } from './Config';

/**
 * The game.
 *
 * This class owns the frame loop and wires the systems together; it contains no
 * gameplay rules of its own. Anything that looks like a design decision lives in
 * `src/content`, and anything that looks like a mechanic lives in a system under
 * `src/gameplay`.
 */
const _animalBodies: { x: number; z: number; r: number }[] = [];

const SEASON_ICON: Record<string, string> = { spring: '🌷', summer: '🌻', autumn: '🍂', winter: '⛄' };
const WEATHER_ICON: Record<string, string> = { sunny: '☀️', cloudy: '⛅', rain: '🌧️', snow: '❄️', fog: '🌫️' };

export class Game {
  private ctx: GameContext;
  private renderer: WebGLRenderer;
  private scene = new Scene();

  private world!: BuiltWorld;
  private player!: Player;
  private cameraRig!: CameraRig;
  private input!: InputManager;
  private activities!: ActivitySystem;
  private interaction!: InteractionSystem;
  private director!: DayDirector;
  private weather!: WeatherSystem;
  private registry = new InteractableRegistry();
  private runner!: InteractionRunner;
  private notices!: ChildNotices;
  private parentReactions!: ParentReactions;
  private house!: HouseState;
  private farm!: FarmState;
  private ui!: UIRoot;
  private hud!: Hud;
  private layout: ResponsiveLayout;

  private animals = new Map<string, AnimalAgent>();
  private parents = new Map<string, FamilyAgent>();
  private actorRoot = new Group();

  private qualityMonitor: AdaptiveQualityMonitor;
  private lastFrameTime = 0;
  private running = false;
  private rafHandle = 0;
  private windTime = 0;
  private dayEnding = false;
  private farmFeatures!: FarmFeatures;
  private celebrating = false;
  private storybook = new Storybook();
  private milestoneTimer = 1;
  private playerIndoors = false;
  private discoveryTargets: { id: string; position: Vector3; found: boolean }[] = [];
  private interiorLightTarget = new Vector3();

  constructor(ctx: GameContext, canvas: HTMLCanvasElement) {
    this.ctx = ctx;
    this.layout = new ResponsiveLayout(ctx.bus);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: ctx.quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Linear, not filmic. A filmic curve is built to tame photographic highlights;
    // applied to a flat stylized palette it just desaturates the greens and
    // crushes the shadows, which is the opposite of the look we want.
    this.renderer.toneMapping = LinearToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = ctx.quality.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;

    this.qualityMonitor = new AdaptiveQualityMonitor(
      () => this.ctx.quality.tier,
      (tier, reason) => this.applyQuality(tier, reason),
    );

    this.scene.add(this.actorRoot);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async init(uiMount: HTMLElement): Promise<void> {
    const ctx = this.ctx;
    const save = ctx.save.save;

    this.layout.setUserScale(ctx.save.settings.uiScale);
    this.layout.apply();
    ctx.formFactor = this.layout.formFactor;
    document.body.classList.toggle('reduced-motion', ctx.save.settings.reducedMotion);
    document.body.classList.toggle('left-handed', ctx.save.settings.leftHanded);

    /* --- surface detail --- */
    // Generated once, before any geometry asks for them, so nothing hitches
    // mid-play. Detail mapping costs two texture samples per fragment, so the
    // battery-saver tier drops it; the rim light is cheap enough to keep.
    //
    // NOTE: this is read at material-creation time, so it is fixed for the
    // session. A mid-session quality change still moves the levers that
    // dominate frame time (shadows, resolution, vegetation density).
    setMaterialQuality({ detail: ctx.quality.tier !== 'low', rim: true });
    warmDetailTextures();

    /* --- world --- */
    this.world = buildWorld(this.scene, ctx.worldRng.fork('world'), ctx.quality, save.season);

    /* --- lighting & weather --- */
    this.weather = new WeatherSystem(this.scene, ctx.quality, ctx.worldRng.fork('weather'));
    // Faces are the one texture the camera gets close to, so they get the
    // budget. Must happen before any character is built.
    setFaceResolution(
      ctx.quality.tier === 'low' ? 384 : ctx.quality.tier === 'medium' ? 640 : 896,
    );
    this.weather.setSeason(save.season);
    this.weather.setWeather(save.weather, true);

    /* --- camera & input --- */
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight, ctx.formFactor);
    this.input = new InputManager(this.renderer.domElement);
    // While dressing up, the child keeps facing the camera as it steps round
    // furniture to keep them in view.
    this.cameraRig.onAvoid = (theta) => {
      if (this.ui?.has('wardrobe')) this.player.turnTo(theta);
    };

    /* --- the child --- */
    // Spawn in the open farmyard looking north up the valley. The porch would
    // be more literal, but it puts the follow camera inside the chalet on the
    // very first frame, which is the worst possible first impression.
    const spawn = this.world.anchors.get('yardcenter')?.position.clone() ?? new Vector3(0, 0, 9);
    this.player = new Player(save.child, this.world.terrain, spawn, this.world.collision);
    this.player.setNavGrid(this.world.nav);
    this.player.onFootstep = (surface) => {
      const map = {
        grass: 'footstepGrass',
        dirt: 'footstepDirt',
        wood: 'footstepWood',
        snow: 'footstepSnow',
      } as const;
      const name = save.season === 'winter' ? 'footstepSnow' : map[surface];
      ctx.audio.play(name, 0.94 + Math.random() * 0.12);
    };
    this.actorRoot.add(this.player.group);

    /* --- animals --- */
    this.spawnAnimals();

    /* --- family --- */
    for (const role of ['mother', 'father'] as const) {
      const agent = new FamilyAgent(role, this.world.terrain, ctx.worldRng.fork(role));
      agent.group.userData.interactKind = 'parent';
      agent.group.userData.interactId = role;
      this.parents.set(role, agent);
      this.actorRoot.add(agent.group);
    }

    /* --- physical interaction --- */
    // The runner owns what the child is holding and whether they are sitting,
    // and the house asks it those questions when deciding what each object
    // offers. That is the whole coupling between them.
    this.runner = new InteractionRunner(ctx, this.player);
    const chalet = this.world.cutaways[0];
    // Whatever the hearts have already earned is standing there on load.
    this.farmFeatures = new FarmFeatures(this.world);
    this.farmFeatures.sync(farmFeaturesAt(ctx.save.save.hearts));
    this.house = buildHouseInteractions(
      this.registry,
      () => this.runner.carriedProp,
      () => this.player.isSeated,
      chalet.result.shellMaterial,
      this.world.collision,
      () => this.player.position,
    );
    if (chalet) {
      this.house.group.position.copy(chalet.centre);
      this.scene.add(this.house.group);
      // The door registered its collider at the origin; now that the house is
      // placed, move it to where the doorway actually is.
      // Furniture is solid too, now that the house has a position to offset by.
      for (const [fx, fz, hx, hz] of this.house.solidFurniture) {
        this.world.collision.addBox(
          chalet.centre.x + fx, chalet.centre.z + fz, hx, hz, 0, 'furniture',
        );
      }
      this.world.nav.rebuild();

      this.cameraRig.setCollision(this.world.collision);
      const house = this.world.cutaways[0]?.centre;
      if (house) {
        this.cameraRig.setOccluders(
          CHALET_DIVIDERS.map((d) => ({ x: house.x + d.x, z: house.z + d.z, hx: d.w / 2, hz: d.d / 2 })),
        );
      }
      this.player.setDoor(this.house.door);
      this.player.onDoorOpened = () => this.ctx.audio.play('door');
      this.house.door.placeAt(
        chalet.centre.x,
        chalet.centre.z + 5.42,
        this.world.collision,
        this.world.nav,
      );
    }

    // The farm's interactables live in world space already, so its group
    // stays at the origin.
    this.farm = buildFarmInteractions(
      this.registry,
      this.animals,
      this.world.terrain,
      () => this.runner.carriedProp,
      () => this.player.position,
      (item, count) => this.grantItem(item, count),
    );
    this.scene.add(this.farm.group);

    /* --- systems --- */
    this.director = new DayDirector(ctx);
    this.activities = new ActivitySystem(ctx, {
      player: this.player,
      animals: this.animals,
      parents: this.parents,
      world: this.world,
      camera: this.cameraRig,
    });
    this.attachRoutines();

    // The child notices things on their own: a butterfly going past, an animal
    // that has wandered up, the mountains when they have been still a while.
    this.notices = new ChildNotices(
      this.player,
      this.animals,
      ctx.worldRng.fork('notices'),
      this.world.ambient.group,
    );

    // Mum and Dad watch what the child is doing, and react when it is done.
    this.parentReactions = new ParentReactions(ctx, this.parents, () => this.player.position);

    this.interaction = new InteractionSystem(ctx, {
      player: this.player,
      cameraRig: this.cameraRig,
      activities: this.activities,
      director: this.director,
      world: this.world,
      animals: this.animals,
      parents: this.parents,
      registry: this.registry,
      runner: this.runner,
    });

    /* --- UI --- */
    this.ui = new UIRoot(ctx, uiMount);
    this.hud = new Hud(
      ctx,
      {
        director: this.director,
        interaction: this.interaction,
        camera: this.cameraRig,
        suggestionContext: () => this.buildSuggestionContext(),
      },
      { onMenu: () => this.openParentGate(), onBook: () => this.openNatureBook() },
    );
    this.ui.setHud(this.hud.root);
    this.ui.onModalChange((count) => {
      // World input off while a panel is open.
      this.input.setEnabled(count === 0);
    });

    this.wireEvents();

    this.input.onTap((tap) => {
      void ctx.audio.start();
      if (this.ui.modalCount > 0) return;
      this.interaction.handleTap(tap);
    });

    window.addEventListener('resize', this.onResize);

    ctx.platform.onPause(() => this.pause());
    ctx.platform.onResume(() => this.resume());

    this.onResize();

    /* --- title, then (first launch only) choose who you are --- */
    const fresh = ctx.save.isFreshSave;
    if (!fresh) {
      this.director.beginDay();
      this.syncPhaseDependents();
    }
    this.openTitle(fresh);

    this.seedDiscoveries();
    ctx.bus.emit('game:ready');
  }

  private spawnAnimals(): void {
    const ctx = this.ctx;
    const definitions = animalsFor(ctx.entitlements.isPremium);
    const saved = new Map(ctx.save.save.animals.map((a) => [a.id, a]));

    for (const definition of definitions) {
      const state: AnimalSaveState = saved.get(definition.id) ?? {
        id: definition.id,
        fed: 0.5,
        watered: 0.5,
        milkReady: definition.kind === 'cow',
        eggsAvailable: definition.kind === 'chicken' ? 1 : 0,
        bond: 0,
        petToday: false,
      };

      const agent = new AnimalAgent(
        definition,
        state,
        ctx.worldRng.fork(`animal-${definition.id}`),
        this.world.terrain,
      );
      agent.object.userData.interactKind = 'animal';
      agent.object.userData.interactId = definition.id;
      this.animals.set(definition.id, agent);
      this.actorRoot.add(agent.object);
    }

    // Persist the roster so a save always knows its animals.
    ctx.save.update((data) => {
      data.animals = [...this.animals.values()].map((a) => a.state);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  private wireEvents(): void {
    const ctx = this.ctx;

    ctx.bus.on('activity:completed', ({ activityId }) => {
      this.storybook.request(activityId);
      // Getting dressed means choosing what to wear.
      if (activityId === 'getdressed') {
        window.setTimeout(() => {
          if (!this.dayEnding && this.ui.modalCount === 0) this.openWardrobe();
        }, 500);
      }
      const result = this.director.onActivityCompleted();
      if (result.phaseChanged) this.syncPhaseDependents();
      if (result.dayComplete && !this.dayEnding) this.finishDay();
    });

    ctx.bus.on('entitlement:changed', () => {
      // Premium animals join the farm immediately, no restart.
      this.spawnAnimals();
      this.interaction.refreshPickables();
      this.hud.refreshTasks();
    });

    ctx.bus.on('settings:changed', () => {
      ctx.audio.applySettings(ctx.save.settings);
      document.body.classList.toggle('reduced-motion', ctx.save.settings.reducedMotion);
    });

    ctx.bus.on('locale:changed', () => {
      ctx.save.updateSettings((s) => {
        s.locale = ctx.loc.locale;
        s.localeIsExplicit = true;
      });
    });
  }

  /**
   * Hands the scheduled activities the physical routines they defer to.
   *
   * Called once at start-up and again whenever the runner is rebuilt, because
   * a routine closes over `this.runner` only through the systems it is given.
   */
  private attachRoutines(): void {
    this.activities.attachRunner(this.runner, {
      breakfast: () => this.house.breakfastSteps(),
      bedtime: () => this.house.bedtimeSteps(),
      ...this.farm.routines,
    });
  }

  /**
   * Everything the suggestion list needs to know about right now.
   *
   * Assembled here because this is the only place that can see the child, the
   * weather, the animals and the world's anchors at once.
   */
  private buildSuggestionContext(): SuggestionContext {
    let hungry = 0;
    let thirsty = 0;
    for (const animal of this.animals.values()) {
      if ((animal.state.fed ?? 0) < 1) hungry++;
      if ((animal.state.watered ?? 0) < 1) thirsty++;
    }
    return {
      phase: this.director.currentPhase,
      weather: this.ctx.save.save.weather,
      position: this.player.position,
      indoors: this.player.isInsideHouse(),
      hungryAnimals: hungry,
      thirstyAnimals: thirsty,
      anchorPosition: (id) => this.interaction.anchorPosition(id),
      completed: this.ctx.save.save.completedToday,
    };
  }

  /** Adds a produced item to the inventory, respecting its stack limit. */
  private grantItem(item: string, count: number): void {
    const max = ITEMS_BY_ID.get(item)?.max ?? 99;
    this.ctx.save.update((data) => {
      data.inventory[item] = Math.min(max, (data.inventory[item] ?? 0) + count);
    });
    this.ctx.bus.emit('inventory:changed');
  }

  /** Pushes phase/weather state out to everything that cares. */
  private syncPhaseDependents(): void {
    const ctx = this.ctx;
    const phase = this.director.currentPhase;
    const weather = ctx.save.save.weather;

    ctx.audio.setPhase(phase);
    ctx.audio.setWeather(weather);
    this.weather.setWeather(weather);
    this.weather.setSeason(ctx.save.save.season);

    for (const parent of this.parents.values()) parent.setPhase(phase, weather);
    for (const animal of this.animals.values()) animal.setPhase(phase);
  }

  /* ------------------------------------------------------------------ */
  /* Day flow                                                            */
  /* ------------------------------------------------------------------ */

  private finishDay(): void {
    this.dayEnding = true;
    this.ui.setFade(true);
    this.ctx.audio.play('sleep');
    this.ctx.audio.playLullaby();

    window.setTimeout(() => {
      const summary = this.director.endDay();
      const screen = buildDayEndScreen(this.ctx, {
        day: summary.day,
        tasksCompleted: summary.tasksCompleted,
        tasksTotal: summary.tasksTotal,
        hearts: summary.hearts,
        discoveries: this.director.currentPlan.discoveries,
        weather: summary.weather,
        season: summary.season,
      }, () => {
        this.ui.pop('dayend');
        this.storybook.clear();
        this.startNextDay();
      }, this.storybook.pick(3).map((shot) => ({
        ...shot,
        caption: this.ctx.loc.t(ACTIVITIES_BY_ID.get(shot.activityId)?.titleKey ?? 'app.title'),
      })));
      this.ui.push(screen, 'dayend');
      this.ctx.audio.play('reward');
    }, 1800);
  }

  private startNextDay(): void {
    const ctx = this.ctx;
    const save = ctx.save.save;
    const previousSeason = this.director.currentPlan.season;
    const previousWeather = save.weather;

    // Overnight: animals rest, feed, refill.
    const nightRng = ctx.worldRng.fork(`night-${save.day}`);
    for (const animal of this.animals.values()) animal.advanceDay(nightRng);

    // Plants grow a little.
    ctx.save.update((data) => {
      for (const plant of data.plants) {
        plant.growth = Math.min(1, plant.growth + (plant.watered ? 0.3 : 0.12));
        plant.watered = false;
        plant.harvestable = plant.growth >= 1;
      }
    });

    this.director.beginDay();

    if (this.director.currentPlan.season !== previousSeason) {
      rebuildSeasonalContent(
        this.world,
        ctx.worldRng.fork(`season-${this.director.currentPlan.season}`),
        ctx.quality,
        this.director.currentPlan.season,
      );
    }

    this.syncPhaseDependents();
    this.seedDiscoveries();

    this.dayEnding = false;
    this.wakeInBed();
    this.ui.setFade(false);
    ctx.audio.play('wake');
    this.hud.refreshTasks();
    this.announceMorning(previousSeason, previousWeather);
  }

  /**
   * What is new this morning: a new season, or different weather, told once
   * the child is up. Seasons and first snow also leave a sticker, so they
   * become things to collect as well as things that happen.
   */
  private announceMorning(previousSeason: string, previousWeather: string): void {
    const ctx = this.ctx;
    const { season, weather } = ctx.save.save;
    const earned: string[] = [];
    ctx.save.update((data) => {
      const add = (id: string): void => {
        if (!data.stickers.includes(id)) {
          data.stickers.push(id);
          earned.push(id);
        }
      };
      if (weather === 'snow') add('firstsnow');
      if (weather === 'rain') add('rainyday');
      if (season !== 'summer') add(season);
    });

    const line =
      season !== previousSeason
        ? { key: `season.${season}`, icon: SEASON_ICON[season] ?? '🌿' }
        : weather !== previousWeather
          ? { key: `morning.${weather}`, icon: WEATHER_ICON[weather] ?? '☀️' }
          : null;

    window.setTimeout(() => {
      if (this.dayEnding) return;
      if (line) {
        this.hud.showToast(line.key, line.icon);
        this.hud.say(ctx.loc.t(line.key));
      }
      if (earned.length) {
        ctx.audio.play('sticker');
        ctx.bus.emit('ui:toast', { textKey: 'toast.sticker', icon: '⭐' });
      }
    }, 3200);
  }

  /**
   * Starts the morning beside the bed, then gets up on its own.
   *
   * Getting out of bed is not a chore to go and find: the child is standing
   * next to it, sleepy, framed by a camera already in the room, and a moment
   * later stretches and the day begins. Does nothing once today's wake-up has
   * happened, so resuming mid-morning leaves the child where the day put them.
   */
  private wakeInBed(): void {
    const wakeup = this.director.remainingToday.find((a) => a.id === 'wakeup');
    const bed = this.registry.get('bed');
    if (!wakeup || !bed) return;

    // The child turns back toward the bed they just climbed out of, and the
    // camera looks at them across it: the first shot of the day is a sleepy
    // face in their own bedroom, not the back of their head.
    const bedPoint = bed.node.getWorldPosition(new Vector3());
    const bedside = this.freeSpotNear(this.house.bedside(), bedPoint);
    const facing = Math.atan2(bedPoint.x - bedside.x, bedPoint.z - bedside.z);
    this.player.placeAt(bedside, facing);
    this.player.setExpression('sleepy');
    this.cameraRig.snapTo(this.player.position, this.player.height, facing, true);
    // Settle the camera and the ghosted walls now rather than over the next
    // half-second, so the first frame after the fade is already composed.
    this.cameraRig.update(this.player.position, this.player.height, this.world.terrain, 1 / 60);
    updateCutaways(this.world, this.player.position, this.cameraRig.camera.position, 10);

    window.setTimeout(() => {
      if (this.dayEnding || this.ui.modalCount > 0) return;
      if (!this.director.remainingToday.some((a) => a.id === 'wakeup')) return;
      this.interaction.tryStart(wakeup);
    }, 1400);
  }

  /**
   * The nearest point to `preferred` where the child fits, searched in rings.
   * Furniture moves about as the house is dressed, so a fixed offset from the
   * bed can land inside the bedside table. Prefers points away from `avoid`.
   */
  private freeSpotNear(preferred: Vector3, avoid: Vector3): Vector3 {
    const collision = this.world.collision;
    if (!collision.blocks(preferred.x, preferred.z, 0.3, 'animal')) return preferred;
    for (let ring = 1; ring <= 10; ring++) {
      const radius = ring * 0.2;
      let best: Vector3 | null = null;
      let bestDistance = -Infinity;
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const x = preferred.x + Math.sin(angle) * radius;
        const z = preferred.z + Math.cos(angle) * radius;
        if (collision.blocks(x, z, 0.3, 'animal')) continue;
        const fromBed = Math.hypot(x - avoid.x, z - avoid.z);
        if (fromBed > bestDistance) {
          bestDistance = fromBed;
          best = new Vector3(x, preferred.y, z);
        }
      }
      if (best) return best;
    }
    return preferred;
  }

  /**
   * Places today's discovery somewhere sensible. Finding one is incidental —
   * the child stumbles on it while doing something else, which is the point.
   */
  private seedDiscoveries(): void {
    this.discoveryTargets = [];
    const found = this.ctx.save.save.discoveries;

    for (const id of this.director.currentPlan.discoveries) {
      if (found.includes(id)) continue;
      const definition = DISCOVERIES_BY_ID.get(id);
      if (!definition) continue;
      const area = AREAS_BY_ID.get(definition.area);
      if (!area) continue;
      if (area.requiresPremium && !this.ctx.entitlements.isPremium) continue;

      const rng = this.ctx.worldRng.fork(`discovery-${id}-${this.ctx.save.save.day}`);
      const x = rng.range(area.bounds.minX, area.bounds.maxX);
      const z = rng.range(area.bounds.minZ, area.bounds.maxZ);
      this.discoveryTargets.push({
        id,
        position: new Vector3(x, this.world.terrain.heightAt(x, z), z),
        found: false,
      });
    }
  }

  private checkDiscoveries(): void {
    for (const target of this.discoveryTargets) {
      if (target.found) continue;
      if (this.player.position.distanceTo(target.position) > 3.5) continue;

      target.found = true;
      const definition = DISCOVERIES_BY_ID.get(target.id);
      this.ctx.save.update((data) => {
        if (!data.discoveries.includes(target.id)) data.discoveries.push(target.id);
        data.hearts += 1;
        if (!data.stickers.includes('explorer')) data.stickers.push('explorer');
      });
      this.ctx.audio.play('discovery');
      this.ctx.platform.haptic('success');
      this.player.setExpression('surprised');
      this.ctx.bus.emit('discovery:found', {
        id: target.id,
        category: definition?.category ?? 'place',
      });
      this.ctx.bus.emit('emote', { actor: 'child', emote: definition?.icon ?? '✨' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                             */
  /* ------------------------------------------------------------------ */

  private openTitle(fresh: boolean): void {
    const ctx = this.ctx;
    this.hud.setVisible(false);
    this.cameraRig.setCinematic(true);
    const screen = buildTitleScreen(
      ctx,
      { day: ctx.save.save.day, returning: !fresh },
      () => {
        void ctx.audio.start();
        this.ui.pop('title');
        this.cameraRig.setCinematic(false);
        if (fresh) {
          this.openCustomize();
        } else {
          this.blinkTo(() => this.wakeInBed());
        }
      },
    );
    this.ui.push(screen, 'title');
  }

  /**
   * A short fade to black, `during` runs in the dark, then back with the HUD.
   * For cuts the player should not see happen: moving the child to their bed.
   */
  private blinkTo(during: () => void): void {
    this.ui.setFade(true, true);
    window.setTimeout(() => {
      during();
      this.hud.setVisible(true);
      this.hud.refreshTasks();
      this.ui.setFade(false, true);
    }, 380);
  }

  /**
   * Getting dressed: the same creator in wardrobe mode, for what the child
   * wears only. Opened after the morning "get dressed" chore and from a new
   * hat or outfit's "Try it on!".
   */
  private openWardrobe(): void {
    const ctx = this.ctx;
    if (this.ui.has('wardrobe')) return;
    this.hud.setVisible(false);
    // Turn to face the camera where it already is rather than swinging the
    // camera round to the child's front: indoors, the front is often a wall,
    // and the current angle is known to have a clear view.
    const theta = this.cameraRig.orbitTheta;
    this.player.turnTo(theta);
    this.cameraRig.setPortrait(theta);
    const screen = buildCustomizeScreen(
      ctx,
      ctx.save.save.child,
      (next) => this.rebuildPlayer(next),
      (final) => {
        ctx.save.update((data) => {
          data.child = final;
        });
        void ctx.save.flush(true);
        this.ui.pop('wardrobe');
        this.cameraRig.setPortrait(null);
        this.hud.setVisible(true);
        ctx.bus.emit('emote', { actor: 'child', emote: '✨' });
      },
      'wardrobe',
    );
    this.ui.push(screen, 'wardrobe');
  }

  /**
   * Plays the next uncelebrated heart milestone, if the moment is right: not
   * mid-chore, not behind another panel, not while falling asleep. A farm
   * feature appears in the world first and the camera turns to it, then the
   * card follows, so the child sees the thing before being told about it.
   */
  private checkMilestones(): void {
    if (this.celebrating || this.dayEnding) return;
    if (this.activities.isRunning || this.runner.isRunning || this.ui.modalCount > 0 || !this.hud.isVisible) return;
    const save = this.ctx.save.save;
    const milestone = MILESTONES.find(
      (m) => save.hearts >= m.hearts && !save.milestonesSeen.includes(m.id),
    );
    if (!milestone) return;

    this.celebrating = true;
    this.ctx.save.update((data) => {
      data.milestonesSeen.push(milestone.id);
    });

    const reward = milestone.reward;
    let delay = 600;
    if (reward.kind === 'farm') {
      this.farmFeatures.sync(farmFeaturesAt(save.hearts));
      const where = this.farmFeatures.positionOf(reward.feature);
      if (where && !this.playerIndoors) {
        this.cameraRig.focusOn(where, 4.5);
        delay = 2200;
      }
    }

    window.setTimeout(() => {
      this.ctx.audio.play('discovery');
      this.hud.say(this.ctx.loc.t(`milestone.${milestone.id}`));
      const wearable = reward.kind === 'hat' || reward.kind === 'outfit';
      const screen = buildMilestoneScreen(this.ctx, milestone, {
        onTryOn: wearable
          ? () => {
              this.ui.pop('milestone');
              this.celebrating = false;
              this.ctx.save.update((data) => {
                if (reward.kind === 'hat') data.child.hat = reward.hat;
                if (reward.kind === 'outfit') data.child.outfit = reward.outfit;
              });
              this.rebuildPlayer(this.ctx.save.save.child);
              this.openWardrobe();
            }
          : undefined,
        onClose: () => {
          this.ui.pop('milestone');
          this.celebrating = false;
        },
      });
      this.ui.push(screen, 'milestone');
    }, delay);
  }

  private openCustomize(): void {
    const ctx = this.ctx;
    this.hud.setVisible(false);
    this.cameraRig.setPortrait(this.player.facingAngle);
    const screen = buildCustomizeScreen(
      ctx,
      ctx.save.save.child,
      (next) => {
        // Live preview: rebuild the body as the parent/child picks.
        this.rebuildPlayer(next);
      },
      (final) => {
        ctx.save.update((data) => {
          data.child = final;
          // Having chosen who they are, the child is no longer new: closing
          // the app during day 1 must not send them back to this screen.
          data.tutorialDone = true;
        });
        void ctx.save.flush(true);
        this.ui.pop('customize');
        this.cameraRig.setPortrait(null);
        this.director.beginDay();
        this.syncPhaseDependents();
        // The first day starts where every day does. The swap happens in a
        // blink so the child is never seen jumping from yard to bedroom.
        this.blinkTo(() => this.wakeInBed());
      },
    );
    this.ui.push(screen, 'customize');
  }

  private rebuildPlayer(appearance: import('../save/SaveSchema').CharacterAppearance): void {
    const position = this.player.position.clone();
    this.actorRoot.remove(this.player.group);
    const previousFootstep = this.player.onFootstep;
    this.player.dispose();

    this.player = new Player(appearance, this.world.terrain, position, this.world.collision);
    this.player.setNavGrid(this.world.nav);
    this.player.onFootstep = previousFootstep;
    this.actorRoot.add(this.player.group);

    // Systems hold a reference to the player; rebuild the ones that do.
    this.runner = new InteractionRunner(this.ctx, this.player);
    this.activities = new ActivitySystem(this.ctx, {
      player: this.player,
      animals: this.animals,
      parents: this.parents,
      world: this.world,
      camera: this.cameraRig,
    });
    this.interaction = new InteractionSystem(this.ctx, {
      player: this.player,
      cameraRig: this.cameraRig,
      activities: this.activities,
      director: this.director,
      world: this.world,
      animals: this.animals,
      parents: this.parents,
      registry: this.registry,
      runner: this.runner,
    });
    this.attachRoutines();

    // Rebind to the new player; the notices hold a direct reference.
    this.notices = new ChildNotices(
      this.player,
      this.animals,
      this.ctx.worldRng.fork('notices'),
      this.world.ambient.group,
    );
  }

  private openNatureBook(): void {
    const screen = buildNatureBookScreen(this.ctx, () => this.ui.pop('book'));
    this.ui.push(screen, 'book');
  }

  private openParentGate(): void {
    const screen = buildParentGateScreen(
      this.ctx,
      () => {
        this.ui.pop('gate');
        this.openParentArea();
      },
      () => this.ui.pop('gate'),
    );
    this.ui.push(screen, 'gate');
  }

  private openParentArea(): void {
    const ctx = this.ctx;
    const screen = buildParentAreaScreen(ctx, {
      appVersion: APP_VERSION,
      links: LINKS,
      onClose: () => this.ui.pop('parent'),
      onOpenStore: () => this.openStore(),
      onQualityChange: (tier) => {
        ctx.save.updateSettings((s) => {
          s.qualityOverride = tier;
        });
        this.applyQuality(tier ?? detectQualityTier(), null);
      },
      onLocaleChange: (locale) => {
        ctx.loc.setLocale(locale);
        // Rebuild the parent area so it is immediately in the new language.
        this.ui.pop('parent');
        this.openParentArea();
      },
      onUiScaleChange: (scale) => this.layout.setUserScale(scale),
      onResetProgress: () => {
        void (async () => {
          await ctx.save.resetProgress();
          window.location.reload();
        })();
      },
    });
    this.ui.push(screen, 'parent');
  }

  private async openStore(): Promise<void> {
    const ctx = this.ctx;
    const products = await ctx.entitlements
      .restore()
      .then(() => [])
      .catch(() => []);
    void products;

    const price = '€4.99';
    const screen = buildStoreScreen(ctx, price, {
      onClose: () => this.ui.pop('store'),
      onBuy: () => void this.runPurchase(),
      onRestore: () => void this.runRestore(),
    });
    this.ui.push(screen, 'store');
  }

  private async runPurchase(): Promise<void> {
    const ctx = this.ctx;
    const result = await ctx.entitlements.purchase(PRODUCT_FULL_GAME);
    switch (result.status) {
      case 'purchased':
      case 'restored':
        ctx.bus.emit('ui:toast', { textKey: 'store.owned', icon: '🎉' });
        ctx.audio.play('reward');
        this.ui.pop('store');
        break;
      case 'offline':
        ctx.bus.emit('ui:toast', { textKey: 'store.offline', icon: '📶' });
        break;
      case 'cancelled':
        break;
      default:
        ctx.bus.emit('ui:toast', { textKey: 'store.failed', icon: '🙂' });
        break;
    }
  }

  private async runRestore(): Promise<void> {
    const ctx = this.ctx;
    const results = await ctx.entitlements.restore();
    const restored = results.some((r) => r.status === 'restored' || r.status === 'purchased');
    ctx.bus.emit('ui:toast', {
      textKey: restored ? 'store.restored' : 'store.norestore',
      icon: restored ? '🎉' : '🙂',
    });
    if (restored) this.ui.pop('store');
  }

  /** Used by the DevStore so the confirm flow is real, not a stub. */
  confirmPurchase(productId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const screen = buildConfirmScreen(
        this.ctx,
        'store.title',
        `${this.ctx.loc.t('store.buy')} — ${productId}`,
        (confirmed) => {
          this.ui.pop('confirm');
          resolve(confirmed);
        },
      );
      this.ui.push(screen, 'confirm');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Quality                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * `reason` is set when the adaptive monitor asked for this, and carries the
   * numbers it decided on; a parent choosing a tier by hand passes null.
   */
  private applyQuality(
    tier: import('./DeviceProfile').QualityTier,
    reason: string | null,
  ): void {
    const ctx = this.ctx;
    if (reason !== null && ctx.save.settings.qualityOverride !== null) return;

    ctx.quality = qualityFor(tier);
    this.renderer.shadowMap.enabled = ctx.quality.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.weather.onQualityChanged(ctx.quality);
    this.onResize();

    // Vegetation density is baked into the instanced meshes, so rebuild them.
    rebuildSeasonalContent(
      this.world,
      ctx.worldRng.fork(`quality-${tier}`),
      ctx.quality,
      ctx.save.save.season,
    );

    if (reason !== null) {
      console.info(`[Quality] stepped down to "${tier}": ${reason}`);
    }
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const quality = this.ctx.quality;

    const dpr = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    this.renderer.setPixelRatio(dpr * quality.renderScale);
    this.renderer.setSize(width, height, false);

    this.cameraRig.setAspect(width / height);
    this.ctx.formFactor = this.layout.formFactor;
    this.cameraRig.applyFormFactor(this.ctx.formFactor);
  };

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.ctx.paused = true;
    this.activities.cancel();
    void this.ctx.audio.suspend();
    void this.ctx.save.flush();
  }

  resume(): void {
    this.ctx.paused = false;
    this.lastFrameTime = performance.now();
    void this.ctx.audio.resume();
  }

  private frame = (now: number): void => {
    this.rafHandle = requestAnimationFrame(this.frame);

    const rawDelta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (this.ctx.paused) return;

    // Clamp: a tab-switch or a GC pause must not teleport anyone.
    const dt = clamp(rawDelta / 1000, 0, 0.05);
    this.ctx.dt = dt;
    this.ctx.elapsed += dt;

    this.qualityMonitor.sample(rawDelta, now);
    this.update(dt);
    this.renderer.render(this.scene, this.cameraRig.camera);
    if (this.storybook.tick(dt)) this.storybook.capture(this.renderer.domElement);
  };

  private update(dt: number): void {
    const ctx = this.ctx;
    const save = ctx.save.save;

    /* --- camera input --- */
    if (this.ui.modalCount === 0) {
      this.cameraRig.orbit(this.input.orbitDelta.x, this.input.orbitDelta.y);
      this.cameraRig.zoom(this.input.zoomDelta);
    }
    this.input.endFrame();

    /* --- simulation --- */
    // Animals move, so they are fed to collision each frame rather than being
    // baked into the grid. A child should bump into a cow, not walk through it.
    _animalBodies.length = 0;
    for (const animal of this.animals.values()) {
      _animalBodies.push({
        x: animal.position.x,
        z: animal.position.z,
        r: animal.definition.kind === 'chicken' ? 0.28 : 0.62,
      });
    }
    this.world.collision.setDynamic(_animalBodies);

    this.registry.update(dt);
    this.house.update(dt, this.player.position);
    this.farmFeatures.update(dt);
    this.milestoneTimer -= dt;
    if (this.milestoneTimer <= 0) {
      this.milestoneTimer = 0.5;
      this.checkMilestones();
    }
    this.runner.update(dt);
    this.activities.update(dt);
    this.notices.update(dt, this.runner.isRunning || this.activities.isRunning);
    this.player.update(dt);

    const isNight = this.director.currentPhase === 'night';
    for (const animal of this.animals.values()) {
      animal.update(dt, this.player.position, isNight);
    }
    for (const parent of this.parents.values()) {
      parent.update(dt, this.player.position);
    }

    this.interaction.update();
    this.checkDiscoveries();

    /* --- presentation --- */
    this.cameraRig.update(this.player.position, this.player.height, this.world.terrain, dt);

    const hour = save.hour;
    this.world.sky.update(hour, this.weather.overcast, dt);
    this.world.sky.follow(this.player.position.x, this.player.position.z);
    this.weather.update(dt, hour, this.world.sky.sunDirection, this.cameraRig.camera.position);
    this.world.water.update(dt);

    // Wind strengthens with bad weather; grass and flowers react.
    this.windTime += dt;
    const gust = save.weather === 'rain' || save.weather === 'snow' ? 1.8 : 1.0;
    updateSharedUniforms(this.windTime, gust);

    // Butterflies, birds and chimney smoke. The same gust that bends the grass
    // leans the smoke plume downwind.
    this.world.ambient.update(dt, gust * 0.6);

    // The cutaway follows the camera as well as the child: walking along an
    // outside wall can put the camera indoors, and a screen full of roof
    // underside is both ugly and disorienting.
    const insideBuilding = updateCutaways(
      this.world,
      this.player.position,
      this.cameraRig.camera.position,
      dt,
    );
    // The interior lamp lights the room the child is standing in. It hangs high
    // and a little toward the camera: directly over the head it burnt the hair
    // and face out to a flat orange blob, and from the front it lights the face,
    // which is what the child is looking at.
    const camera = this.cameraRig.camera.position;
    const towardX = camera.x - this.player.position.x;
    const towardZ = camera.z - this.player.position.z;
    const toward = Math.hypot(towardX, towardZ) || 1;
    this.interiorLightTarget.set(
      this.player.position.x + (towardX / toward) * 1.2,
      this.player.position.y + 2.8,
      this.player.position.z + (towardZ / toward) * 1.2,
    );
    this.weather.setInterior(this.interiorLightTarget, insideBuilding ? 1 : 0, dt);
    // Same signal drives the camera: walls ghosting, the boom coming in, and
    // the orbit swinging round to the building's open face are one event, so
    // they can never disagree.
    this.cameraRig.setIndoor(insideBuilding, dt);
    this.playerIndoors = insideBuilding !== null;

    // Stream ambience by proximity.
    const distanceToStream = Math.abs(this.player.position.z - 68);
    ctx.audio.setWaterProximity(clamp(1 - distanceToStream / 26, 0, 1));
    ctx.audio.update(dt, hour);

    this.hud.update(dt);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('resize', this.onResize);

    this.input.dispose();
    this.layout.dispose();
    this.ui.dispose();
    // Holds bus subscriptions, so it has to let go of them explicitly.
    this.parentReactions.dispose();
    this.player.dispose();
    for (const animal of this.animals.values()) animal.rig.group.clear();
    for (const parent of this.parents.values()) parent.dispose();
    this.weather.dispose();
    this.world.sky.dispose();
    this.world.terrain.dispose();
    this.renderer.dispose();
  }

  /** Exposed for the dev console and the test harness. */
  get debug(): {
    ctx: GameContext;
    world: BuiltWorld;
    director: DayDirector;
    animals: Map<string, AnimalAgent>;
  } {
    return { ctx: this.ctx, world: this.world, director: this.director, animals: this.animals };
  }
}

/** Re-exported so main.ts can build the context without importing five files. */
export { EventBus, Rng, detectFormFactor, ANIMALS_BY_ID };
