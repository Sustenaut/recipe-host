// Building a recipe site: the suite's own Givens and Whens, which call
// lib/ on a recipe repository in pubtest's scratch directory (most often
// test/fixtures/kitchen, copied there). pubtest's steps check what came back.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BeforeAll, Given, Then, When } from '@cucumber/cucumber';
import { buildSite, cardData, typstPath } from '../lib/build.js';
import { ASSETS, INTEGRITY, pageHtml, sri } from '../lib/page.js';
import { linkRecipe } from '../lib/link.js';
import { parseIngredientLine, parseRecipe, plainText, slugify, splitSections } from '../lib/parse.js';
import { buildIndex, loadRepo } from '../lib/repo.js';
import { applyRequest, readRequest } from '../lib/requests.js';

const REPO = new URL('../', import.meta.url);

// `recipe-host` for pubtest's `the program under test is`: bin/recipe-host.js
// under that name, unless RECIPE_HOST_BIN_DIR names a build already.
BeforeAll(function () {
  if (process.env.RECIPE_HOST_BIN_DIR) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-bin-'));
  fs.symlinkSync(new URL('bin/recipe-host.js', REPO).pathname, path.join(dir, 'recipe-host'));
  process.env.RECIPE_HOST_BIN_DIR = dir;
});

const scratch = (world, rel = '.') => path.join(world.pubtest.directory, rel);
const read = (world, rel) => fs.readFileSync(scratch(world, rel), 'utf8');

When('I split the ingredient line {string}', async function (line) {
  await this.attempt(() => parseIngredientLine(line));
});

When('I parse the recipe {string}', async function (rel) {
  await this.attempt(() => parseRecipe(rel, read(this, rel)));
});

When('I parse the recipe {string}:', async function (rel, text) {
  await this.attempt(() => parseRecipe(rel, text));
});

When('I list the problems parsing the recipe {string} finds', async function (rel) {
  await this.attempt(() => {
    try {
      parseRecipe(rel, read(this, rel));
      return [];
    } catch (err) {
      return err.problems;
    }
  });
});

When('I load the recipe repository', async function () {
  await this.attempt(() => loadRepo(scratch(this)));
});

When('I build the index and read the ingredient {string}', async function (id) {
  await this.attempt(() => buildIndex(loadRepo(scratch(this))).ingredients.find((i) => i.id === id));
});

When('I build the index and read the recipe {string}', async function (slug) {
  await this.attempt(() => buildIndex(loadRepo(scratch(this))).recipes.find((r) => r.slug === slug));
});

When('I make the card of the recipe {string} for the site at {string}', async function (rel, url) {
  await this.attempt(() => cardData(parseRecipe(rel, read(this, rel)), { url }));
});

When('I read the request in the issue:', async function (body) {
  await this.attempt(() => readRequest(body));
});

When('I read the request in the issue, its lines ending in CRLF:', async function (body) {
  await this.attempt(() => readRequest(body.replaceAll('\n', '\r\n')));
});

When('I read the request in an issue of {int} lines {string}', async function (n, line) {
  await this.attempt(() => readRequest(`${line}\n`.repeat(n)));
});

const applying = (world, request) => applyRequest(scratch(world), JSON.parse(request));

Given('the request has been applied:', function (request) {
  applying(this, request);
});

When('I apply the request:', async function (request) {
  await this.attempt(() => applying(this, request));
});

When('I link the recipe {string}', async function (rel) {
  await this.attempt(() => linkRecipe(scratch(this), rel));
});

// The page: site settings, and pageHtml's options.
Given('the site settings:', function (config) {
  this.site = JSON.parse(config);
});

Given('the site settings of the recipe repository', function () {
  this.site = loadRepo(scratch(this)).config;
});

When('I write its page', async function () {
  await this.attempt(() => pageHtml(this.site));
});

When('I write its page with:', async function (options) {
  await this.attempt(() => pageHtml(this.site, JSON.parse(options)));
});

const TAGS = /<(script|link rel="stylesheet")[^>]* (src|href)="[^"]+"[^>]*>/g;

When('I list the scripts and stylesheets on its page', async function () {
  await this.attempt(() => pageHtml(this.site).match(TAGS));
});

When('I list the scripts and stylesheets on its page that name no integrity', async function () {
  await this.attempt(() => pageHtml(this.site).match(TAGS).filter((tag) => !/ integrity="sha384-[A-Za-z0-9+/]+={0,2}" crossorigin="anonymous"/.test(tag)));
});

When('I ask whether its page names the integrity of {string} as the file is', async function (file) {
  await this.attempt(() => pageHtml(this.site).includes(`${path.basename(file)}" integrity="${sri(fs.readFileSync(new URL(file, REPO)))}"`));
});

When('I hash each library the page loads, as node_modules has it', async function () {
  await this.attempt(() => Object.entries(ASSETS).flatMap(([key, [name, version, file]]) => {
    const installed = JSON.parse(fs.readFileSync(new URL(`node_modules/${name}/package.json`, REPO), 'utf8')).version;
    const hash = sri(fs.readFileSync(new URL(`node_modules/${name}/${file}`, REPO)));
    return [
      ...(installed === version ? [] : [`ASSETS.${key} pins ${name}@${version} but package.json installs ${installed}`]),
      ...(INTEGRITY[key] === hash ? [] : [`INTEGRITY.${key} must be '${hash}', the hash of ${name}@${version}/${file}`]),
    ];
  }));
});

Given('the site built from {string} into {string}, without cards', function (root, out) {
  buildSite(scratch(this, root), scratch(this, out), { cards: false, log: () => {} });
});

When('I hash each recipe file the index in {string} lists', async function (out) {
  await this.attempt(() => {
    const { integrity } = JSON.parse(read(this, path.join(out, 'index.json')));
    return {
      listed: Object.keys(integrity).sort(),
      mismatched: Object.entries(integrity).filter(([file, hash]) => sri(fs.readFileSync(scratch(this, path.join(out, file)))) !== hash).map(([file]) => file),
    };
  });
});

// typst: an environment value names the scratch directory as {scratch}, and
// so does the result; {unset} leaves the variable out, {empty} sets it empty.
When('I look for typst with:', async function (table) {
  await this.attempt(() => {
    const env = Object.fromEntries(table.rows().filter(([, v]) => v !== '{unset}')
      .map(([k, v]) => [k, v === '{empty}' ? '' : v.replaceAll('{scratch}', scratch(this))]));
    return typstPath(env)?.replace(path.resolve(scratch(this)), '{scratch}') ?? null;
  });
});

When('I reduce {string} to plain text', async function (markdown) {
  await this.attempt(() => plainText(markdown));
});

When('I slugify {string}', async function (name) {
  await this.attempt(() => slugify(name));
});

When('I split the Markdown into sections:', async function (markdown) {
  await this.attempt(() => splitSections(markdown).sections);
});

When('I run each Markdown pattern on hostile text 20000 long', async function () {
  const started = Date.now();
  await this.attempt(() => {
    plainText('[a]('.repeat(20000));
    parseIngredientLine('[a'.repeat(20000));
    splitSections(`## ${'#'.repeat(20000)}x`);
    try { readRequest('```recipe-host\n'.repeat(5000)); } catch { /* refused, as a scenario checks */ }
  });
  this.took = Date.now() - started;
});

Then('it took less than {int} ms', function (ms) {
  if (!(this.took < ms)) throw new Error(`it took ${this.took} ms`);
});

Then('the refusal is a {word}', function (name) {
  this.pubtest.refusalRead = true;
  const error = this.pubtest.refused?.error;
  if (error?.constructor?.name !== name) throw new Error(`the refusal is ${error?.constructor?.name ?? 'none'}: ${error?.message}`);
});
