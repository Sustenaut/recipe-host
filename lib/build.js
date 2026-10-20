// `recipe-host build`: turns a recipe repository into the folder of static
// data the site reads through jsDelivr.
//
//   <out>/index.html              the site's page (lib/page.js), for a web server
//   <out>/index.json              every recipe and ingredient, for the lists
//   <out>/recipes/<slug>.json     one recipe in full
//   <out>/photos/...              photos, at their repository paths
//   <out>/cards/<slug>.pdf        the printable A5 card (when typst is installed)

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainText, listItems } from './parse.js';
import { pageHtml } from './page.js';
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

export function typstAvailable() {
  return spawnSync('typst', ['--version']).status === 0;
}

export function buildSite(root, out, { cards = typstAvailable(), page = {}, log = console.log } = {}) {
  const repo = loadRepo(root);
  if (repo.errors.length) return repo;

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), pageHtml(repo.config, page));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(buildIndex(repo), null, 1));

  for (const r of repo.recipes) {
    const { ingredientGroups, steps, sections, intro, body, ...meta } = r;
    const page = { ...meta, photo: r.photo ? photoPath(r) : null, intro, ingredientGroups, steps, sections };
    fs.writeFileSync(path.join(out, 'recipes', `${r.slug}.json`), JSON.stringify(page, null, 1));
    if (r.photo) {
      const dest = path.join(out, photoPath(r));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, photoPath(r)), dest);
    }
  }

  if (cards) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-cards-'));
    fs.mkdirSync(path.join(out, 'cards'));
    fs.copyFileSync(CARD_TEMPLATE, path.join(tmp, 'recipe-card.typ'));
    for (const r of repo.recipes) {
      fs.writeFileSync(path.join(tmp, 'card.json'), JSON.stringify(cardData(r, repo.config)));
      execFileSync('typst', [
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
