// `recipe-host build`: turns a recipe repository into the folder of static
// data the site reads through jsDelivr.
//
//   <out>/index.html              the page a web server serves (the "shell")
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
import { buildIndex, loadRepo, photoPath } from './repo.js';

const CARD_TEMPLATE = fileURLToPath(new URL('../cards/recipe-card.typ', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The released engine on jsDelivr, at the version that built the data.
export const DEFAULT_ENGINE = `https://cdn.jsdelivr.net/gh/schryer/recipe-host@v${version}/app/boot.js`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// The only file a web server needs. Everything else (the app, the data,
// the cards) loads from jsDelivr, so publishing recipes never touches it.
export function shellHtml(config, engine = DEFAULT_ENGINE) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.title)}</title>
${config.description ? `<meta name="description" content="${escapeHtml(config.description)}">\n` : ''}<script src="${escapeHtml(engine)}" data-repo="${escapeHtml(config.repo ?? '')}" data-branch="${escapeHtml(config.branch)}"></script>
</head>
<body>
<noscript>This recipe site needs JavaScript. The recipes are also on <a href="https://github.com/${escapeHtml(config.repo ?? '')}">GitHub</a>.</noscript>
</body>
</html>
`;
}

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

export function buildSite(root, out, { cards = typstAvailable(), engine = DEFAULT_ENGINE, log = console.log } = {}) {
  const repo = loadRepo(root);
  if (repo.errors.length) return repo;

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), shellHtml(repo.config, engine));
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
