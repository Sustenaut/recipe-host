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
import { pageHtml } from '../lib/page.js';
import { loadConfig } from '../lib/repo.js';
import { LOCAL_PAGE, serve } from '../lib/serve.js';

const FIXTURE = new URL('./fixtures/repo', import.meta.url).pathname;

let server;
let browser;
let page;
let base;
let out;
const errors = [];

before(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-site-'));
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
async function requestFrom(click, repo = 'example/recipes') {
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
  const url = new URL(popup.url());
  await popup.close();
  assert.equal(url.origin + url.pathname, `https://github.com/${repo}/issues/new`);
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

// A repository's published data, served the way GitHub and jsDelivr would:
// the fixture's build under the given repository and title, at `sha`, which
// GitHub reports as the newest commit unless `latest` says otherwise.
async function publish(repoName, title, sha = 'a'.repeat(40), latest = sha) {
  await page.route(`https://api.github.com/repos/${repoName}/commits/site`, (route) => route.fulfill({ body: latest }));
  await page.route(`https://cdn.jsdelivr.net/gh/${repoName}@${sha}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.split(`@${sha}/`)[1];
    if (file !== 'index.json') return route.fulfill({ path: path.join(out, file) });
    const index = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
    Object.assign(index.site, { repo: repoName, title, branch: 'main' });
    return route.fulfill({ json: index });
  });
}

test('?repo= shows another repository and sends its requests there', async () => {
  await publish('friend/cookbook', "Friend's cookbook");
  await visit('?repo=friend/cookbook#/recipe/salsa-verde', '.steps li');
  assert.equal(await page.textContent('.pure-menu-heading'), "Friend's cookbook");
  assert.equal(await page.title(), "Salsa verde · Friend's cookbook");
  assert.equal(await page.getAttribute('text=Source on GitHub', 'href'), 'https://github.com/friend/cookbook/blob/main/recipes/sauces/salsa-verde.md');
  assert.match(await page.textContent('.site-footer'), /Recipes from friend\/cookbook\s+· Back to the recipes from example\/recipes/);
  // Links inside the site keep the repository.
  await page.click('a.ingredient-link >> text=scallions');
  await page.waitForSelector('table');
  assert.equal(new URL(page.url()).search, '?repo=friend/cookbook');
  await page.check('input[value=salsa-verde]');
  await page.click('form button[type=submit]');
  await page.click('dialog[open] .picker li:has-text("Onion") >> nth=0');
  await page.fill('dialog[open] textarea', 'Roasted onions.');
  const request = await requestFrom(() => page.click('dialog[open] >> text=Request on GitHub'), 'friend/cookbook');
  assert.equal(request.action, 'add-substitution');
  await page.unrouteAll();
});

test('?repo= naming a repository with nothing published says so', async () => {
  const before = errors.length;
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://cdn.jsdelivr.net/gh/**', (route) => route.fulfill({ status: 404, body: '' }));
  await visit('?repo=nobody/nothing#/', 'article:has-text("Something went wrong")');
  assert.match(await page.textContent('article'), /Found no published recipes in nobody\/nothing\./);
  await page.unrouteAll();
  errors.splice(before); // the browser logs the 404s themselves
});

test('a page pinned to a commit shows it, then switches to a newer publish', async () => {
  const [old, newer] = ['a'.repeat(40), 'b'.repeat(40)];
  const pinned = pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${old}/` });
  fs.writeFileSync(path.join(out, 'pinned.html'), pinned);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await publish('example/recipes', 'Old recipes', old);
  await publish('example/recipes', 'New recipes', newer);
  // Registered last, so it answers first: GitHub reports the newer commit
  // only once the pinned one is showing.
  await page.route('https://api.github.com/repos/example/recipes/commits/site', async (route) => {
    await held;
    return route.fulfill({ body: newer });
  });
  await page.goto('about:blank');
  await page.goto(`${base}pinned.html#/`);
  await page.waitForSelector('.card');
  assert.equal(await page.textContent('.pure-menu-heading'), 'Old recipes');
  release();
  await eventually(() => page.textContent('.pure-menu-heading'), 'New recipes');
  await page.unrouteAll();
});

test('no page logged an error', () => {
  assert.deepEqual(errors, []);
});
