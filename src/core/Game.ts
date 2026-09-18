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
import { buildHouseInteractions, type HouseState } from '../world/HouseInteractions';
import { buildFarmInteractions, type FarmState } from '../world/FarmInteractions';
import { AnimalAgent } from '../animals/AnimalAgent';
import { FamilyAgent } from '../characters/FamilyAgent';

import {
  animalsFor,
  ANIMALS_BY_ID,
  DISCOVERIES_BY_ID,
  AREAS_BY_ID,
  ITEMS_BY_ID,
} from '../content';
import type { AnimalSaveState } from '../save/SaveSchema';

import { UIRoot } from '../ui/UIRoot';
import { Hud } from '../ui/Hud';
import { ResponsiveLayout } from '../ui/ResponsiveLayout';
import {
  buildCustomizeScreen,
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
      (tier) => this.applyQuality(tier, true),
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

    /* --- the child --- */
    // Spawn in the open farmyard looking north up the valley. The porch would
    // be more literal, but it puts the follow camera inside the chalet on the
    // very first frame, which is the worst possible first impression.
    const spawn = this.world.anchors.get('yardcenter')?.position.clone() ?? new Vector3(0, 0, 9);
    this.player = new Player(save.child, this.world.terrain, spawn);
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
    this.house = buildHouseInteractions(
      this.registry,
      () => this.runner.carriedProp,
      () => this.player.isSeated,
      chalet.result.shellMaterial,
    );
    if (chalet) {
      this.house.group.position.copy(chalet.centre);
      this.scene.add(this.house.group);
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
      { director: this.director, interaction: this.interaction, camera: this.cameraRig },
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

    /* --- first launch: choose who you are --- */
    if (ctx.save.isFreshSave) {
      this.openCustomize();
    } else {
      this.director.beginDay();
      this.syncPhaseDependents();
    }

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

    ctx.bus.on('activity:completed', () => {
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
        this.startNextDay();
      });
      this.ui.push(screen, 'dayend');
      this.ctx.audio.play('reward');
    }, 1800);
  }

  private startNextDay(): void {
    const ctx = this.ctx;
    const save = ctx.save.save;
    const previousSeason = this.director.currentPlan.season;

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

    // Put the child back in bed, then let them get up.
    const bed = this.world.anchors.get('bed');
    if (bed) {
      this.player.position.copy(bed.position);
      this.player.group.position.copy(bed.position);
    }
    this.player.setExpression('sleepy');
    this.cameraRig.clearFocus();

    this.dayEnding = false;
    this.ui.setFade(false);
    ctx.audio.play('wake');
    this.hud.refreshTasks();
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

  private openCustomize(): void {
    const ctx = this.ctx;
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
        });
        void ctx.save.flush(true);
        this.ui.pop('customize');
        this.director.beginDay();
        this.syncPhaseDependents();
        this.hud.refreshTasks();
      },
    );
    this.ui.push(screen, 'customize');
  }

  private rebuildPlayer(appearance: import('../save/SaveSchema').CharacterAppearance): void {
    const position = this.player.position.clone();
    this.actorRoot.remove(this.player.group);
    const previousFootstep = this.player.onFootstep;
    this.player.dispose();

    this.player = new Player(appearance, this.world.terrain, position);
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
        this.applyQuality(tier ?? detectQualityTier(), false);
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

  private applyQuality(tier: import('./DeviceProfile').QualityTier, automatic: boolean): void {
    const ctx = this.ctx;
    if (automatic && ctx.save.settings.qualityOverride !== null) return;

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

    if (automatic) {
      console.info(`[Quality] stepped down to "${tier}" after sustained low frame rate`);
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
    this.registry.update(dt);
    this.house.update(dt, this.player.position);
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
    // The interior lamp sits a little above the child's head, in the room they
    // are actually standing in.
    this.interiorLightTarget.set(
      this.player.position.x,
      this.player.position.y + 2.0,
      this.player.position.z,
    );
    this.weather.setInterior(this.interiorLightTarget, insideBuilding ? 1 : 0, dt);
    // Same signal drives the camera: walls ghosting, the boom coming in, and
    // the orbit swinging round to the building's open face are one event, so
    // they can never disagree.
    this.cameraRig.setIndoor(insideBuilding, dt);

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
