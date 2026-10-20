// `recipe-host link`: links the plain ingredient lines of a recipe to the
// master ingredient list, matching ingredient names and aliases. It is the
// first step when a new recipe arrives; lines it cannot match are reported
// so a person (or agent) can link them or add the ingredient.

import fs from 'node:fs';
import path from 'node:path';
import { INGREDIENT_LINK, splitSections } from './parse.js';
import { loadRepo } from './repo.js';

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One matcher per ingredient name and alias. Each also matches its simple
// plural.
export function matchers(ingredients) {
  const names = [];
  for (const ing of ingredients.values()) {
    [ing.name, ...ing.aliases].forEach((name, i) => names.push({ id: ing.id, alias: i > 0, name: name.toLowerCase() }));
  }
  return names.map(({ id, alias, name }) => ({ id, alias, re: new RegExp(`(?<![\\p{L}])(${escape(name)}(?:e?s)?)(?![\\p{L}])`, 'giu') }));
}

// Returns the line with one ingredient linked, or null. The longest match
// wins, so "red onion" beats "onion"; on a tie, the ingredient's own name
// beats an alias. Text already inside a link is never matched.
export function linkLine(text, compiled) {
  const masked = text.replace(/\[[^[\]]*\]\([^()[\]]*\)/g, (m) => ' '.repeat(m.length));
  const best = new Map();
  for (const { id, alias, re } of compiled) {
    for (const m of masked.matchAll(re)) {
      const found = { id, alias, index: m.index, text: m[1] };
      const prev = best.get(id);
      if (!prev || found.text.length > prev.text.length || (found.text.length === prev.text.length && prev.alias && !alias)) best.set(id, found);
    }
  }
  const pick = [...best.values()].sort((a, b) => b.text.length - a.text.length || a.index - b.index)[0];
  if (!pick) return null;
  const original = text.slice(pick.index, pick.index + pick.text.length);
  return text.slice(0, pick.index) + `[${original}](/ingredients/${pick.id}.md)` + text.slice(pick.index + pick.text.length);
}

export function linkRecipe(root, rel, { write = true } = {}) {
  const { ingredients } = loadRepo(root);
  const compiled = matchers(ingredients);
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const { sections } = splitSections(text);
  const section = sections.find((s) => s.title === 'Ingredients');
  if (!section) return { linked: [], unmatched: [] };

  const linked = [];
  const unmatched = [];
  const start = text.indexOf(section.markdown);
  const replaced = section.markdown.replace(/^([-*+]\s+)(\S.*)$/gm, (line, marker, item) => {
    if (new RegExp(INGREDIENT_LINK.source).test(item)) return line;
    const result = linkLine(item, compiled);
    if (result) {
      linked.push(result);
      return marker + result;
    }
    unmatched.push(item);
    return line;
  });
  if (write && linked.length) fs.writeFileSync(file, text.slice(0, start) + replaced + text.slice(start + section.markdown.length));
  return { linked, unmatched };
}
