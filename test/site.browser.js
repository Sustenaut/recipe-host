// Browser test of the site: builds test/fixtures/repo, serves it locally
// and clicks through every view in Chromium. Run with `npm run test:browser`
// (after `npx playwright install chromium` once).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { buildSite } from '../lib/build.js';
import { LOCAL_PAGE, serve } from '../lib/serve.js';

const FIXTURE = new URL('./fixtures/repo', import.meta.url).pathname;

let server;
let browser;
let page;
let base;
const errors = [];

before(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-site-'));
  const repo = buildSite(FIXTURE, out, { cards: false, page: LOCAL_PAGE, log: () => {} });
  assert.deepEqual(repo.errors, []);
  server = serve(out).listen(0);
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
});

after(async () => {
  await browser?.close();
  server?.close();
});

// A fresh load each time: going to the same URL with only the hash changed
// would keep the page's state.
async function visit(hash, selector) {
  await page.goto('about:blank');
  await page.goto(`${base}${hash}`);
  await page.waitForSelector(selector);
}

// Alpine updates the page on its next tick, so read until the value settles.
async function eventually(read, expected) {
  for (let i = 0; i < 20; i++) {
    try { assert.deepEqual(await read(), expected); return; } catch { await page.waitForTimeout(50); }
  }
  assert.deepEqual(await read(), expected);
}

// The request the site would open as a GitHub issue, read from the popup URL.
async function requestFrom(click) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
  const url = new URL(popup.url());
  await popup.close();
  assert.equal(url.origin + url.pathname, 'https://github.com/example/recipes/issues/new');
  return JSON.parse(url.searchParams.get('body').match(/```recipe-host\n(.*)\n```/)[1]);
}

test('the front page lists recipes by category and searches ingredients', async () => {
  await visit('#/', '.card');
  assert.deepEqual(await page.locator('main h2').allTextContents(), ['Sauces', 'Salads']);
  await page.fill('input[type=search]', 'jalap');
  await eventually(() => page.locator('.card:visible').count(), 0);
  await page.fill('input[type=search]', 'serrano');
  await eventually(() => page.locator('.card:visible strong').allTextContents(), ['Salsa verde']);
});

test('a recipe shows its facts, linked ingredients, swaps and notes', async () => {
  await visit('#/recipe/salsa-verde', '.steps li');
  assert.equal(await page.title(), 'Salsa verde · Test recipes');
  assert.match(await page.textContent('.facts'), /Makes about 500 ml.*Prep 10 min.*Adapted from example\.com/s);
  assert.match(await page.textContent('.alert'), /Draft method to check/);
  assert.equal(await page.getAttribute('a.ingredient-link >> text=scallions', 'href'), '#/ingredient/scallion');
  assert.match(await page.textContent('.swap'), /Swap Jalapeño: Use more roasted jalapeños\./);
  assert.equal(await page.getAttribute('a >> text=herb salad', 'href'), '#/recipe/herb-salad');
});

test('an unknown recipe says so', async () => {
  await visit('#/recipe/nope', 'main h1:visible');
  assert.equal(await page.textContent('main h1:visible'), 'Not found');
});

test('the ingredient list filters, and its menu requests a merge', async () => {
  await visit('#/ingredients', '.row');
  await page.fill('input[type=search]', 'onion');
  await eventually(() => page.locator('.row a span').allTextContents(), ['Onion', 'Scallion', 'Spring onion']);
  assert.equal(await page.isVisible('.menu'), false);
  await page.hover('.row:has-text("Spring onion")');
  await page.click('.row:has-text("Spring onion") .dots');
  await page.locator('.menu').waitFor();
  await page.click('.menu >> text=Merge into another ingredient');
  await page.fill('dialog[open] input[type=search]', 'scal');
  await page.click('dialog[open] .picker li:has-text("Scallion")');
  const request = await requestFrom(() => page.click('dialog[open] >> text=Request merge on GitHub'));
  assert.deepEqual(request, { action: 'merge-ingredients', from: 'spring-onion', into: 'scallion' });
});

test('the menu closes on an outside click and on Escape', async () => {
  await visit('#/ingredients', '.row');
  await page.click('.row:has-text("Basil") .dots');
  await page.locator('.menu').waitFor();
  await page.click('section .lede');
  await page.locator('.menu').waitFor({ state: 'hidden' });
  await page.click('.row:has-text("Basil") .dots');
  await page.locator('.menu').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.menu').waitFor({ state: 'hidden' });
});

test('the menu opens below its button, or above it near the bottom of the window', async (t) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  t.after(() => page.setViewportSize({ width: 1000, height: 800 }));
  await visit('#/ingredients', '.row');
  const place = async (row) => {
    const dots = row.locator('.dots');
    await dots.click();
    await page.locator('.menu').waitFor();
    await page.waitForTimeout(100);
    const [button, menu] = [await dots.boundingBox(), await page.locator('.menu').boundingBox()];
    await page.keyboard.press('Escape');
    await page.locator('.menu').waitFor({ state: 'hidden' });
    return menu.y >= button.y + button.height ? 'below' : menu.y + menu.height <= button.y ? 'above' : 'overlapping';
  };
  assert.equal(await place(page.locator('.row').first()), 'below');
  // Scroll the last row to the bottom of the window.
  const row = page.locator('.row').last();
  await row.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - window.innerHeight + 4));
  assert.equal(await place(row), 'above');
});

test('adding an ingredient refuses a name already on the list', async () => {
  await visit('#/ingredients', '.row');
  await page.click('text=Add ingredient');
  await page.fill('dialog[open] input >> nth=0', 'cilantro');
  await page.click('dialog[open] button[type=submit]');
  assert.equal(await page.textContent('dialog[open] .error'), 'Coriander is already on the list under that name.');
  await page.fill('dialog[open] input >> nth=0', 'Roasted onion');
  const request = await requestFrom(() => page.click('dialog[open] button[type=submit]'));
  assert.deepEqual(request, { action: 'add-ingredient', name: 'Roasted onion', aliases: [], notes: '' });
});

test('an ingredient page lists its uses and requests a substitution for the ticked recipes', async () => {
  await visit('#/ingredient/coriander', 'table');
  assert.deepEqual(await page.locator('tbody tr td:nth-child(2)').allTextContents(), ['Herb salad', 'Salsa verde']);
  assert.match(await page.locator('tbody tr').first().locator('td').nth(2).textContent(), /For the salad: 1 bunch coriander, leaves picked/);
  const submit = page.locator('form button[type=submit]');
  assert.equal(await submit.isDisabled(), true);
  await page.check('input[value=herb-salad]');
  assert.equal(await submit.isDisabled(), false);
  await submit.click();
  await page.fill('dialog[open] input[type=search]', 'onion');
  await page.click('dialog[open] .picker li:has-text("Onion") >> nth=0');
  await page.fill('dialog[open] textarea', 'Use the same weight of roasted onions.');
  const request = await requestFrom(() => page.click('dialog[open] >> text=Request on GitHub'));
  assert.deepEqual(request, { action: 'add-substitution', ingredient: 'coriander', recipes: ['herb-salad'], with: 'onion', note: 'Use the same weight of roasted onions.' });
});

test('no page logged an error', () => {
  assert.deepEqual(errors, []);
});
