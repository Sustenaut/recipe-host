// Browser test of the site: builds test/fixtures/repo, serves it locally
// and clicks through every view in Chromium. Run with `npm run test:browser`
// (after `npx playwright install chromium` once). It also writes
// coverage/browser.lcov.info, the lines of app/app.js the clicks ran.
//
// The suite's Givens set the site up (what GitHub and jsDelivr answer, the
// mock sign-in, the page's clock); its Whens are what a reader does, in
// order, and a few reads of what the browser holds, whose result pubtest's
// steps check; its Thens read the page, waiting a moment for Alpine to
// update it. One Chromium page serves every scenario, in this file's order.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { After, AfterAll, Before, BeforeAll, Given, Then, When } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { buildSite } from '../lib/build.js';
import { pageHtml, sri } from '../lib/page.js';
import { loadConfig } from '../lib/repo.js';
import { LOCAL_PAGE, serve } from '../lib/serve.js';
import { MOCK_ACCOUNTS, mockLogin, mockPageSettings } from '../lib/mock-login.js';
import { v8ToLcov } from './v8-lcov.js';

const FIXTURE = new URL('./fixtures/repo', import.meta.url).pathname;
const KEY = 'recipe-host:favourites:example/recipes';

let server;
let browser;
let page;
let base;
let out;
const errors = [];
const loads = [];

BeforeAll(async function () {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-site-'));
  const repo = buildSite(FIXTURE, out, { cards: false, page: LOCAL_PAGE, log: () => {} });
  if (repo.errors.length) throw new Error(`the fixture does not build: ${repo.errors.join('; ')}`);
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

AfterAll(async function () {
  loads.push(...await page.coverage.stopJSCoverage());
  const app = loads.filter((e) => e.url.endsWith('/engine/app/app.js'));
  fs.mkdirSync('coverage', { recursive: true });
  fs.writeFileSync('coverage/browser.lcov.info', v8ToLcov(app, 'app/app.js'));
  await browser?.close();
  server?.close();
});

// Each scenario reads the site at `this.site`, and may say which errors the
// browser logs in it are expected; those are dropped when it ends.
Before({ tags: '@site' }, function () {
  this.site = base;
  this.logged = errors.length;
  this.expected = [];
  this.ends = [];
});

After({ tags: '@site' }, async function () {
  for (const end of this.ends.reverse()) await end();
  await page.unrouteAll();
  if (this.expected.length) {
    const later = errors.splice(this.logged);
    errors.push(...later.filter((e) => !this.expected.some((re) => re.test(e))));
  }
});

// Alpine updates the page on its next tick, so read until the value settles.
async function eventually(read, ok) {
  let got;
  for (let i = 0; i < 20; i++) {
    got = await read();
    if (ok(got)) return got;
    await page.waitForTimeout(50);
  }
  return got;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const until = async (read, want) => { while (!same(await read(), want)) await page.waitForTimeout(50); };

// Only `*` is special, for anything, newlines too, as in pubtest's patterns.
const matches = (pattern, text) =>
  new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(text ?? '');

// ---- Givens: the site and what it reads from

Given('the browser keeps no favourites', async function () {
  await page.goto(this.site);
  await page.evaluate(() => localStorage.clear());
});

Given('the browser keeps the favourites {string}', async function (list) {
  await page.goto(this.site);
  await page.evaluate(([key, favourites]) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify({ version: 1, favourites })); }, [KEY, JSON.parse(list)]);
});

Given('the browser may log errors mentioning {string} here', function (text) {
  this.expected.push(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Given('the window is {int} by {int}', async function (width, height) {
  await page.setViewportSize({ width, height });
  this.ends.push(() => page.setViewportSize({ width: 1000, height: 800 }));
});

// A repository's published data, served the way GitHub and jsDelivr would:
// the fixture's build under the given repository and title, at `sha`, which
// GitHub reports as the newest commit.
async function publish(repoName, title, sha) {
  await page.route(`https://cdn.jsdelivr.net/gh/${repoName}@${sha}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.split(`@${sha}/`)[1];
    if (file !== 'index.json') return route.fulfill({ path: path.join(out, file) });
    const index = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
    Object.assign(index.site, { repo: repoName, title, branch: 'main' });
    return route.fulfill({ json: index });
  });
}

Given('{string} has published the fixture as {string}', async function (repoName, title) {
  const sha = 'a'.repeat(40);
  await page.route(`https://api.github.com/repos/${repoName}/commits/site`, (route) => route.fulfill({ body: sha }));
  await publish(repoName, title, sha);
});

Given('{string} has published the fixture as {string} at {string}', async function (repoName, title, sha) {
  await publish(repoName, title, sha);
});

// What GitHub reports as the newest publish, which a later step may change;
// the scenario counts how often the page asked.
Given('GitHub reports {string} as the newest publish', async function (sha) {
  this.latest = sha;
  this.asked = 0;
  await page.route('https://api.github.com/repos/example/recipes/commits/site', (route) => { this.asked += 1; return route.fulfill({ body: this.latest }); });
});

Given('GitHub and jsDelivr know nothing', async function () {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://cdn.jsdelivr.net/gh/**', (route) => route.fulfill({ status: 404, body: '' }));
});

Given('the site has a page {string} pinned to the commit {string}', function (name, sha) {
  fs.writeFileSync(path.join(out, name), pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${sha}/` }));
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

function deployChecked(sha, dataIntegrity, config = loadConfig(FIXTURE)) {
  fs.writeFileSync(path.join(out, 'checked.html'), pageHtml(config, { ...LOCAL_PAGE, data: `https://cdn.jsdelivr.net/gh/example/recipes@${sha}/`, dataIntegrity }));
}

Given('jsDelivr serves the publish {string} titled {string} byte for byte', async function (sha, title) {
  (this.integrity ??= {})[sha] = await publishExactly(sha, title);
});

Given('jsDelivr serves the publish {string} titled {string} with {string} changed from {string} to {string}', async function (sha, title, file, from, to) {
  (this.integrity ??= {})[sha] = await publishExactly(sha, title, { [file]: (body) => body.replace(from, to) });
});

// checked.html: a page that reads one publish and names its data's hash.
Given('the host serves a page that reads the publish {string} and names its hash', function (sha) {
  deployChecked(sha, this.integrity[sha]);
});

Given('the host serves a page that reads the publish {string} and names another hash', function (sha) {
  deployChecked(sha, sri('something else'));
});

Given('the page\'s clock is a test clock', async function () {
  await page.clock.install();
});

// The fixture on a second origin, signing in through the mock (lib/mock-login.js):
// "OpenID Connect" keeps favourites in the mock's bucket, "a session service" in the service.
Given('the site signs in through the mock with {word}', async function (way) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `recipe-host-${way}-`));
  buildSite(FIXTURE, dir, { cards: false, page: { ...LOCAL_PAGE, ...mockPageSettings(way) }, log: () => {} });
  this.mock = mockLogin();
  this.siteDir = dir;
  const own = serve(dir, { mock: this.mock }).listen(0);
  this.site = `http://localhost:${own.address().port}/`;
  // Leave the page first, so nothing it still loads meets a closed server.
  this.ends.push(async () => { await page.goto('about:blank'); own.close(); });
});

Given('the mock\'s sign-in lasts {int} second(s)', function (seconds) {
  this.mock.settings.accessSeconds = seconds;
});

Given('the site has a page {string} that needs sign-in and is pinned to one commit', function (name) {
  fs.writeFileSync(path.join(this.siteDir, name), pageHtml(loadConfig(FIXTURE), { ...LOCAL_PAGE, ...mockPageSettings('openid'), data: 'https://cdn.jsdelivr.net/gh/example/recipes@abc/' }));
});

// ---- Whens: what a reader does. Defined once, they read as a Given too.

When('I open {string}', async function (address) {
  await page.goto('about:blank');
  await page.goto(`${this.site}${address}`);
});

When('I open {string}, once {string} shows', async function (address, selector) {
  // A fresh load each time: going to the same URL with only the hash changed
  // would keep the page's state.
  await page.goto('about:blank');
  await page.goto(`${this.site}${address}`);
  await page.waitForSelector(selector);
});

When('I go to {string} on the same page, once {string} shows', async function (address, selector) {
  await page.goto(`${this.site}${address}`);
  await page.waitForSelector(selector);
});

When('I click {string}', async function (selector) {
  await page.click(selector);
});

When('I type {string} into {string}', async function (text, selector) {
  await page.fill(selector, text);
});

When('I clear {string}', async function (selector) {
  await page.fill(selector, '');
});

When('I tick {string}', async function (selector) {
  await page.check(selector);
});

When('I hover over {string}', async function (selector) {
  await page.hover(selector);
});

When('I press {string}', async function (key) {
  await page.keyboard.press(key);
});

When('I wait until {string} shows', async function (selector) {
  await page.locator(selector).first().waitFor();
});

When('I wait until {string} hides', async function (selector) {
  await page.locator(selector).first().waitFor({ state: 'hidden' });
});

When('I wait {int} ms', async function (ms) {
  await page.waitForTimeout(ms);
});

When('I sign in as {string}', async function (name) {
  await page.click('.sign-in button');
  await page.click(`text=Sign in as ${name}`);
});

When('I sign out', async function () {
  await page.click('.account button');
});

When('the page has asked GitHub for the newest publish', async function () {
  await until(() => this.asked > 0, true);
});

When('GitHub reports {string} as the newest publish from now on', function (sha) {
  this.latest = sha;
});

When('{int} minutes pass on the page\'s clock', async function (minutes) {
  await page.clock.runFor(minutes * 60 * 1000);
});

When('the host serves the page for the publish {string} under the title {string}', function (sha, title) {
  deployChecked(sha, this.integrity[sha], { ...loadConfig(FIXTURE), title });
});

When('the host can\'t be reached for {string}', async function (name) {
  await page.route(`${this.site}${name}`, (route) => route.abort());
  this.expected.push(/net::ERR_FAILED/);
});

When('the host can be reached for {string} again', async function (name) {
  await page.unroute(`${this.site}${name}`);
});

When('I click {string}, which reloads the page', async function (selector) {
  await page.evaluate(() => { window.beforeReload = true; });
  await page.click(selector);
  await page.waitForFunction(() => !window.beforeReload);
});

// The request the site would open as a GitHub issue, read from the popup URL.
When('I click {string}, which opens a GitHub issue', async function (selector) {
  await this.attempt(async () => {
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click(selector)]);
    const url = new URL(popup.url());
    await popup.close();
    return { issue: url.origin + url.pathname, request: JSON.parse(url.searchParams.get('body').match(/```recipe-host\n(.*)\n```/)[1]) };
  });
});

// ---- Reads, at the end of a When: their result is pubtest's to check.

When('I read what the browser keeps for example\\/recipes', async function () {
  await this.attempt(async () => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), KEY)));
});

When('I count the keys the browser keeps', async function () {
  await this.attempt(() => page.evaluate(() => localStorage.length));
});

When('I read the page\'s address', async function () {
  await this.attempt(() => page.url().replace(this.site, '/'));
});

When('I ask whether {string} is disabled', async function (selector) {
  await this.attempt(() => page.locator(selector).isDisabled());
});

When('I ask whether the image {string} has loaded', async function (selector) {
  await this.attempt(() => page.locator(selector).evaluate((img) => img.complete && img.naturalWidth > 0));
});

When('I evaluate {string} on the page', async function (expression) {
  await this.attempt(() => page.evaluate(expression));
});

// The links not selected are muted, never Pure's grey or its black for a
// visited selected link: the colours of those that are not --color-muted.
When('I list the colours of the menu\'s links not selected that are not the theme\'s muted colour', async function () {
  await this.attempt(async () => {
    const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-muted').trim());
    const rgb = `rgb(${muted.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16)).join(', ')})`;
    const colours = [];
    for (const a of await page.locator('.pure-menu-item:not(.pure-menu-selected) a').all()) colours.push(await a.evaluate((el) => getComputedStyle(el).color));
    return colours.length ? colours.filter((c) => c !== rgb) : ['no links'];
  });
});

// Where the menu of a row opens: below its button, above it, or overlapping.
async function place(row) {
  const dots = row.locator('.dots');
  await dots.click();
  await page.locator('.menu').waitFor();
  await page.waitForTimeout(100);
  const [button, menu] = [await dots.boundingBox(), await page.locator('.menu').boundingBox()];
  await page.keyboard.press('Escape');
  await page.locator('.menu').waitFor({ state: 'hidden' });
  return menu.y >= button.y + button.height ? 'below' : menu.y + menu.height <= button.y ? 'above' : 'overlapping';
}

When('I open the menu of the first row', async function () {
  await this.attempt(() => place(page.locator('.row').first()));
});

When('I open the menu of the last row, scrolled to the bottom of the window', async function () {
  await this.attempt(async () => {
    const row = page.locator('.row').last();
    await row.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - window.innerHeight + 4));
    return place(row);
  });
});

When('I read the favourites the mock keeps for {string}', async function (name) {
  await this.attempt(async () => {
    const account = MOCK_ACCOUNTS.find((a) => a.name === name);
    const read = () => {
      const file = this.mock.bucket.get(`/mock/bucket/recipes/${account.sub}/favourites/example/recipes.json`)
        ?? this.mock.kept.get(`${account.email}/favourites/example/recipes.json`);
      const body = typeof file === 'string' ? file : file?.body;
      return body ? JSON.parse(body).favourites : null;
    };
    // Saved after the click, so wait a moment for it to change.
    const before = read();
    return eventually(read, (now) => !same(now, before));
  });
});

When('I read the favourites the mock keeps for {string} now', async function (name) {
  await this.attempt(() => {
    const account = MOCK_ACCOUNTS.find((a) => a.name === name);
    const file = this.mock.bucket.get(`/mock/bucket/recipes/${account.sub}/favourites/example/recipes.json`)
      ?? this.mock.kept.get(`${account.email}/favourites/example/recipes.json`);
    const body = typeof file === 'string' ? file : file?.body;
    return body ? JSON.parse(body).favourites : null;
  });
});

// The addresses a page asks for while it opens, beyond the site's own page,
// its app and its libraries.
When('I list what opening {string} asks for beyond the site\'s page, app and libraries', async function (address) {
  await this.attempt(async () => {
    const asked = [];
    const record = (req) => asked.push(new URL(req.url()));
    await page.goto('about:blank');
    page.on('request', record);
    await page.goto(`${this.site}${address}`);
    await page.waitForSelector('.sign-in button');
    await page.waitForTimeout(300);
    page.off('request', record);
    const own = this.site.slice(0, -1);
    return asked.filter((u) => u.origin !== own || !/^\/(pinned\.html|engine\/|vendor\/)/.test(u.pathname)).map((u) => u.href);
  });
});

When('I gather the errors every page logged', async function () {
  await this.attempt(() => [...errors]);
});

// ---- Thens: the page, read until it settles.

const text = (selector) => page.locator(selector).first().textContent();
const fail = (what, got) => { throw new Error(`${what}: ${JSON.stringify(got)}`); };

Then('the page\'s {string} reads {string}', async function (selector, want) {
  const got = await eventually(() => text(selector), (t) => t === want);
  if (got !== want) fail(`${selector} reads`, got);
});

Then('the page\'s {string} includes {string}', async function (selector, want) {
  const got = await eventually(() => text(selector), (t) => t?.includes(want));
  if (!got?.includes(want)) fail(`${selector} reads`, got);
});

Then('the page\'s {string} matches {string}', async function (selector, pattern) {
  const got = await eventually(() => text(selector), (t) => matches(pattern, t));
  if (!matches(pattern, got)) fail(`${selector} reads`, got);
});

Then('the page\'s {string} lists {string}', async function (selector, list) {
  const want = JSON.parse(list);
  const got = await eventually(() => page.locator(selector).allTextContents(), (t) => same(t, want));
  if (!same(got, want)) fail(`${selector} lists`, got);
});

Then('the page shows {string}', async function (selector) {
  if (!(await eventually(() => page.isVisible(selector), Boolean))) fail(`${selector} does not show`, selector);
});

Then('the page does not show {string}', async function (selector) {
  if (await eventually(() => page.isVisible(selector), (v) => !v)) fail(`${selector} shows`, selector);
});

Then('the page\'s {string} has {string} set to {string}', async function (selector, name, want) {
  const got = await eventually(() => page.getAttribute(selector, name), (v) => v === want);
  if (got !== want) fail(`${selector}'s ${name} is`, got);
});

Then('the page\'s {string} has {string} matching {string}', async function (selector, name, pattern) {
  const got = await eventually(() => page.getAttribute(selector, name), (v) => matches(pattern, v));
  if (!matches(pattern, got)) fail(`${selector}'s ${name} is`, got);
});

Given('the browser may log any error here', function () {
  this.expected.push(/.*/s);
});
