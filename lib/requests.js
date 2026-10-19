// Change requests from the site's buttons. The site cannot write to the
// repository, so each button opens a prefilled GitHub issue whose body
// carries the request as JSON in a ```recipe-host fence. The `request`
// command reads that issue, applies the change to the files here, and
// describes the pull request to open for review.

import fs from 'node:fs';
import path from 'node:path';
import { ID_PATTERN, slugify, stringifyIngredient } from './parse.js';
import { loadRepo } from './repo.js';

export class RequestError extends Error {}

const FENCE = /```recipe-host\s*\n([\s\S]*?)\n```/;

export function readRequest(issueBody) {
  const m = (issueBody ?? '').match(FENCE);
  if (!m) return null;
  let request;
  try {
    request = JSON.parse(m[1]);
  } catch {
    throw new RequestError('The ```recipe-host block in this issue is not valid JSON, so there is nothing to apply.');
  }
  if (!request || typeof request !== 'object' || typeof request.action !== 'string') {
    throw new RequestError('The ```recipe-host block needs an "action".');
  }
  return request;
}

function ingredientFile(root, id) {
  return path.join(root, 'ingredients', `${id}.md`);
}

function writeIngredient(root, ing) {
  fs.writeFileSync(ingredientFile(root, ing.id), stringifyIngredient(ing));
}

function need(value, message) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    throw new RequestError(message);
  }
  return value;
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function getIngredient(repo, id, role) {
  const ing = repo.ingredients.get(String(id));
  if (!ing) throw new RequestError(`There is no ingredient "${id}" to use as the ${role}.`);
  return ing;
}

function mergeIngredients(root, repo, request) {
  const from = getIngredient(repo, need(request.from, 'A merge needs "from", the ingredient to merge away.'), 'ingredient to merge');
  const into = getIngredient(repo, need(request.into, 'A merge needs "into", the ingredient to keep.'), 'ingredient to keep');
  if (from.id === into.id) throw new RequestError('An ingredient cannot be merged into itself.');

  // Every recipe link to `from` now points at `into`; the recipe's own
  // wording of the ingredient stays as it was.
  const link = `](/ingredients/${from.id}.md)`;
  const recipes = [];
  for (const r of repo.recipes) {
    const file = path.join(root, r.path);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(link)) {
      fs.writeFileSync(file, text.split(link).join(`](/ingredients/${into.id}.md)`));
      recipes.push(r.title);
    }
  }

  const names = new Set([into.name.toLowerCase()]);
  const aliases = [];
  for (const a of [...into.aliases, from.name, ...from.aliases]) {
    if (!names.has(a.toLowerCase())) {
      names.add(a.toLowerCase());
      aliases.push(a);
    }
  }
  const notes = [into.notes, from.notes ? `### From ${from.name}\n\n${from.notes}` : ''].filter(Boolean).join('\n\n');
  const substitutions = [...into.substitutions, ...from.substitutions]
    .map((s) => (s.with === from.id ? { ...s, with: into.id } : s))
    .filter((s) => s.with !== into.id);
  writeIngredient(root, { ...into, aliases, notes, substitutions });
  fs.rmSync(ingredientFile(root, from.id));

  for (const other of repo.ingredients.values()) {
    if (other.id === from.id || other.id === into.id) continue;
    if (other.substitutions.some((s) => s.with === from.id)) {
      writeIngredient(root, { ...other, substitutions: other.substitutions.map((s) => (s.with === from.id ? { ...s, with: into.id } : s)) });
    }
  }

  return {
    branch: `merge-${from.id}-into-${into.id}`,
    title: `Merge ${from.name} into ${into.name}`,
    summary: [
      `Merges **${from.name}** into **${into.name}**. ${from.name} becomes an alias of ${into.name}, and its notes and substitutions move across.`,
      recipes.length ? `Recipes whose ingredient links now point at ${into.name}: ${recipes.join(', ')}.` : 'No recipe linked it.',
    ].join('\n\n'),
  };
}

function addIngredient(root, repo, request) {
  const name = cleanText(need(request.name, 'A new ingredient needs a "name".'), 80);
  const id = request.id ? String(request.id) : slugify(name);
  if (!ID_PATTERN.test(id)) throw new RequestError(`"${id}" cannot be an ingredient id; use lowercase letters, digits and hyphens.`);
  if (repo.ingredients.has(id)) throw new RequestError(`The ingredient "${repo.ingredients.get(id).name}" already exists.`);
  const aliases = (Array.isArray(request.aliases) ? request.aliases : String(request.aliases ?? '').split(','))
    .map((a) => cleanText(a, 80))
    .filter(Boolean);
  for (const candidate of [name, ...aliases]) {
    for (const ing of repo.ingredients.values()) {
      if ([ing.name, ...ing.aliases].some((n) => n.toLowerCase() === candidate.toLowerCase())) {
        throw new RequestError(`"${candidate}" is already ${ing.name === candidate ? 'an ingredient' : `an alias of ${ing.name}`}.`);
      }
    }
  }
  const notes = cleanText(request.notes, 5000);
  writeIngredient(root, { id, name, aliases, notes, substitutions: [] });
  return {
    branch: `add-${id}`,
    title: `Add the ingredient ${name}`,
    summary: `Adds **${name}** to the ingredient list as \`ingredients/${id}.md\`.`,
  };
}

function addSubstitution(root, repo, request) {
  const ing = getIngredient(repo, need(request.ingredient, 'A substitution needs "ingredient", the one being replaced.'), 'ingredient being replaced');
  const sub = getIngredient(repo, need(request.with, 'A substitution needs "with", the ingredient to use instead.'), 'substitute');
  if (sub.id === ing.id) throw new RequestError('An ingredient cannot substitute for itself.');
  const recipes = need(request.recipes, 'A substitution needs at least one recipe it applies to.').map(String);
  const note = cleanText(need(request.note, 'A substitution needs a note on how to substitute.'), 2000);
  need(note, 'A substitution needs a note on how to substitute.');
  const titles = recipes.map((slug) => {
    const r = repo.recipes.find((x) => x.slug === slug);
    if (!r) throw new RequestError(`There is no recipe "${slug}".`);
    if (!r.ingredientGroups.some((g) => g.items.some((i) => i.refs.some((ref) => ref.id === ing.id)))) {
      throw new RequestError(`The recipe "${slug}", which does not use ${ing.name}, cannot have a substitution for it.`);
    }
    return r.title;
  });
  writeIngredient(root, { ...ing, substitutions: [...ing.substitutions, { with: sub.id, recipes, note }] });
  return {
    branch: `substitute-${ing.id}-with-${sub.id}`,
    title: `Substitute ${sub.name} for ${ing.name}`,
    summary: [
      `Adds a substitution note to **${ing.name}**: use **${sub.name}** instead, in ${titles.join(', ')}.`,
      `> ${note.replace(/\n/g, '\n> ')}`,
    ].join('\n\n'),
  };
}

const ACTIONS = {
  'merge-ingredients': mergeIngredients,
  'add-ingredient': addIngredient,
  'add-substitution': addSubstitution,
};

// Applies `request` to the repository at `root` and checks the result.
// Returns { branch, title, summary } for the pull request.
export function applyRequest(root, request) {
  const action = ACTIONS[request.action];
  if (!action) throw new RequestError(`"${request.action}" is not a request recipe-host knows. It knows ${Object.keys(ACTIONS).join(', ')}.`);
  const before = loadRepo(root);
  if (before.errors.length) throw new RequestError(`The repository has errors before this change:\n${before.errors.join('\n')}`);
  const result = action(root, before, request);
  const after = loadRepo(root);
  if (after.errors.length) throw new RequestError(`The change would leave errors:\n${after.errors.join('\n')}`);
  return result;
}
