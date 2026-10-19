// The recipe site: a single page that reads the built data (index.json and
// recipes/<slug>.json) and renders four views from the URL hash:
//
//   #/                     recipes by category, with search
//   #/recipe/<slug>        one recipe
//   #/ingredients          the master ingredient list, with search
//   #/ingredient/<id>      one ingredient, the recipes it is in, and its notes
//
// Changes (adding or merging ingredients, substitution notes) go through
// GitHub: each one opens a prefilled issue, and the repository's workflow
// turns that issue into a pull request for review (see lib/requests.js).

import { marked } from 'marked';

const config = window.RECIPE_HOST;
const dataUrl = (p) => new URL(p, config.data).href;

// By default the data is read from the latest commit of the `site` branch.
// A commit URL on jsDelivr never changes, so it is cached for good and a
// new build shows up at once; the branch URL is the fallback, which
// jsDelivr may serve stale for a while.
async function resolveData() {
  if (config.data) return;
  let ref = 'site';
  try {
    const res = await fetch(`https://api.github.com/repos/${config.repo}/commits/site`, { headers: { Accept: 'application/vnd.github.sha' } });
    const sha = res.ok ? (await res.text()).trim() : '';
    if (/^[0-9a-f]{40}$/.test(sha)) ref = sha;
  } catch {
    // Offline or rate limited: use the branch.
  }
  config.data = `https://cdn.jsdelivr.net/gh/${config.repo}@${ref}/`;
}
const github = `https://github.com/${config.repo}`;

let index = null;
const recipeCache = new Map();

// ---- helpers --------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const FACT_LABELS = { serves: 'Serves', makes: 'Makes', prep: 'Prep', cook: 'Cook', rest: 'Rest', total: 'Total' };

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalize(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---- Markdown ---------------------------------------------------------------

// Links in recipe Markdown point at repository files; on the site they
// become routes or data URLs. Raw HTML is dropped.
marked.use({
  gfm: true,
  renderer: {
    html() {
      return '';
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const ing = href.match(/^\/ingredients\/([a-z0-9-]+)\.md$/);
      if (ing) return `<a class="ingredient-link" href="#/ingredient/${ing[1]}">${text}</a>`;
      const recipe = !/^[a-z]+:/.test(href) && href.match(/([a-z0-9-]+)\.md$/);
      if (recipe) return `<a href="#/recipe/${recipe[1]}">${text}</a>`;
      if (/^https?:/.test(href)) return `<a href="${esc(href)}" rel="noopener">${text}</a>`;
      return text;
    },
    image({ href, text }) {
      if (/^https?:/.test(href)) return `<img src="${esc(href)}" alt="${esc(text)}">`;
      return '';
    },
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      const alert = body.match(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
      if (alert) return `<aside class="alert alert-${alert[1].toLowerCase()}"><p>${body.slice(alert[0].length)}</aside>`;
      return `<blockquote>${body}</blockquote>`;
    },
  },
});

const md = (text) => marked.parse(text ?? '');
const mdInline = (text) => marked.parseInline(text ?? '');

// ---- data -----------------------------------------------------------------

async function getJson(p) {
  const res = await fetch(dataUrl(p));
  if (!res.ok) throw new Error(`Could not load ${p} (${res.status})`);
  return res.json();
}

async function loadRecipe(slug) {
  if (!recipeCache.has(slug)) recipeCache.set(slug, getJson(`recipes/${slug}.json`));
  return recipeCache.get(slug);
}

const ingredientById = (id) => index.ingredients.find((i) => i.id === id);
const recipeBySlug = (slug) => index.recipes.find((r) => r.slug === slug);

// ---- requests through GitHub issues ------------------------------------------

// GitHub cuts very long prefilled URLs, so keep the body short.
function openRequest(title, summary, request) {
  const body = [
    summary,
    '',
    'Submit this issue and a pull request with the change is opened for review. Merging the pull request updates the site.',
    '',
    '<!-- recipe-host reads the block below to make the change; edit the text above freely. -->',
    '```recipe-host',
    JSON.stringify(request),
    '```',
  ].join('\n');
  const url = `${github}/issues/new?${new URLSearchParams({ title, body })}`;
  window.open(url, '_blank', 'noopener');
}

// ---- dialogs and menus ---------------------------------------------------------

function openDialog(html, onSubmit) {
  const dialog = h(`<dialog class="dialog">${html}</dialog>`);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  const form = dialog.querySelector('form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSubmit(new FormData(form), dialog) !== false) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

// A searchable single choice among ingredients, used by the merge and
// substitution dialogs. Writes the chosen id into a hidden input.
function ingredientPicker(container, { exclude = [], name, onChange = () => {} }) {
  container.innerHTML = `
    <input type="search" class="picker-search" placeholder="Search ingredients" autocomplete="off" aria-label="Search ingredients">
    <input type="hidden" name="${name}" required>
    <ul class="picker-list" role="listbox"></ul>`;
  const search = container.querySelector('.picker-search');
  const hidden = container.querySelector('input[type=hidden]');
  const list = container.querySelector('.picker-list');
  const choices = index.ingredients.filter((i) => !exclude.includes(i.id));
  const render = () => {
    const q = normalize(search.value.trim());
    const shown = choices.filter((i) => !q || [i.name, ...i.aliases].some((n) => normalize(n).includes(q)));
    list.innerHTML = shown
      .map((i) => `<li role="option" data-id="${i.id}" aria-selected="${i.id === hidden.value}">${esc(i.name)}${i.aliases.length ? ` <span class="muted">${esc(i.aliases.join(', '))}</span>` : ''}</li>`)
      .join('') || '<li class="muted empty">No ingredient matches</li>';
  };
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    hidden.value = li.dataset.id;
    render();
    onChange(ingredientById(li.dataset.id));
  });
  search.addEventListener('input', render);
  render();
  return { get value() { return hidden.value; } };
}

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu.menu.remove();
  openMenu = null;
}

// The row menu opens directly below its button, or directly above when
// there is not enough room below.
function showMenu(button, items) {
  closeMenu();
  const menu = h(`<div class="menu" role="menu">${items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>`);
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const below = window.innerHeight - r.bottom >= mh + 8 || r.top < mh + 8;
  menu.style.top = `${window.scrollY + (below ? r.bottom + 4 : r.top - mh - 4)}px`;
  menu.style.left = `${window.scrollX + Math.max(8, r.right - menu.offsetWidth)}px`;
  menu.dataset.side = below ? 'below' : 'above';
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    items[b.dataset.i].action();
  });
  button.setAttribute('aria-expanded', 'true');
  openMenu = { button, menu };
  menu.querySelector('button')?.focus();
}

document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('resize', closeMenu);

// ---- actions --------------------------------------------------------------

function mergeDialog(from) {
  const recipes = new Set(from.uses.map((u) => u.recipe)).size;
  const dialog = openDialog(`
    <form>
      <h2>Merge ${esc(from.name)}</h2>
      <p>Choose the ingredient to keep. ${esc(from.name)} becomes one of its aliases, its notes and substitutions move across, and ${plural(recipes, 'recipe links', 'recipes link')} to it instead.</p>
      <div class="picker"></div>
      <p class="preview muted" aria-live="polite"></p>
      <div class="actions">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary" disabled>Request merge on GitHub</button>
      </div>
    </form>`, (data) => {
    const into = ingredientById(data.get('into'));
    openRequest(`Merge ${from.name} into ${into.name}`, `Merge **${from.name}** into **${into.name}**.`, { action: 'merge-ingredients', from: from.id, into: into.id });
  });
  ingredientPicker(dialog.querySelector('.picker'), {
    exclude: [from.id],
    name: 'into',
    onChange: (into) => {
      dialog.querySelector('.preview').textContent = `${from.name} will be merged into ${into.name}.`;
      dialog.querySelector('[type=submit]').disabled = false;
    },
  });
}

function addIngredientDialog(prefill = '') {
  const dialog = openDialog(`
    <form>
      <h2>Add an ingredient</h2>
      <label>Name <input name="name" required maxlength="80" value="${esc(prefill)}" placeholder="Serrano chilli"></label>
      <label>Other names <span class="muted">(comma separated)</span> <input name="aliases" maxlength="300" placeholder="serrano, serrano pepper"></label>
      <label>Notes <span class="muted">(optional, Markdown)</span> <textarea name="notes" rows="4" maxlength="2000" placeholder="How to buy, store or prepare it"></textarea></label>
      <p class="error" aria-live="polite"></p>
      <div class="actions">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">Request on GitHub</button>
      </div>
    </form>`, (data, dlg) => {
    const name = data.get('name').trim();
    const aliases = data.get('aliases').split(',').map((a) => a.trim()).filter(Boolean);
    const clash = [name, ...aliases].map(normalize).map((n) => index.ingredients.find((i) => [i.name, ...i.aliases].some((x) => normalize(x) === n))).find(Boolean);
    if (clash) {
      dlg.querySelector('.error').textContent = `${clash.name} is already on the list under that name.`;
      return false;
    }
    openRequest(`Add the ingredient ${name}`, `Add **${name}** to the ingredient list.`, { action: 'add-ingredient', name, aliases, notes: data.get('notes').trim() });
  });
  dialog.querySelector('input[name=name]').focus();
}

function substitutionDialog(ing, slugs) {
  const titles = slugs.map((s) => recipeBySlug(s)?.title ?? s);
  const dialog = openDialog(`
    <form>
      <h2>Substitute ${esc(ing.name)}</h2>
      <p>In ${esc(titles.join(', '))}. Choose what to use instead, and say how.</p>
      <div class="picker"></div>
      <label>How to substitute <textarea name="note" rows="4" required maxlength="2000" placeholder="Use the same weight of roasted onions."></textarea></label>
      <p class="muted">Not on the list? <a href="#" class="add-new">Add the ingredient first</a>.</p>
      <div class="actions">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary" disabled>Request on GitHub</button>
      </div>
    </form>`, (data) => {
    const sub = ingredientById(data.get('with'));
    openRequest(`Substitute ${sub.name} for ${ing.name}`, `In ${titles.join(', ')}, ${ing.name} can be replaced with **${sub.name}**:\n\n> ${data.get('note').trim().replace(/\n/g, '\n> ')}`, {
      action: 'add-substitution', ingredient: ing.id, recipes: slugs, with: sub.id, note: data.get('note').trim(),
    });
  });
  ingredientPicker(dialog.querySelector('.picker'), {
    exclude: [ing.id],
    name: 'with',
    onChange: () => { dialog.querySelector('[type=submit]').disabled = false; },
  });
  dialog.querySelector('.add-new').addEventListener('click', (e) => {
    e.preventDefault();
    dialog.close();
    addIngredientDialog();
  });
}

// ---- views ------------------------------------------------------------------

function searchBox(placeholder, onInput) {
  const input = h(`<input type="search" class="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off">`);
  input.addEventListener('input', () => onInput(normalize(input.value.trim())));
  return input;
}

function factsLine(facts, source) {
  const parts = Object.entries(facts).map(([k, v]) => `<span><strong>${FACT_LABELS[k]}</strong> ${esc(v)}</span>`);
  if (source) parts.push(`<span>Adapted from <a href="${esc(source)}" rel="noopener">${esc(hostname(source))}</a></span>`);
  return parts.length ? `<p class="facts">${parts.join('<span class="sep"> · </span>')}</p>` : '';
}

function recipesView(main) {
  main.innerHTML = `<h1>${esc(index.site.title)}</h1>${index.site.description ? `<p class="lede">${esc(index.site.description)}</p>` : ''}`;
  const results = h('<div></div>');
  const order = [...index.site.categories, ...[...new Set(index.recipes.map((r) => r.category))].sort()];
  const categories = [...new Set(order)].filter((c) => index.recipes.some((r) => r.category === c));
  const render = (q) => {
    const match = (r) => !q || normalize([r.title, r.subtitle, ...r.tags, ...r.ingredients.map((id) => ingredientById(id)?.name ?? '')].join(' ')).includes(q);
    results.innerHTML = categories.map((c) => {
      const rs = index.recipes.filter((r) => r.category === c && match(r));
      if (!rs.length) return '';
      return `<section><h2>${esc(titleCase(c))}</h2><div class="cards">${rs.map((r) => `
        <a class="card" href="#/recipe/${r.slug}">
          ${r.photo ? `<img src="${esc(dataUrl(r.photo))}" alt="" loading="lazy">` : ''}
          <strong>${esc(r.title)}</strong><span>${esc(r.subtitle)}</span>
        </a>`).join('')}</div></section>`;
    }).join('') || '<p class="muted">No recipe matches.</p>';
  };
  main.append(searchBox('Search recipes, tags and ingredients', render), results);
  render('');
}

function ingredientsView(main) {
  main.innerHTML = `
    <div class="title-row"><h1>Ingredients</h1><button type="button" class="primary add-ingredient">Add ingredient</button></div>
    <p class="lede">Every ingredient in every recipe. Open one to see the recipes it is in, how each one prepares it, and what can replace it.</p>`;
  main.querySelector('.add-ingredient').addEventListener('click', () => addIngredientDialog());
  const list = h('<ul class="ingredient-list"></ul>');
  const count = h('<p class="muted count" aria-live="polite"></p>');
  const render = (q) => {
    const shown = index.ingredients.filter((i) => !q || [i.name, ...i.aliases].some((n) => normalize(n).includes(q)));
    count.textContent = `${plural(shown.length, 'ingredient', 'ingredients')}`;
    list.innerHTML = shown.map((i) => {
      const n = new Set(i.uses.map((u) => u.recipe)).size;
      return `<li class="row" data-id="${i.id}">
        <a href="#/ingredient/${i.id}"><span class="name">${esc(i.name)}</span>${i.aliases.length ? `<span class="muted aliases">${esc(i.aliases.join(', '))}</span>` : ''}</a>
        <span class="muted uses">${plural(n, 'recipe', 'recipes')}</span>
        <button type="button" class="dots" aria-label="More for ${esc(i.name)}" aria-haspopup="menu" aria-expanded="false">⋯</button>
      </li>`;
    }).join('') || '<li class="muted empty">No ingredient matches. <a href="#" class="add-from-search">Add it</a>?</li>';
    list.querySelector('.add-from-search')?.addEventListener('click', (e) => {
      e.preventDefault();
      addIngredientDialog(main.querySelector('.search').value.trim());
    });
  };
  list.addEventListener('click', (e) => {
    const button = e.target.closest('.dots');
    if (!button) return;
    if (openMenu?.button === button) return closeMenu();
    const ing = ingredientById(button.closest('.row').dataset.id);
    showMenu(button, [
      { label: 'Merge into another ingredient…', action: () => mergeDialog(ing) },
      { label: 'Open', action: () => { location.hash = `#/ingredient/${ing.id}`; } },
    ]);
  });
  const search = searchBox('Search ingredients', render);
  main.append(search, count, list);
  render('');
  search.focus();
}

function ingredientView(main, id) {
  const ing = ingredientById(id);
  if (!ing) return notFound(main, 'ingredient');
  const byRecipe = new Map();
  for (const u of ing.uses) {
    if (!byRecipe.has(u.recipe)) byRecipe.set(u.recipe, []);
    byRecipe.get(u.recipe).push(u);
  }
  const subs = ing.substitutions.map((s) => {
    const w = ingredientById(s.with);
    const rs = s.recipes.map((slug) => `<a href="#/recipe/${slug}">${esc(recipeBySlug(slug)?.title ?? slug)}</a>`).join(', ');
    return `<li><p><strong>Use <a href="#/ingredient/${s.with}">${esc(w?.name ?? s.with)}</a></strong> <span class="muted">in ${rs}</span></p>${md(s.note)}</li>`;
  }).join('');
  const editUrl = `${github}/edit/${config.branch}/ingredients/${id}.md`;
  main.innerHTML = `
    <p class="crumbs"><a href="#/ingredients">Ingredients</a></p>
    <h1>${esc(ing.name)}</h1>
    ${ing.aliases.length ? `<p class="muted">Also called ${esc(ing.aliases.join(', '))}</p>` : ''}
    <section>
      <h2>Used in</h2>
      ${byRecipe.size ? `<form class="uses-form">
        <table class="uses-table">
          <thead><tr><th class="check"><span class="sr-only">Select</span></th><th>Recipe</th><th>How it is used</th></tr></thead>
          <tbody>${[...byRecipe].map(([slug, uses]) => `
            <tr>
              <td class="check"><input type="checkbox" name="recipe" value="${slug}" aria-label="Select ${esc(recipeBySlug(slug)?.title ?? slug)}"></td>
              <td><a href="#/recipe/${slug}">${esc(recipeBySlug(slug)?.title ?? slug)}</a></td>
              <td>${uses.map((u) => `<div>${u.group ? `<span class="muted">${esc(u.group)}:</span> ` : ''}${esc(u.line)}</div>`).join('')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="actions start">
          <button type="submit" class="primary" disabled>Add substitution note</button>
          <span class="muted hint">Select the recipes it applies to.</span>
        </div>
      </form>` : '<p class="muted">No recipe uses it yet.</p>'}
    </section>
    <section><h2>Substitutions</h2>${subs ? `<ul class="subs">${subs}</ul>` : '<p class="muted">None yet. Select recipes above to add one.</p>'}</section>
    <section><h2>Notes</h2>${ing.notes ? `<div class="prose">${md(ing.notes)}</div>` : '<p class="muted">No notes yet.</p>'}
      <p><a href="${esc(editUrl)}" rel="noopener">Edit the notes on GitHub</a></p></section>`;
  const form = main.querySelector('.uses-form');
  if (form) {
    const submit = form.querySelector('[type=submit]');
    form.addEventListener('change', () => {
      const n = form.querySelectorAll('input[name=recipe]:checked').length;
      submit.disabled = n === 0;
      form.querySelector('.hint').textContent = n ? `${plural(n, 'recipe', 'recipes')} selected.` : 'Select the recipes it applies to.';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      substitutionDialog(ing, [...form.querySelectorAll('input[name=recipe]:checked')].map((c) => c.value));
    });
  }
}

async function recipeView(main, slug) {
  const meta = recipeBySlug(slug);
  if (!meta) return notFound(main, 'recipe');
  main.innerHTML = `<h1>${esc(meta.title)}</h1><p class="muted">Loading…</p>`;
  const r = await loadRecipe(slug);
  // Substitution notes that apply to this recipe, by ingredient.
  const subsFor = (id) => (ingredientById(id)?.substitutions ?? []).filter((s) => s.recipes.includes(slug));
  const groups = r.ingredientGroups.map((g) => `
    ${g.title ? `<h3>${esc(g.title)}</h3>` : ''}
    <ul class="ingredients">${g.items.map((item) => {
      const subs = item.refs.flatMap((ref) => subsFor(ref.id).map((s) => ({ ...s, of: ref.id })));
      return `<li>${mdInline(item.markdown)}${subs.map((s) => `
        <div class="swap"><span class="swap-label">Swap</span> <a href="#/ingredient/${s.with}">${esc(ingredientById(s.with)?.name ?? s.with)}</a>: ${mdInline(s.note)}</div>`).join('')}</li>`;
    }).join('')}</ul>`).join('');
  const steps = r.steps.map((s) => `<li>${s.name ? `<strong>${esc(s.name)}.</strong> ` : ''}${mdInline(s.markdown)}</li>`).join('');
  const rest = r.sections.filter((s) => s.title !== 'Ingredients' && s.title !== 'Method')
    .map((s) => `<section><h2>${esc(s.title)}</h2>${md(s.markdown)}</section>`).join('');
  main.innerHTML = `
    <p class="crumbs"><a href="#/">${esc(index.site.title)}</a> / ${esc(titleCase(r.category))}</p>
    <h1>${esc(r.title)}</h1>
    <p class="subtitle">${esc(r.subtitle)}</p>
    ${factsLine(r.facts, r.source)}
    <p class="tools"><a href="${esc(dataUrl(`cards/${slug}.pdf`))}">Recipe card (A5 PDF)</a> · <a href="${esc(`${github}/blob/${config.branch}/${r.path}`)}" rel="noopener">Source on GitHub</a></p>
    ${r.photo ? `<figure><img src="${esc(dataUrl(r.photo))}" alt="${esc(r.photoAlt)}"></figure>` : ''}
    <div class="prose intro">${md(r.intro)}</div>
    <div class="recipe-body">
      <section class="ingredients-col"><h2>Ingredients</h2>${groups}</section>
      <section class="method-col"><h2>Method</h2><ol class="steps">${steps}</ol></section>
    </div>
    <div class="prose">${rest}</div>`;
}

function notFound(main, what) {
  main.innerHTML = `<h1>Not found</h1><p>There is no such ${what}. <a href="#/">Back to the recipes</a>.</p>`;
}

// ---- shell and routing --------------------------------------------------------

function shell() {
  document.body.innerHTML = `
    <header class="site-header">
      <a class="site-title" href="#/"></a>
      <nav><a href="#/" data-nav="recipes">Recipes</a><a href="#/ingredients" data-nav="ingredients">Ingredients</a></nav>
    </header>
    <main id="main"></main>
    <footer class="site-footer muted">Recipes from <a href="${esc(github)}" rel="noopener">${esc(config.repo)}</a> · served with <a href="https://github.com/schryer/recipe-host" rel="noopener">recipe-host</a></footer>`;
}

async function route() {
  closeMenu();
  const main = document.getElementById('main');
  const [, view = '', arg] = (location.hash || '#/').split('/');
  const section = view.startsWith('ingredient') ? 'ingredients' : 'recipes';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));
  try {
    if (view === 'recipe') await recipeView(main, decodeURIComponent(arg ?? ''));
    else if (view === 'ingredients') ingredientsView(main);
    else if (view === 'ingredient') ingredientView(main, decodeURIComponent(arg ?? ''));
    else recipesView(main);
  } catch (err) {
    main.innerHTML = `<h1>Something went wrong</h1><p>${esc(err.message)}</p>`;
  }
  const h1 = main.querySelector('h1');
  document.title = h1 && view ? `${h1.textContent} · ${index.site.title}` : index.site.title;
  window.scrollTo(0, 0);
}

async function start() {
  shell();
  try {
    await resolveData();
    index = await getJson('index.json');
  } catch (err) {
    document.getElementById('main').innerHTML = `<h1>Could not load the recipes</h1><p>${esc(err.message)}</p>`;
    return;
  }
  document.querySelector('.site-title').textContent = index.site.title;
  window.addEventListener('hashchange', route);
  route();
}

start();
