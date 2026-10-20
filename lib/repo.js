// Loading a recipe repository from disk, checking it as a whole, and
// building the data the site reads.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseIngredient, parseRecipe, SourceError } from './parse.js';

function listMarkdown(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listMarkdown(root, rel));
    else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

export function loadConfig(root) {
  const file = path.join(root, 'recipe-host.yml');
  const config = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) ?? {} : {};
  return {
    title: config.title ?? 'Recipes',
    description: config.description ?? '',
    repo: config.repo ?? null,
    branch: config.branch ?? 'main',
    url: config.url ?? null,
    categories: config.categories ?? [],
  };
}

// Reads every recipe and ingredient. Problems in single files and between
// files are collected rather than thrown, so one run reports them all.
export function loadRepo(root) {
  const errors = [];
  const warnings = [];
  const recipes = [];
  const ingredients = new Map();

  for (const rel of listMarkdown(root, 'ingredients')) {
    try {
      const ing = parseIngredient(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
      ingredients.set(ing.id, ing);
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      errors.push(err.message);
    }
  }
  for (const rel of listMarkdown(root, 'recipes')) {
    try {
      recipes.push(parseRecipe(rel, fs.readFileSync(path.join(root, rel), 'utf8')));
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      for (const p of err.problems ?? [err.message.slice(rel.length + 2)]) errors.push(`${rel}: ${p}`);
    }
  }

  const slugs = new Map();
  for (const r of recipes) {
    if (slugs.has(r.slug)) errors.push(`${r.path}: the slug "${r.slug}" is also used by ${slugs.get(r.slug)}; slugs must be unique across categories`);
    slugs.set(r.slug, r.path);
    if (r.photo && (photoPath(r).startsWith('..') || !photoPath(r).startsWith('photos/'))) {
      errors.push(`${r.path}: the photo must be in photos/, like photos/${r.slug}.jpg`);
    } else if (r.photo && !fs.existsSync(path.join(root, photoPath(r)))) {
      errors.push(`${r.path}: the photo ${r.photo} does not exist`);
    }
    for (const g of r.ingredientGroups) {
      for (const item of g.items) {
        for (const ref of item.refs) {
          if (!ingredients.has(ref.id)) {
            errors.push(`${r.path}: "${item.text}" links the ingredient "${ref.id}", which has no file; add ingredients/${ref.id}.md or link an existing one`);
          }
        }
      }
    }
  }

  const uses = usesByIngredient(recipes);
  for (const ing of ingredients.values()) {
    if (!uses.has(ing.id)) warnings.push(`${ing.path}: no recipe uses "${ing.name}" yet`);
    ing.substitutions.forEach((s, i) => {
      const where = `${ing.path}: substitution ${i + 1}`;
      if (!ingredients.has(s.with)) errors.push(`${where} substitutes "${s.with}", which has no ingredient file`);
      if (s.with === ing.id) errors.push(`${where} substitutes the ingredient with itself`);
      for (const slug of s.recipes) {
        if (!slugs.has(slug)) errors.push(`${where} names the recipe "${slug}", which does not exist`);
        else if (!(uses.get(ing.id) ?? []).some((u) => u.recipe === slug)) {
          errors.push(`${where} names the recipe "${slug}", which does not use ${ing.name}`);
        }
      }
    });
  }

  return { config: loadConfig(root), recipes, ingredients, errors, warnings };
}

export function usesByIngredient(recipes) {
  const uses = new Map();
  for (const r of recipes) {
    for (const g of r.ingredientGroups) {
      for (const item of g.items) {
        for (const ref of item.refs) {
          if (!uses.has(ref.id)) uses.set(ref.id, []);
          uses.get(ref.id).push({
            recipe: r.slug,
            group: g.title,
            line: item.text,
            quantity: item.quantity,
            preparation: item.preparation,
          });
        }
      }
    }
  }
  return uses;
}

// The site's index: everything the list views need in one file.
export function buildIndex({ config, recipes, ingredients }) {
  const uses = usesByIngredient(recipes);
  const sortedRecipes = [...recipes].sort((a, b) => a.title.localeCompare(b.title));
  return {
    format: 1,
    site: config,
    recipes: sortedRecipes.map((r) => ({
      slug: r.slug,
      category: r.category,
      path: r.path,
      title: r.title,
      subtitle: r.subtitle,
      tags: r.tags,
      date: r.date,
      facts: r.facts,
      photo: r.photo ? photoPath(r) : null,
      ingredients: [...new Set(r.ingredientGroups.flatMap((g) => g.items.flatMap((i) => i.refs.map((ref) => ref.id))))],
    })),
    ingredients: [...ingredients.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        aliases: ing.aliases,
        notes: ing.notes,
        substitutions: ing.substitutions,
        uses: uses.get(ing.id) ?? [],
      })),
  };
}

// A recipe's photo, which the frontmatter gives relative to the repository
// root (photos/<slug>.jpg).
export function photoPath(recipe) {
  return path.posix.normalize(recipe.photo.replace(/^\/+/, ''));
}
