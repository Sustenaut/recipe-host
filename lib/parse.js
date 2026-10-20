// Parsing of a recipe repository's two kinds of source file: recipes
// (recipes/<category>/<slug>.md) and ingredients (ingredients/<id>.md).
// FORMAT.md is the contract these functions implement.

import YAML from 'yaml';

// An ingredient reference inside a recipe's ingredient line:
// [garlic](/ingredients/garlic.md). The root-relative link also works when
// the file is read on GitHub.
export const INGREDIENT_LINK = /\[([^\]]+)\]\(\/ingredients\/([a-z0-9-]+)\.md\)/g;

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class SourceError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.file = file;
  }
}

export function splitFrontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };
  let data;
  try {
    data = YAML.parse(match[1]) ?? {};
  } catch (err) {
    throw new SourceError(file, `the frontmatter is not valid YAML (${err.message.split('\n')[0]})`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new SourceError(file, 'the frontmatter must be a set of `key: value` lines');
  }
  return { data, body: text.slice(match[0].length) };
}

// Plain text of a line of inline Markdown: links keep their text, emphasis
// and code marks are dropped.
export function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits a Markdown body into the text before the first `## ` heading and
// one entry per `## ` section, skipping headings inside code fences.
export function splitSections(body) {
  const lines = body.split(/\r?\n/);
  const intro = [];
  const sections = [];
  let current = null;
  let fence = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (line.trim().startsWith(fence)) fence = null;
    }
    const heading = !fence && line.match(/^## (.+?)\s*#*\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
    } else {
      (current ? current.lines : intro).push(line);
    }
  }
  return {
    intro: intro.join('\n').trim(),
    sections: sections.map((s) => ({ title: s.title, markdown: s.lines.join('\n').trim() })),
  };
}

// The items of a Markdown list, joining wrapped continuation lines. Each
// item is { marker, text, line } with `line` its 1-based line number within
// `markdown`.
export function listItems(markdown, ordered) {
  const items = [];
  const marker = ordered ? /^(\d+)[.)]\s+(.*)$/ : /^[-*+]\s+(.*)$/;
  markdown.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(marker);
    if (m) {
      items.push({ text: (ordered ? m[2] : m[1]).trim(), line: i + 1 });
    } else if (items.length && /^\s+\S/.test(line)) {
      items[items.length - 1].text += ' ' + line.trim();
    }
  });
  return items;
}

// One ingredient line: "6 cloves [garlic](/ingredients/garlic.md), minced"
// gives quantity "6 cloves", the reference garlic, and preparation "minced".
export function parseIngredientLine(text) {
  const refs = [];
  let first = -1;
  let lastEnd = -1;
  for (const m of text.matchAll(INGREDIENT_LINK)) {
    refs.push({ id: m[2], label: m[1] });
    if (first < 0) first = m.index;
    lastEnd = m.index + m[0].length;
  }
  if (!refs.length) return { refs, text: plainText(text), quantity: '', preparation: '' };
  return {
    refs,
    text: plainText(text),
    quantity: plainText(text.slice(0, first)),
    preparation: plainText(text.slice(lastEnd)).replace(/^[,;:]\s*/, ''),
  };
}

const FACT_KEYS = ['serves', 'makes', 'prep', 'cook', 'rest', 'total'];
const REQUIRED = ['title', 'subtitle', 'tags', 'date'];

// `path` is the file's path in the repository, recipes/<category>/<slug>.md.
export function parseRecipe(path, text) {
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== 'recipes' || !parts[2].endsWith('.md')) {
    throw new SourceError(path, 'a recipe must sit at recipes/<category>/<slug>.md');
  }
  const [, category, file] = parts;
  const slug = file.slice(0, -3);
  const problems = [];
  if (!ID_PATTERN.test(slug)) problems.push(`the file name "${slug}" must be lowercase ASCII words joined by hyphens`);
  if (!ID_PATTERN.test(category)) problems.push(`the category folder "${category}" must be lowercase ASCII words joined by hyphens`);

  const { data, body } = splitFrontmatter(text, path);
  for (const key of REQUIRED) {
    if (data[key] === undefined || data[key] === '') problems.push(`the frontmatter needs \`${key}\``);
  }
  if (data.tags !== undefined && !Array.isArray(data.tags)) problems.push('`tags` must be a list, like [beef, french]');
  if (!data.serves && !data.makes) problems.push('the frontmatter needs `serves` or `makes`');

  const { intro, sections } = splitSections(body);
  const ingredientsSection = sections.find((s) => s.title === 'Ingredients');
  const methodSection = sections.find((s) => s.title === 'Method');
  if (!ingredientsSection) problems.push('there is no `## Ingredients` section');
  if (!methodSection) problems.push('there is no `## Method` section');

  // Ingredient groups: `### For the marinade` headings, or one unnamed group.
  const groups = [];
  if (ingredientsSection) {
    const chunks = ingredientsSection.markdown.split(/^### +(.+)$/m);
    if (chunks[0].trim()) groups.push({ title: null, markdown: chunks[0] });
    for (let i = 1; i < chunks.length; i += 2) groups.push({ title: chunks[i].trim(), markdown: chunks[i + 1] ?? '' });
  }
  const ingredientGroups = groups.map((g) => ({
    title: g.title,
    items: listItems(g.markdown, false).map((item) => ({ markdown: item.text, ...parseIngredientLine(item.text) })),
  }));
  for (const g of ingredientGroups) {
    for (const item of g.items) {
      if (!item.refs.length) {
        problems.push(`the ingredient line "${item.text}" links no ingredient; link it like [garlic](/ingredients/garlic.md)`);
      }
    }
  }

  const steps = methodSection
    ? listItems(methodSection.markdown, true).map((item) => {
        const m = item.text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
        return m ? { name: plainText(m[1]).replace(/\.$/, ''), markdown: m[2] } : { name: null, markdown: item.text };
      })
    : [];

  if (problems.length) {
    const err = new SourceError(path, problems.join('; '));
    err.problems = problems;
    throw err;
  }

  const facts = {};
  for (const key of FACT_KEYS) if (data[key] !== undefined) facts[key] = String(data[key]);
  return {
    slug,
    category,
    path,
    title: String(data.title),
    subtitle: String(data.subtitle),
    tags: data.tags.map(String),
    date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date),
    facts,
    source: data.source ? String(data.source) : null,
    photo: data.photo ? String(data.photo) : null,
    photoAlt: data.photo_alt ? String(data.photo_alt) : '',
    intro,
    ingredientGroups,
    steps,
    sections,
    body,
  };
}

// `path` is ingredients/<id>.md.
export function parseIngredient(path, text) {
  const m = path.match(/^ingredients\/([^/]+)\.md$/);
  if (!m) throw new SourceError(path, 'an ingredient must sit at ingredients/<id>.md');
  const id = m[1];
  if (!ID_PATTERN.test(id)) throw new SourceError(path, `the id "${id}" must be lowercase ASCII words joined by hyphens`);
  const { data, body } = splitFrontmatter(text, path);
  if (!data.name) throw new SourceError(path, 'the frontmatter needs `name`, the ingredient as it reads in a list');
  const aliases = data.aliases ?? [];
  if (!Array.isArray(aliases)) throw new SourceError(path, '`aliases` must be a list');
  const substitutions = data.substitutions ?? [];
  if (!Array.isArray(substitutions)) throw new SourceError(path, '`substitutions` must be a list');
  substitutions.forEach((s, i) => {
    const where = `substitution ${i + 1}`;
    if (!s || typeof s !== 'object') throw new SourceError(path, `${where} must have \`with\`, \`recipes\` and \`note\``);
    if (!s.with || !ID_PATTERN.test(String(s.with))) throw new SourceError(path, `${where} needs \`with\`, the id of the substitute ingredient`);
    if (!Array.isArray(s.recipes) || !s.recipes.length) throw new SourceError(path, `${where} needs \`recipes\`, a list of recipe slugs it applies to`);
    if (!s.note) throw new SourceError(path, `${where} needs a \`note\` saying how to substitute`);
  });
  return {
    id,
    path,
    name: String(data.name),
    aliases: aliases.map(String),
    substitutions: substitutions.map((s) => ({ with: String(s.with), recipes: s.recipes.map(String), note: String(s.note).trim() })),
    notes: body.trim(),
  };
}

export function stringifyIngredient(ingredient) {
  const data = { name: ingredient.name };
  if (ingredient.aliases?.length) data.aliases = ingredient.aliases;
  if (ingredient.substitutions?.length) data.substitutions = ingredient.substitutions;
  // Short lists stay on one line, the way people write them by hand.
  const doc = new YAML.Document(data);
  if (doc.get('aliases', true)) doc.get('aliases', true).flow = true;
  for (const sub of doc.get('substitutions', true)?.items ?? []) sub.get('recipes', true).flow = true;
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const notes = ingredient.notes?.trim();
  return `---\n${yaml}\n---\n${notes ? `\n${notes}\n` : ''}`;
}

export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
