// `recipe-host build`: turns a recipe repository into the folder of static
// data the site reads through jsDelivr.
//
//   <out>/index.html              the site's page (lib/page.js), for a web server
//   <out>/index.json              every recipe and ingredient, for the lists,
//                                 and the Subresource Integrity hash of each
//                                 recipes/<slug>.json (`integrity`)
//   <out>/recipes/<slug>.json     one recipe in full
//   <out>/photos/...              photos, at their repository paths
//   <out>/cards/<slug>.pdf        the printable A5 card (when typst is installed)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainText, listItems } from './parse.js';
import { pageHtml, sri } from './page.js';
import { buildIndex, loadRepo, photoPath } from './repo.js';

const CARD_TEMPLATE = fileURLToPath(new URL('../cards/recipe-card.typ', import.meta.url));
const FACT_LABELS = { serves: 'Serves', makes: 'Makes', prep: 'Prep', cook: 'Cook', rest: 'Rest', total: 'Total' };

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Markdown paragraphs and GitHub alerts (> [!NOTE]) as plain text blocks.
function textBlocks(markdown) {
  return markdown
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk && !chunk.startsWith('<!--'))
    .map((chunk) => {
      if (chunk.startsWith('>')) {
        const text = chunk.replace(/^>\s?/gm, '').replace(/^\[!\w+\]\s*/, '');
        return { kind: 'note', text: plainText(text) };
      }
      return { kind: 'paragraph', text: plainText(chunk) };
    });
}

export function cardData(recipe, config) {
  const notes = recipe.sections.find((s) => s.title === 'Notes');
  return {
    title: recipe.title,
    subtitle: recipe.subtitle,
    footer: config.url ? config.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
    facts: Object.entries(recipe.facts).map(([key, value]) => ({ label: FACT_LABELS[key], value })),
    source: recipe.source ? { url: recipe.source, host: hostname(recipe.source) } : null,
    intro: textBlocks(recipe.intro),
    groups: recipe.ingredientGroups.map((g) => ({ title: g.title, items: g.items.map((i) => i.text) })),
    steps: recipe.steps.map((s) => ({ name: s.name, text: plainText(s.markdown) })),
    notes: notes ? listItems(notes.markdown, false).map((i) => plainText(i.text)) : [],
  };
}

// The absolute path of the typst binary, or null: $TYPST if set, else the
// first `typst` on PATH. Running it by full path means the build runs the
// binary it checked, not whatever a later PATH lookup finds.
export function typstPath(env = process.env) {
  const names = process.platform === 'win32' ? ['typst.exe'] : ['typst'];
  const candidates = env.TYPST
    ? [env.TYPST]
    : (env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute).flatMap((dir) => names.map((n) => path.join(dir, n)));
  return candidates.find((file) => path.isAbsolute(file) && isExecutable(file)) ?? null;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function buildSite(root, out, { cards = true, page = {}, log = console.log } = {}) {
  const typst = cards ? typstPath() : null;
  const repo = loadRepo(root);
  if (repo.errors.length) return repo;

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), pageHtml(repo.config, page));
  // The page checks every file it fetches against these, and the deployed
  // page names the hash of index.json itself (`recipe-host page --index`).
  const integrity = {};
  for (const r of repo.recipes) {
    const { ingredientGroups, steps, sections, intro, body, ...meta } = r;
    const page = { ...meta, photo: r.photo ? photoPath(r) : null, intro, ingredientGroups, steps, sections };
    const json = JSON.stringify(page, null, 1);
    fs.writeFileSync(path.join(out, 'recipes', `${r.slug}.json`), json);
    integrity[`recipes/${r.slug}.json`] = sri(json);
    if (r.photo) {
      const dest = path.join(out, photoPath(r));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, photoPath(r)), dest);
    }
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ ...buildIndex(repo), integrity }, null, 1));

  if (typst) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-cards-'));
    fs.mkdirSync(path.join(out, 'cards'));
    fs.copyFileSync(CARD_TEMPLATE, path.join(tmp, 'recipe-card.typ'));
    for (const r of repo.recipes) {
      fs.writeFileSync(path.join(tmp, 'card.json'), JSON.stringify(cardData(r, repo.config)));
      execFileSync(typst, [
        'compile', '--root', tmp, '--input', 'data=/card.json',
        path.join(tmp, 'recipe-card.typ'), path.join(out, 'cards', `${r.slug}.pdf`),
      ], { stdio: ['ignore', 'inherit', 'inherit'] });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    log(`Built ${repo.recipes.length} recipes with cards and ${repo.ingredients.size} ingredients into ${out}`);
  } else {
    log(`Built ${repo.recipes.length} recipes (no cards: typst is not installed) and ${repo.ingredients.size} ingredients into ${out}`);
  }
  return repo;
}
