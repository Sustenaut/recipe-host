// Browser test of the site: builds test/fixtures/repo, serves it locally
// and clicks through every view in Chromium. Run with `npm run test:browser`
// (after `npx playwright install chromium` once). It also writes
// coverage/browser.lcov.info, the lines of app/app.js the clicks ran.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { buildSite } from '../lib/build.js';
import { pageHtml, sri } from '../lib/page.js';
import { loadConfig } from '../lib/repo.js';
import { LOCAL_PAGE, serve } from '../lib/serve.js';
import { MOCK_ACCOUNTS, mockLogin, mockPageSettings } from '../lib/mock-login.js';
import { v8ToLcov } from './v8-lcov.js';

const FIXTURE = new URL('./fixtures/repo', import.meta.url).pathname;

let server;
let browser;
let page;
let base;
let out;
const errors = [];
const loads = [];

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
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  // Each load's coverage is collected before the next one starts: a newer
  // Chromium may load the next page in a new renderer, which would lose it.
  for (const name of ['goto', 'reload']) {
    const go = page[name].bind(page);
    page[name] = async (...args) => {
      loads.push(...await page.coverage.stopJSCoverage());
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      return go(...args);
    };
  }
});

after(async () => {
  loads.push(...await page.coverage.stopJSCoverage());
  const app = loads.filter((e) => e.url.endsWith('/engine/app/app.js'));
  fs.mkdirSync('coverage', { recursive: true });
  fs.writeFileSync('coverage/browser.lcov.info', v8ToLcov(app, 'app/app.js'));
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

test('the recipe list searches ingredients and filters by type and meal', async () => {
  await visit('#/recipes', '.row');
  const titles = () => page.locator('.row a span').allTextContents();
  assert.deepEqual(await titles(), ['Herb salad', 'Salsa verde']);
  await page.fill('input[type=search]', 'jalap');
  await eventually(() => page.locator('.row').count(), 0);
  await page.fill('input[type=search]', 'serrano');
  await eventually(titles, ['Salsa verde']);
  await page.fill('input[type=search]', '');
  // Within a group any ticked chip matches; across groups, one of each.
  await page.click('.chip:has-text("Sauces")');
  await eventually(titles, ['Salsa verde']);
  await page.click('.chip:has-text("Salads")');
  await eventually(titles, ['Herb salad', 'Salsa verde']);
  await page.click('.chip:has-text("Lunch")');
  await eventually(titles, ['Herb salad']);
  assert.equal(await page.textContent('.chip:has-text("Dinner") small'), '0');
  await page.click('text=Clear filters');
  await eventually(titles, ['Herb salad', 'Salsa verde']);
});

test('the front page shows the favourites starred on the list, kept per repository', async () => {
  await visit('#/', '.empty');
  assert.match(await page.textContent('.empty'), /No favourites yet/);
  await page.click('.empty >> text=Browse all recipes');
  await page.waitForSelector('.row');
  await page.click('.row:has-text("Salsa verde") .star');
  await eventually(() => page.getAttribute('.row:has-text("Salsa verde") .star', 'aria-pressed'), 'true');
  await page.click('.row:has-text("Herb salad") .dots');
  await page.click('.menu >> text=Add to favourites');
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('recipe-host:favourites:example/recipes')));
  assert.deepEqual([saved.version, saved.favourites], [1, ['salsa-verde', 'herb-salad']]);
  // A fresh load reads them back.
  await visit('#/', '.card');
  assert.deepEqual(await page.locator('main h2').allTextContents(), ['Sauces', 'Salads']);
  await page.click('.chip:has-text("Lunch")');
  await eventually(() => page.locator('.card:visible strong').allTextContents(), ['Herb salad']);
  // Unstarring on the recipe's page takes it off the front page.
  await visit('#/recipe/herb-salad', '.steps li');
  await eventually(() => page.textContent('.favourite span'), 'Favourite');
  await page.click('.favourite');
  await eventually(() => page.textContent('.favourite span'), 'Add to favourites');
  await visit('#/', '.card');
  assert.deepEqual(await page.locator('.card strong').allTextContents(), ['Salsa verde']);
  // One key, named for the repository, so a ?repo= page keeps its own.
  assert.equal(await page.evaluate(() => localStorage.length), 1);
  await page.evaluate(() => localStorage.clear());
});

test('the header marks the current section and shows the logo', async () => {
  const selected = () => page.locator('.pure-menu-selected').textContent();
  await visit('#/', 'main h1:visible');
  assert.equal(await selected(), 'Home');
  await visit('#/recipe/salsa-verde', '.steps li');
  assert.equal(await selected(), 'Recipes');
  await visit('#/ingredient/coriander', 'table');
  assert.equal(await selected(), 'Ingredients');
  assert.equal(await page.locator('.logo').evaluate((img) => img.complete && img.naturalWidth > 0), true);
  assert.match(await page.getAttribute('link[rel=icon]', 'href'), /logo\.svg$/);
  // The links not selected are muted, never Pure's grey or its black for a
  // visited selected link.
  const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--muted').trim());
  const rgb = muted.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  for (const a of await page.locator('.pure-menu-item:not(.pure-menu-selected) a').all()) {
    assert.equal(await a.evaluate((el) => getComputedStyle(el).color), `rgb(${rgb.join(', ')})`);
  }
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
  assert.equal(await page.textContent('.pure-menu-heading span'), "Friend's cookbook");
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

test('?repo= naming a repository with nothing published says how to set it up', async () => {
  const before = errors.length;
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://cdn.jsdelivr.net/gh/**', (route) => route.fulfill({ status: 404, body: '' }));
  await visit('?repo=nobody/nothing#/', 'article:has-text("No recipes here yet")');
  const article = page.locator('article:has-text("No recipes here yet")');
  assert.match(await article.textContent(), /This repository \(nobody\/nothing\) has not yet been set up to host recipes\./);
  assert.equal(await article.locator('a', { hasText: 'nobody/nothing' }).getAttribute('href'), 'https://github.com/nobody/nothing');
  assert.equal(await article.locator('a', { hasText: 'these instructions' }).getAttribute('href'), 'https://github.com/Sustenaut/recipe-host#set-up-a-recipe-repository');
  assert.equal(await page.isVisible('article:has-text("Something went wrong")'), false);
  await page.unrouteAll();
  errors.splice(before); // the browser logs the 404s themselves
});

// The same fixture on a second origin, signing in through the mock
// Sustenaut sign-in and keeping favourites in the mock bucket.
test('a site with login asks readers to sign in and keeps their favourites in their bucket', async () => {
  const loginOut = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-login-'));
  buildSite(FIXTURE, loginOut, { cards: false, page: { ...LOCAL_PAGE, ...mockPageSettings('openid') }, log: () => {} });
  const mock = mockLogin();
  const loginServer = serve(loginOut, { mock }).listen(0);
  const site = `http://localhost:${loginServer.address().port}/`;
  const [anna, ben] = MOCK_ACCOUNTS;
  const saved = (account) => {
    const file = mock.bucket.get(`/mock/bucket/recipes/${account.sub}/favourites/example/recipes.json`);
    return file && JSON.parse(file.body).favourites;
  };
  const logged = errors.length;
  try {
    // Nothing shows before signing in, and the sign-in comes back to the
    // same address, ?repo= and view included.
    await page.goto('about:blank');
    await page.goto(`${site}?repo=example/recipes#/recipes`);
    await page.waitForSelector('.sign-in button');
    assert.equal(await page.isVisible('.row'), false);
    await page.click('.sign-in button');
    await page.click(`text=Sign in as ${anna.name}`);
    await page.waitForSelector('.row');
    assert.equal(page.url(), `${site}?repo=example/recipes#/recipes`);
    assert.equal(await page.textContent('.account .who'), anna.name);

    // A star is saved in Anna's file, not in the browser.
    await page.click('.row:has-text("Salsa verde") .star');
    await eventually(() => saved(anna), ['salsa-verde']);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await page.goto('about:blank');
    await page.goto(`${site}#/`);
    await page.waitForSelector('.card');
    assert.deepEqual(await page.locator('.card strong').allTextContents(), ['Salsa verde']);

    // Signing out goes back to the sign-in screen.
    await page.click('.account button');
    await page.waitForSelector('.sign-in button');

    // Ben starts from what this browser kept, and that moves to his file.
    await page.evaluate(() => localStorage.setItem('recipe-host:favourites:example/recipes', JSON.stringify({ version: 1, favourites: ['herb-salad'] })));
    await page.click('.sign-in button');
    await page.click(`text=Sign in as ${ben.name}`);
    await page.waitForSelector('.card');
    assert.deepEqual(await page.locator('.card strong').allTextContents(), ['Herb salad']);
    assert.deepEqual(saved(ben), ['herb-salad']);
    assert.deepEqual(saved(anna), ['salsa-verde']);
    await page.evaluate(() => localStorage.clear());

    // An expired sign-in is renewed with the refresh token, on opening the
    // page and before saving.
    mock.settings.accessSeconds = 1;
    await page.click('.account button');
    await page.click('.sign-in button');
    await page.click(`text=Sign in as ${ben.name}`);
    await page.waitForSelector('.card');
    await page.waitForTimeout(1500);
    await page.goto('about:blank');
    await page.goto(`${site}#/recipes`);
    await page.waitForSelector('.row');
    assert.equal(await page.textContent('.account .who'), ben.name);
    await page.waitForTimeout(1500);
    await page.click('.row:has-text("Salsa verde") .star');
    await eventually(() => saved(ben), ['herb-salad', 'salsa-verde']);
    mock.settings.accessSeconds = 300;
    await page.click('.account button');

    // A published page that needs sign-in asks nothing of GitHub or the
    // recipe data before it: only the page itself and its libraries load.
    const pinned = pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, ...mockPageSettings('openid'), data: 'https://cdn.jsdelivr.net/gh/example/recipes@abc/' });
    fs.writeFileSync(path.join(loginOut, 'pinned.html'), pinned);
    const asked = [];
    const record = (req) => asked.push(new URL(req.url()));
    await page.goto('about:blank');
    page.on('request', record);
    await page.goto(`${site}pinned.html#/`);
    await page.waitForSelector('.sign-in button');
    await page.waitForTimeout(300);
    page.off('request', record);
    assert.deepEqual(asked.filter((u) => u.origin !== site.slice(0, -1)).map((u) => u.href), []);
    assert.deepEqual(asked.filter((u) => !/^\/(pinned\.html|engine\/|vendor\/)/.test(u.pathname)).map((u) => u.href), []);
    await page.goto(`${site}#/`);
    await page.waitForSelector('.sign-in button');

    // Cancelling at the sign-in page says so.
    await page.waitForSelector('.sign-in button');
    await page.click('.sign-in button');
    await page.click('text=Cancel');
    await eventually(() => page.textContent('.sign-in .alert'), 'Sign-in was cancelled.');
    // The browser logs the 404 of a favourites file not yet written.
    assert.ok(errors.slice(logged).every((e) => e.includes('404')));
    errors.splice(logged);
  } finally {
    // Leave the page first, so nothing it still loads meets a closed server.
    await page.goto('about:blank');
    loginServer.close();
  }
});

// Signing in through a session service on the same site, like
// share.schryer.eu: its own cookie, and favourites it keeps itself.
test('a site with a session service signs readers in there and keeps their favourites there', async () => {
  const sessionOut = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-session-'));
  buildSite(FIXTURE, sessionOut, { cards: false, page: { ...LOCAL_PAGE, ...mockPageSettings('session') }, log: () => {} });
  const mock = mockLogin();
  const sessionServer = serve(sessionOut, { mock }).listen(0);
  const site = `http://localhost:${sessionServer.address().port}/`;
  const [anna, ben] = MOCK_ACCOUNTS;
  const kept = (account) => {
    const file = mock.kept.get(`${account.email}/favourites/example/recipes.json`);
    return file && JSON.parse(file).favourites;
  };
  const logged = errors.length;
  try {
    // No sign-in library: the service does the signing in.
    await page.goto('about:blank');
    await page.goto(`${site}?repo=example/recipes#/recipes`);
    await page.waitForSelector('.sign-in button');
    assert.equal(await page.evaluate(() => typeof window.oidc), 'undefined');
    await page.click('.sign-in button');
    await page.click(`text=Sign in as ${anna.name}`);
    await page.waitForSelector('.row');
    assert.equal(page.url(), `${site}?repo=example/recipes#/recipes`);
    assert.equal(await page.textContent('.account .who'), anna.name);

    await page.click('.row:has-text("Salsa verde") .star');
    await eventually(() => kept(anna), ['salsa-verde']);
    await page.goto('about:blank');
    await page.goto(`${site}#/`);
    await page.waitForSelector('.card');
    assert.deepEqual(await page.locator('.card strong').allTextContents(), ['Salsa verde']);

    await page.click('.account button');
    await page.waitForSelector('.sign-in button');
    await page.evaluate(() => localStorage.setItem('recipe-host:favourites:example/recipes', JSON.stringify({ version: 1, favourites: ['herb-salad'] })));
    await page.click('.sign-in button');
    await page.click(`text=Sign in as ${ben.name}`);
    await page.waitForSelector('.card');
    assert.deepEqual(await page.locator('.card strong').allTextContents(), ['Herb salad']);
    assert.deepEqual(kept(ben), ['herb-salad']);
    await page.evaluate(() => localStorage.clear());
    await page.click('.account button');
    await page.waitForSelector('.sign-in button');
    assert.deepEqual(errors.slice(logged).filter((e) => !/40[14]/.test(e)), []);
    errors.splice(logged);
  } finally {
    sessionServer.close();
  }
});

test('a pinned page lights the bell when a newer publish is out, and reloads into it', async () => {
  const [old, newer] = ['a'.repeat(40), 'b'.repeat(40)];
  const pinned = pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${old}/` });
  fs.writeFileSync(path.join(out, 'pinned.html'), pinned);
  await publish('example/recipes', 'Old recipes', old);
  await publish('example/recipes', 'New recipes', newer);
  // Registered last, so it answers first: GitHub reports the pinned commit
  // until `latest` changes.
  let latest = old;
  let asked = 0;
  await page.route('https://api.github.com/repos/example/recipes/commits/site', (route) => { asked += 1; return route.fulfill({ body: latest }); });
  await page.clock.install();
  await page.goto('about:blank');
  await page.goto(`${base}pinned.html#/recipe/salsa-verde`);
  await page.waitForSelector('.steps li');
  await page.locator('.bell').waitFor();
  assert.equal(await page.isVisible('.bell.active'), false);
  assert.equal(await page.isVisible('.reload'), false);
  // The bell shows before the check on opening has its answer: wait for
  // that answer, so it is the pinned commit and not the newer one.
  await eventually(() => asked > 0, true);
  latest = newer;
  await page.clock.runFor(30 * 60 * 1000);
  assert.equal(await page.isVisible('.bell.active'), false);
  await page.clock.runFor(30 * 60 * 1000);
  await page.locator('.bell.active').waitFor();
  assert.equal(await page.textContent('.pure-menu-heading span'), 'Old recipes');
  await page.click('.reload');
  await eventually(() => page.textContent('.pure-menu-heading span'), 'New recipes');
  await eventually(() => page.isVisible('.bell.active'), false);
  await eventually(() => page.isVisible('.reload'), false);
  await page.waitForSelector('.steps li');
  await page.unrouteAll();
});

// A publish at `sha` served byte for byte, as jsDelivr would: its
// index.json (titled `title`) and the built recipe files, whose hashes that
// index lists. `tamper` changes the file at a path on the way. Returns the
// hash of the index, as a deployed page names it.
async function publishExactly(sha, title, tamper = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  index.site.title = title;
  const json = JSON.stringify(index);
  await page.route(`https://cdn.jsdelivr.net/gh/example/recipes@${sha}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.split(`@${sha}/`)[1];
    const body = file === 'index.json' ? json : fs.readFileSync(path.join(out, file), 'utf8');
    return route.fulfill({ body: tamper[file] ? tamper[file](body) : body, headers: { 'access-control-allow-origin': '*' } });
  });
  return sri(json);
}

// The browser reports each file it refuses, and each request a test cut
// off; those are what the integrity tests expect.
function forgetRefusals() {
  errors.splice(0, errors.length, ...errors.filter((e) => !/integrity|valid digest|net::ERR_FAILED/.test(e)));
}

function deployChecked(sha, dataIntegrity) {
  const html = pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${sha}/`, dataIntegrity });
  fs.writeFileSync(path.join(out, 'checked.html'), html);
}

test('a page that names its data\'s hash refuses data that is not what was published', async () => {
  const sha = 'c'.repeat(40);
  const integrity = await publishExactly(sha, 'Checked recipes', { 'recipes/herb-salad.json': (body) => body.replace('Herb salad', 'Weed salad') });
  // The page checks for a newer publish on opening; there is none.
  await page.route('https://api.github.com/repos/example/recipes/commits/site', (route) => route.fulfill({ body: sha }));
  deployChecked(sha, integrity);
  await page.goto('about:blank');
  await page.goto(`${base}checked.html#/recipe/salsa-verde`);
  await page.waitForSelector('.steps li');
  assert.equal(await page.textContent('.pure-menu-heading span'), 'Checked recipes');
  // A recipe file that was changed on the way is refused.
  await page.goto(`${base}checked.html#/recipe/herb-salad`);
  await page.waitForSelector('text=Something went wrong');
  assert.equal(await page.isVisible('text=Weed salad'), false);
  // So is an index that is not the one the page names.
  deployChecked(sha, sri('something else'));
  await page.goto('about:blank');
  await page.goto(`${base}checked.html#/recipes`);
  await page.waitForSelector('text=Something went wrong');
  assert.equal(await page.isVisible('.row'), false);
  await page.unrouteAll();
  forgetRefusals();
});

test('a page that names its data\'s hash reloads only into data its host names', async () => {
  const [old, newer] = ['d'.repeat(40), 'e'.repeat(40)];
  deployChecked(old, await publishExactly(old, 'Old checked recipes'));
  const newIntegrity = await publishExactly(newer, 'New checked recipes');
  let latest = old;
  let asked = 0;
  await page.route('https://api.github.com/repos/example/recipes/commits/site', (route) => { asked += 1; return route.fulfill({ body: latest }); });
  await page.clock.install();
  await page.goto('about:blank');
  await page.goto(`${base}checked.html#/recipe/salsa-verde`);
  await page.waitForSelector('.steps li');
  await eventually(() => asked > 0, true);
  latest = newer;
  await page.clock.runFor(60 * 60 * 1000);
  await page.locator('.bell.active').waitFor();
  // GitHub has the newer publish, but the host still serves the old page:
  // nothing changes, and the bell stays lit.
  await page.click('.reload');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.pure-menu-heading span'), 'Old checked recipes');
  assert.equal(await page.isVisible('.bell.active'), true);
  assert.match(await page.textContent('.update-note'), /still being published/);
  // Nor while the host can't be reached.
  await page.route(`${base}checked.html`, (route) => route.abort());
  await page.click('.reload');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.pure-menu-heading span'), 'Old checked recipes');
  await page.unroute(`${base}checked.html`);
  // A newer page whose hash the data does not match: the data is refused
  // and the page keeps what it shows.
  deployChecked(newer, sri('something else'));
  await page.click('.reload');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.pure-menu-heading span'), 'Old checked recipes');
  assert.equal(await page.isVisible('.bell.active'), true);
  // Once the newer page is deployed, the reload takes its data and hash.
  deployChecked(newer, newIntegrity);
  await page.click('.reload');
  await eventually(() => page.textContent('.pure-menu-heading span'), 'New checked recipes');
  await eventually(() => page.isVisible('.bell.active'), false);
  await page.waitForSelector('.steps li');
  assert.equal(await page.isVisible('.update-note'), false);
  await page.unrouteAll();  forgetRefusals();
});

test('a newer publish that changes the page itself reloads the page', async () => {
  const [old, newer] = ['f'.repeat(40), '1'.repeat(40)];
  deployChecked(old, await publishExactly(old, 'Old checked recipes'));
  const newIntegrity = await publishExactly(newer, 'New checked recipes');
  let latest = old;
  let asked = 0;
  await page.route('https://api.github.com/repos/example/recipes/commits/site', (route) => { asked += 1; return route.fulfill({ body: latest }); });
  await page.clock.install();
  await page.goto('about:blank');
  await page.goto(`${base}checked.html#/recipe/salsa-verde`);
  await page.waitForSelector('.steps li');
  await eventually(() => asked > 0, true);
  latest = newer;
  await page.clock.runFor(60 * 60 * 1000);
  await page.locator('.bell.active').waitFor();
  // The newer page has other settings (here a new title), which swapping
  // the data alone would not bring in: the page reloads, onto the same view.
  const config = { ...loadConfig(FIXTURE), title: 'Renamed recipes' };
  const html = pageHtml(config, { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${newer}/`, dataIntegrity: newIntegrity });
  fs.writeFileSync(path.join(out, 'checked.html'), html);
  await page.evaluate(() => { window.beforeReload = true; });
  await page.click('.reload');
  await page.waitForFunction(() => !window.beforeReload);
  await page.waitForSelector('.steps li');
  assert.equal(await page.evaluate(() => window.RECIPE_HOST.title), 'Renamed recipes');
  assert.equal(await page.textContent('.pure-menu-heading span'), 'New checked recipes');
  await page.unrouteAll();
  forgetRefusals();
});

test('a page that reads the newest commit has no bell', async () => {
  await visit('#/recipes', '.row');
  assert.equal(await page.isVisible('.bell'), false);
});

test('no page logged an error', () => {
  assert.deepEqual(errors, []);
});
