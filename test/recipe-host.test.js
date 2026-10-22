import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cardData, typstPath } from '../lib/build.js';
import { ASSETS, INTEGRITY, pageHtml, sri } from '../lib/page.js';
import { linkRecipe } from '../lib/link.js';
import { parseIngredientLine, parseRecipe, parseIngredient, plainText, slugify, splitSections } from '../lib/parse.js';
import { buildIndex, loadRepo } from '../lib/repo.js';
import { applyRequest, readRequest, RequestError } from '../lib/requests.js';

const RECIPE = `---
title: Salsa verde
subtitle: Charred tomatillo and chilli salsa
tags: [sauce, mexican]
date: 2026-10-19
makes: about 500 ml
prep: 10 min
---

> [!NOTE]
> **Draft method for David to check.**

Char the vegetables properly.

## Ingredients

- 2 [serrano chillies](/ingredients/serrano-chilli.md), stems removed
- 6 [scallions](/ingredients/scallion.md)
- 1 bunch [cilantro](/ingredients/coriander.md) with stems,
  roughly chopped

## Method

1. **Char the vegetables.** Heat the oil until it shimmers.
2. **Blend.** Blend until smooth.

## Notes

- Keeps for a week.
`;

const SALAD = `---
title: Herb salad
subtitle: Leaves and herbs
tags: [salad]
date: 2026-10-19
serves: 2
---

## Ingredients

### For the salad

- 1 bunch [coriander](/ingredients/coriander.md), leaves picked
- 2 [spring onions](/ingredients/spring-onion.md), sliced

## Method

1. Toss.
`;

function ing(name, extra = '') {
  return `---\nname: ${name}\n${extra}---\n`;
}

function makeRepo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-host-test-'));
  const all = {
    'recipes/sauces/salsa-verde.md': RECIPE,
    'recipes/salads/herb-salad.md': SALAD,
    'ingredients/serrano-chilli.md': ing('Serrano chilli', 'aliases: [serrano]\n'),
    'ingredients/jalapeno.md': ing('Jalapeño'),
    'ingredients/scallion.md': ing('Scallion', 'aliases: [green onion]\n'),
    'ingredients/spring-onion.md': `---\nname: Spring onion\n---\n\nThe same plant as a scallion.\n`,
    'ingredients/coriander.md': ing('Coriander', 'aliases: [cilantro]\n'),
    'ingredients/onion.md': ing('Onion'),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('an ingredient line splits into quantity, references and preparation', () => {
  const line = parseIngredientLine('6 cloves [garlic](/ingredients/garlic.md), minced');
  assert.deepEqual(line.refs, [{ id: 'garlic', label: 'garlic' }]);
  assert.equal(line.quantity, '6 cloves');
  assert.equal(line.preparation, 'minced');
  assert.equal(line.text, '6 cloves garlic, minced');
});

test('a recipe parses into facts, ingredient groups and named steps', () => {
  const r = parseRecipe('recipes/sauces/salsa-verde.md', RECIPE);
  assert.equal(r.slug, 'salsa-verde');
  assert.equal(r.category, 'sauces');
  assert.deepEqual(r.facts, { makes: 'about 500 ml', prep: '10 min' });
  assert.equal(r.ingredientGroups[0].items.length, 3);
  assert.equal(r.ingredientGroups[0].items[2].preparation, 'with stems, roughly chopped');
  assert.deepEqual(r.steps.map((s) => s.name), ['Char the vegetables', 'Blend']);
});

test('a recipe without links, servings or a method reports every problem', () => {
  const bad = '---\ntitle: X\nsubtitle: Y\ntags: [a]\ndate: 2026-10-19\n---\n\n## Ingredients\n\n- 2 eggs\n';
  assert.throws(() => parseRecipe('recipes/x/bad.md', bad), (err) => {
    assert.equal(err.problems.length, 3);
    assert.match(err.message, /serves` or `makes`/);
    assert.match(err.message, /links no ingredient/);
    assert.match(err.message, /no `## Method`/);
    return true;
  });
});

test('a link to an ingredient without a file is an error', () => {
  const root = makeRepo({ 'ingredients/coriander.md': null });
  const repo = loadRepo(root);
  assert.equal(repo.errors.length, 2);
  assert.match(repo.errors[0], /links the ingredient "coriander", which has no file/);
});

test('an unused ingredient is a warning, not an error', () => {
  const repo = loadRepo(makeRepo());
  assert.deepEqual(repo.errors, []);
  assert.deepEqual(repo.warnings, ['ingredients/jalapeno.md: no recipe uses "Jalapeño" yet', 'ingredients/onion.md: no recipe uses "Onion" yet']);
});

test('the index lists each ingredient with the recipes that use it and how', () => {
  const index = buildIndex(loadRepo(makeRepo()));
  const coriander = index.ingredients.find((i) => i.id === 'coriander');
  assert.deepEqual(coriander.uses.map((u) => [u.recipe, u.group, u.preparation]), [
    ['herb-salad', 'For the salad', 'leaves picked'],
    ['salsa-verde', null, 'with stems, roughly chopped'],
  ]);
  assert.deepEqual(index.recipes.find((r) => r.slug === 'salsa-verde').ingredients, ['serrano-chilli', 'scallion', 'coriander']);
});

test('card data is plain text with the draft note kept', () => {
  const r = parseRecipe('recipes/sauces/salsa-verde.md', RECIPE);
  const card = cardData(r, { url: 'https://schryer.eu/recipes/' });
  assert.equal(card.footer, 'schryer.eu/recipes');
  assert.deepEqual(card.intro[0], { kind: 'note', text: 'Draft method for David to check.' });
  assert.equal(card.groups[0].items[0], '2 serrano chillies, stems removed');
  assert.deepEqual(card.notes, ['Keeps for a week.']);
});

test('a request is read from the recipe-host block of an issue', () => {
  assert.equal(readRequest('Just a question'), null);
  assert.deepEqual(readRequest('Text\n\n```recipe-host\n{"action":"add-ingredient","name":"Leek"}\n```\n'), { action: 'add-ingredient', name: 'Leek' });
  assert.throws(() => readRequest('```recipe-host\nnot json\n```'), RequestError);
});

test('merging relinks recipes and keeps the old name as an alias', () => {
  const root = makeRepo();
  const result = applyRequest(root, { action: 'merge-ingredients', from: 'spring-onion', into: 'scallion' });
  assert.equal(result.title, 'Merge Spring onion into Scallion');
  assert.ok(!fs.existsSync(path.join(root, 'ingredients/spring-onion.md')));
  assert.match(read(root, 'recipes/salads/herb-salad.md'), /2 \[spring onions\]\(\/ingredients\/scallion\.md\), sliced/);
  const scallion = parseIngredient('ingredients/scallion.md', read(root, 'ingredients/scallion.md'));
  assert.deepEqual(scallion.aliases, ['green onion', 'Spring onion']);
  assert.match(scallion.notes, /### From Spring onion\n\nThe same plant as a scallion\./);
  assert.deepEqual(loadRepo(root).errors, []);
});

test('merging moves substitutions that point at the merged ingredient', () => {
  const root = makeRepo({
    'ingredients/serrano-chilli.md': ing('Serrano chilli', 'substitutions:\n  - with: jalapeno\n    recipes: [salsa-verde]\n    note: Use more.\n'),
  });
  applyRequest(root, { action: 'merge-ingredients', from: 'jalapeno', into: 'onion' });
  assert.match(read(root, 'ingredients/serrano-chilli.md'), /with: onion/);
});

test('an ingredient cannot be merged into itself or a missing one', () => {
  const root = makeRepo();
  assert.throws(() => applyRequest(root, { action: 'merge-ingredients', from: 'onion', into: 'onion' }), /into itself/);
  assert.throws(() => applyRequest(root, { action: 'merge-ingredients', from: 'onion', into: 'leek' }), /no ingredient "leek"/);
});

test('adding an ingredient writes its file and refuses duplicates', () => {
  const root = makeRepo();
  const result = applyRequest(root, { action: 'add-ingredient', name: 'Roasted onion', aliases: 'charred onion', notes: 'Roast at 220 °C.' });
  assert.equal(result.branch, 'add-roasted-onion');
  const added = parseIngredient('ingredients/roasted-onion.md', read(root, 'ingredients/roasted-onion.md'));
  assert.deepEqual([added.name, added.aliases, added.notes], ['Roasted onion', ['charred onion'], 'Roast at 220 °C.']);
  assert.throws(() => applyRequest(root, { action: 'add-ingredient', name: 'cilantro' }), /already an alias of Coriander/);
});

test('a substitution note is stored on the ingredient for the chosen recipes', () => {
  const root = makeRepo();
  const result = applyRequest(root, {
    action: 'add-substitution', ingredient: 'serrano-chilli', with: 'jalapeno', recipes: ['salsa-verde'],
    note: 'More roasted jalapeños plus a small dose of hotter chilli extract to taste.',
  });
  assert.equal(result.title, 'Substitute Jalapeño for Serrano chilli');
  const serrano = parseIngredient('ingredients/serrano-chilli.md', read(root, 'ingredients/serrano-chilli.md'));
  assert.deepEqual(serrano.substitutions, [{ with: 'jalapeno', recipes: ['salsa-verde'], note: 'More roasted jalapeños plus a small dose of hotter chilli extract to taste.' }]);
});

test('a substitution for a recipe that does not use the ingredient is refused', () => {
  const root = makeRepo();
  assert.throws(
    () => applyRequest(root, { action: 'add-substitution', ingredient: 'serrano-chilli', with: 'jalapeno', recipes: ['herb-salad'], note: 'x' }),
    /"herb-salad", which does not use Serrano chilli/,
  );
  assert.ok(!read(root, 'ingredients/serrano-chilli.md').includes('substitutions'));
});

test('link adds ingredient links by name and alias and reports the rest', () => {
  const recipe = SALAD.replace('1 bunch [coriander](/ingredients/coriander.md)', '1 bunch cilantro').replace('2 [spring onions](/ingredients/spring-onion.md)', '2 red onions').replace('- 2 red onions, sliced', '- 2 red onions, sliced\n- 1 lemon');
  const root = makeRepo({ 'recipes/salads/herb-salad.md': recipe });
  const result = linkRecipe(root, 'recipes/salads/herb-salad.md');
  assert.deepEqual(result.linked, ['1 bunch [cilantro](/ingredients/coriander.md), leaves picked', '2 red [onions](/ingredients/onion.md), sliced']);
  assert.deepEqual(result.unmatched, ['1 lemon']);
  assert.match(read(root, 'recipes/salads/herb-salad.md'), /- 1 bunch \[cilantro\]\(\/ingredients\/coriander\.md\), leaves picked/);
});

test('a page pinned to one data commit preloads its index and skips asking GitHub', () => {
  const config = { title: 'R & D', description: '', repo: 'o/r', branch: 'main' };
  const pinned = pageHtml(config, { data: 'https://cdn.jsdelivr.net/gh/o/r@abc/' });
  assert.match(pinned, /<link rel="preload" href="https:\/\/cdn.jsdelivr.net\/gh\/o\/r@abc\/index.json" as="fetch" crossorigin>/);
  assert.match(pinned, /"data":"https:\/\/cdn.jsdelivr.net\/gh\/o\/r@abc\/"/);
  assert.match(pinned, /<title>R &amp; D<\/title>/);
  const latest = pageHtml(config);
  assert.doesNotMatch(latest, /rel="preload"/);
  assert.match(latest, /"data":null/);
});

test('every library the page loads carries the integrity of the file its version ships', () => {
  for (const [key, [name, version, file]] of Object.entries(ASSETS)) {
    const installed = JSON.parse(fs.readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
    assert.equal(installed, version, `ASSETS.${key} pins ${name}@${version} but package.json installs ${installed}`);
    const hash = sri(fs.readFileSync(new URL(`../node_modules/${name}/${file}`, import.meta.url)));
    assert.equal(INTEGRITY[key], hash, `INTEGRITY.${key} must be '${hash}', the hash of ${name}@${version}/${file}`);
  }
});

test('every script and stylesheet on the page names its integrity, the app itself included', () => {
  const page = pageHtml({ title: 'R', description: '', repo: 'o/r', branch: 'main', login: { issuer: 'https://auth.example/x', client: 'c' }, favourites: 'https://store.example/' });
  const tags = page.match(/<(script|link rel="stylesheet")[^>]* (src|href)="[^"]+"[^>]*>/g);
  assert.equal(tags.length, 9);
  for (const tag of tags) assert.match(tag, / integrity="sha384-[A-Za-z0-9+/]+={0,2}" crossorigin="anonymous"/, tag);
  const app = sri(fs.readFileSync(new URL('../app/app.js', import.meta.url)));
  assert.ok(page.includes(`app.js" integrity="${app}"`));
  const style = sri(fs.readFileSync(new URL('../app/style.css', import.meta.url)));
  assert.ok(page.includes(`style.css" integrity="${style}"`));
});

test('a site with login loads the sign-in library and passes its settings to the page', () => {
  const config = { title: 'R', description: '', repo: 'o/r', branch: 'main', login: { issuer: 'https://auth.example/realms/x', client: 'recipes', required: true }, favourites: 'https://store.example/' };
  const page = pageHtml(config);
  assert.match(page, /<script defer src="https:\/\/cdn.jsdelivr.net\/npm\/oidc-client-ts@3.5.0\/dist\/browser\/oidc-client-ts.min.js" integrity="sha384-[^"]+" crossorigin="anonymous"><\/script>/);
  assert.match(page, /"login":\{"issuer":"https:\/\/auth.example\/realms\/x","client":"recipes","required":true\},"favourites":"https:\/\/store.example\/"/);
  const preview = pageHtml(config, { login: { issuer: '/mock/x', client: 'recipes', required: false }, favourites: '/mock/presign/' });
  assert.match(preview, /"issuer":"\/mock\/x"/);
  const open = pageHtml({ ...config, login: null, favourites: null });
  assert.doesNotMatch(open, /oidc-client-ts/);
  assert.match(open, /"login":null,"favourites":null/);
});

test('login settings in recipe-host.yml are read and checked', () => {
  const good = loadRepo(makeRepo({ 'recipe-host.yml': 'login:\n  issuer: https://auth.sustenaut.eu/realms/sustenaut\n  client: recipes\n  required: true\nfavourites: https://presign.sustenaut.eu/\n' }));
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.config.login, { issuer: 'https://auth.sustenaut.eu/realms/sustenaut', client: 'recipes', required: true });
  assert.equal(good.config.favourites, 'https://presign.sustenaut.eu/');
  assert.equal(loadRepo(makeRepo()).config.login, null);
  const bad = loadRepo(makeRepo({ 'recipe-host.yml': 'login:\n  issuer: http://auth.example\nfavourites: nowhere\n' }));
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /login.issuer must be the https:\/\/ address/);
  assert.match(bad.errors[1], /login.client must name the client/);
  assert.match(bad.errors[2], /favourites must be the https:\/\/ address/);
  const alone = loadRepo(makeRepo({ 'recipe-host.yml': 'favourites: https://presign.sustenaut.eu/\n' }));
  assert.match(alone.errors[0], /favourites needs login/);
});

test('typst is found by absolute path, from $TYPST or else PATH, and never from a relative PATH entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typst-'));
  const bin = path.join(dir, process.platform === 'win32' ? 'typst.exe' : 'typst');
  fs.writeFileSync(bin, '');
  fs.chmodSync(bin, 0o755);
  assert.equal(typstPath({ PATH: ['relative', dir].join(path.delimiter) }), bin);
  assert.equal(typstPath({ TYPST: bin, PATH: '' }), bin);
  assert.equal(typstPath({ TYPST: 'typst', PATH: dir }), null);
  assert.equal(typstPath({ PATH: 'relative' }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Markdown patterns keep their meaning and stay fast on hostile text', () => {
  assert.deepEqual(splitSections('## Method ##\n1. Stir').sections, [{ title: 'Method', markdown: '1. Stir' }]);
  assert.equal(plainText('a [b](c) ![d](e.jpg) [f [g](h)'), 'a b [f g');
  assert.equal(slugify(' -Crème  brûlée- '), 'creme-brulee');
  assert.deepEqual(parseIngredientLine('[a [garlic](/ingredients/garlic.md)').refs.map((r) => r.id), ['garlic']);
  assert.deepEqual(readRequest('Hi\r\n```recipe-host\r\n{"action":"add"}\r\n```\r\n'), { action: 'add' });
  assert.equal(readRequest('```recipe-host\n{"action":"add"}'), null);

  const recipe = parseRecipe('recipes/x/y.md', `---\ntitle: Y\nsubtitle: Z\ntags: [t]\ndate: 2026-10-20\nserves: 1\n---\n## Ingredients\n- 1 [egg](/ingredients/egg.md)\n## Method\n1. **Whisk.**   Beat it\n2. Cook`);
  assert.deepEqual(recipe.steps.map((s) => [s.name, s.markdown]), [['Whisk', 'Beat it'], [null, 'Cook']]);

  const started = Date.now();
  plainText('[a]('.repeat(20000));
  parseIngredientLine('[a'.repeat(20000));
  splitSections(`## ${'#'.repeat(20000)}x`);
  assert.throws(() => readRequest('```recipe-host\n'.repeat(5000)), RequestError);
  assert.ok(Date.now() - started < 1000, 'the patterns took over a second on long input');
});
