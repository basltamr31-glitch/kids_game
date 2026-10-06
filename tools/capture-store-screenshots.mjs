#!/usr/bin/env node
/**
 * Captures store screenshots from the running game.
 *
 *   npm run dev                                  # in one terminal
 *   node tools/capture-store-screenshots.mjs     # in another
 *
 * Options:
 *   --url  http://localhost:5173   the dev server (the __lad handle is dev-only)
 *   --out  store/screenshots       output folder
 *
 * Requires Playwright (`npm i -D playwright` or a global install). Run it on a
 * machine with a real GPU: software rendering works but is slow and looks
 * flatter than a device. Every shot is a real frame of the game with the real
 * UI; nothing is composited, so the listing never promises what the game does
 * not show.
 *
 * Sizes follow Google Play's landscape requirements: phone 16:9, and 7" and
 * 10" tablets at 16:10.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const URL = args.url ?? 'http://localhost:5173';
const OUT = args.out ?? 'store/screenshots';

const SIZES = [
  { name: 'phone', width: 1920, height: 1080, scale: 1 },
  { name: 'tablet-7', width: 1920, height: 1200, scale: 1 },
  { name: 'tablet-10', width: 2560, height: 1600, scale: 1 },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright');
  process.exit(1);
}

const game = (page, fn, arg) => page.evaluate(fn, arg);
const settle = (page, ms = 2500) => page.waitForTimeout(ms);

/** Each scene sets the game up through the dev handle and returns when framed. */
const SCENES = [
  {
    name: '01-title',
    async run(page) {
      await settle(page, 5000);
    },
  },
  {
    name: '02-who-are-you',
    async run(page) {
      await page.locator('.title__play').click({ force: true });
      await settle(page, 3000);
    },
  },
  {
    name: '03-good-morning',
    async run(page) {
      await page.locator('.btn--primary').first().click({ force: true });
      await settle(page, 6000);
    },
  },
  {
    name: '04-farmyard',
    async run(page) {
      await game(page, () => {
        const g = window.__lad.game;
        const V = g.player.position.constructor;
        g.activities.cancel();
        g.ctx.save.update((d) => {
          d.hearts = 60;
          d.child.hat = 1;
          d.milestonesSeen = ['strawhat', 'swing', 'tealoutfit', 'bench'];
        });
        g.rebuildPlayer(g.ctx.save.save.child);
        g.farmFeatures.sync(['swing', 'bench']);
        // The open yard, facing the camera, with the meadow and the
        // mountains behind.
        g.player.placeAt(new V(0, 0, 9), Math.PI);
        g.cameraRig.snapTo(g.player.position, g.player.height, Math.PI, false);
        g.cameraRig.zoom(-6);
        // Past the morning routine, so the list shows farm jobs.
        g.ctx.save.update((d) => {
          for (const id of ['wakeup', 'getdressed', 'breakfast']) {
            if (!d.completedToday.includes(id)) d.completedToday.push(id);
          }
        });
        g.hud.refreshTasks();
      });
      await settle(page, 4000);
    },
  },
  {
    name: '05-album',
    async run(page) {
      await game(page, () => {
        const g = window.__lad.game;
        g.ctx.save.update((d) => {
          d.discoveries = ['butterfly', 'viewpoint'];
          d.stickers = ['firstday', 'helper', 'animalfriend'];
        });
      });
      await page.locator('.hud__topright .btn--icon').first().click({ force: true });
      await settle(page, 1500);
      await page.locator('.book__tab').nth(2).click({ force: true });
      await settle(page, 800);
    },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
  });
  const page = await context.newPage();
  // A clean first launch every time, in the language asked for.
  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL);
  const dir = join(OUT, size.name);
  await mkdir(dir, { recursive: true });
  for (const scene of SCENES) {
    await scene.run(page);
    await page.screenshot({ path: join(dir, `${scene.name}.png`) });
    console.log(`${size.name}/${scene.name}.png`);
  }
  await context.close();
}
await browser.close();
