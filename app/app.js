// State and actions behind app/index.html: loading the built data, routing
// on the URL hash, rendering Markdown, and turning the site's buttons into
// GitHub requests. The markup is in index.html; Alpine.js connects the two.

/* global Alpine, marked */

const config = window.RECIPE_HOST;

// `?repo=owner/name` shows another repository's recipes on this page; without
// it the page shows the repository it was built for. Every recipe repository
// publishes its built data to a `site` branch, so any public one works.
const asked = new URLSearchParams(location.search).get('repo');
const repo = /^[\w.-]+\/[\w.-]+$/.test(asked ?? '') ? asked : config.repo;
const github = `https://github.com/${repo}`;
const FACT_LABELS = { serves: 'Serves', makes: 'Makes', prep: 'Prep', cook: 'Cook', rest: 'Rest', total: 'Total' };

// Links in recipe Markdown point at repository files; on the site they
// become routes. Raw HTML is dropped, so x-html only ever shows Markdown.
function setUpMarked() {
  marked.use({
    gfm: true,
    renderer: {
      html: () => '',
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const ing = href.match(/^\/ingredients\/([a-z0-9-]+)\.md$/);
        if (ing) return `<a class="ingredient-link" href="#/ingredient/${ing[1]}">${text}</a>`;
        if (/^https?:/.test(href)) return `<a href="${encodeURI(href)}" rel="noopener">${text}</a>`;
        const recipe = href.match(/([a-z0-9-]+)\.md$/);
        return recipe ? `<a href="#/recipe/${recipe[1]}">${text}</a>` : text;
      },
      image: ({ href, text }) => (/^https?:/.test(href) ? `<img src="${encodeURI(href)}" alt="">` : ''),
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const alert = body.match(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
        return alert ? `<aside class="alert"><p>${body.slice(alert[0].length)}</aside>` : `<blockquote>${body}</blockquote>`;
      },
    },
  });
}

// The newest commit of the `site` branch, or null when GitHub's API can't be
// reached (offline, or rate limited).
async function latestSite() {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/site`, { headers: { Accept: 'application/vnd.github.sha' } });
    const sha = res.ok ? (await res.text()).trim() : '';
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

const atCommit = (sha) => `https://cdn.jsdelivr.net/gh/${repo}@${sha}/`;

// Where the data is read from. A published page names the commit it was
// deployed with (`config.data`), and a local preview names its own folder.
// Otherwise it is the newest commit of the `site` branch, or the branch
// itself when GitHub's API can't be reached. A commit URL on jsDelivr never
// changes, so it is cached for good.
async function dataBase() {
  if (config.data && repo === config.repo) return new URL(config.data, location.href).href;
  return atCommit((await latestSite()) ?? 'site');
}

const normalize = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Opens a prefilled GitHub issue holding the request as JSON; see
// lib/requests.js for what the workflow does with it.
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
  window.open(`${github}/issues/new?${new URLSearchParams({ title, body })}`, '_blank', 'noopener');
}

document.addEventListener('alpine:init', () => {
  setUpMarked();

  Alpine.data('site', () => ({
    config,
    repo,
    github,
    base: null,
    index: null,
    error: null,
    route: { view: 'recipes', arg: null },
    recipe: null,
    notFound: false,
    q: '',
    selected: [],
    menu: null,
    dialog: null,
    form: {},

    async init() {
      try {
        this.base = await dataBase();
        this.index = await this.fetchJson('index.json');
      } catch (err) {
        this.error = repo === config.repo ? err.message
          : `Found no published recipes in ${repo}. It needs to be a public GitHub repository whose recipe-host workflow has run (${err.message}).`;
        return;
      }
      window.addEventListener('hashchange', () => this.go());
      this.go();
      this.refresh();
    },

    // A page pinned to one commit shows it at once. The page itself may come
    // from the browser's cache, though, so check for a newer publish and
    // switch to it.
    async refresh() {
      const pinned = this.base.match(/@([0-9a-f]{40})\/$/)?.[1];
      if (!pinned) return;
      const sha = await latestSite();
      if (!sha || sha === pinned) return;
      try {
        const base = atCommit(sha);
        const res = await fetch(new URL('index.json', base));
        if (!res.ok) return;
        this.index = await res.json();
        this.base = base;
        // Without go(), so nothing typed or ticked meanwhile is lost.
        if (this.recipe) this.recipe = await this.fetchJson(`recipes/${this.recipe.slug}.json`);
      } catch {
        // Keep showing the pinned commit.
      }
    },

    async fetchJson(path) {
      const res = await fetch(this.dataUrl(path));
      if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
      return res.json();
    },

    async go() {
      const [, view = '', arg] = (location.hash || '#/').split('/');
      this.route = { view: view || 'recipes', arg: arg && decodeURIComponent(arg) };
      Object.assign(this, { q: '', selected: [], menu: null, dialog: null, recipe: null, notFound: false });
      if (this.route.view === 'recipe') {
        if (this.index.recipes.some((r) => r.slug === this.route.arg)) {
          this.recipe = await this.fetchJson(`recipes/${this.route.arg}.json`).catch((err) => { this.error = err.message; });
        } else this.notFound = true;
      }
      if (this.route.view === 'ingredient' && !this.ingredient) this.notFound = true;
      if (!['recipes', 'recipe', 'ingredients', 'ingredient'].includes(this.route.view)) this.notFound = true;
      const name = this.recipe?.title ?? this.ingredient?.name ?? (this.route.view === 'ingredients' ? 'Ingredients' : null);
      document.title = name ? `${name} · ${this.index.site.title}` : this.index.site.title;
      window.scrollTo(0, 0);
    },

    // ---- lookups and formatting
    // The shown repository's own settings, from its data once loaded.
    get title() { return this.index?.site.title ?? (repo === config.repo ? config.title : repo); },
    get branch() { return this.index?.site.branch ?? config.branch; },
    dataUrl(path) { return new URL(path, this.base).href; },
    md: (text) => marked.parse(text ?? ''),
    mdInline: (text) => marked.parseInline(text ?? ''),
    plural: (n, one, many) => `${n} ${n === 1 ? one : many}`,
    titleCase: (s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    hostname(url) {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
    },
    facts: (r) => Object.entries(r.facts).map(([k, v]) => [FACT_LABELS[k], v]),
    ingredientName(id) { return this.index.ingredients.find((i) => i.id === id)?.name ?? id; },
    recipeTitle(slug) { return this.index.recipes.find((r) => r.slug === slug)?.title ?? slug; },
    recipeCount: (i) => new Set(i.uses.map((u) => u.recipe)).size,

    // ---- recipes view
    get categories() {
      return [...new Set([...this.index.site.categories, ...this.index.recipes.map((r) => r.category).sort()])]
        .filter((c) => this.index.recipes.some((r) => r.category === c));
    },
    recipesIn(category) {
      const q = normalize(this.q.trim());
      return this.index.recipes.filter((r) => r.category === category
        && (!q || normalize([r.title, r.subtitle, ...r.tags, ...r.ingredients.map((id) => this.ingredientName(id))].join(' ')).includes(q)));
    },
    // Substitution notes that apply to one ingredient line of this recipe.
    swapsFor(item) {
      return item.refs.flatMap((ref) => (this.index.ingredients.find((i) => i.id === ref.id)?.substitutions ?? [])
        .filter((s) => s.recipes.includes(this.recipe.slug)));
    },

    // ---- ingredient list and page
    get ingredients() {
      const q = normalize(this.q.trim());
      return this.index.ingredients.filter((i) => !q || [i.name, ...i.aliases].some((n) => normalize(n).includes(q)));
    },
    get ingredient() {
      return this.route.view === 'ingredient' ? this.index?.ingredients.find((i) => i.id === this.route.arg) : null;
    },
    // The ingredient's uses, one entry per recipe.
    get uses() {
      const byRecipe = new Map();
      for (const u of this.ingredient?.uses ?? []) {
        if (!byRecipe.has(u.recipe)) byRecipe.set(u.recipe, { recipe: u.recipe, lines: [] });
        byRecipe.get(u.recipe).lines.push(u);
      }
      return [...byRecipe.values()];
    },
    toggleMenu(ingredient, button) {
      this.menu = this.menu?.id === ingredient.id ? null : { id: ingredient.id, ingredient, button };
    },

    // ---- dialogs; each ends in a GitHub request
    get pickable() {
      const q = normalize((this.form.pick ?? '').trim());
      const exclude = this.dialog === 'merge' ? this.form.from?.id : this.ingredient?.id;
      return this.index.ingredients.filter((i) => i.id !== exclude && (!q || [i.name, ...i.aliases].some((n) => normalize(n).includes(q))));
    },
    openMerge(from) {
      this.menu = null;
      this.form = { from, pick: '', choice: null };
      this.dialog = 'merge';
    },
    openAdd(name = '') {
      this.form = { name, aliases: '', notes: '', error: '' };
      this.dialog = 'add';
    },
    openSubstitute() {
      this.form = { pick: '', choice: null, note: '' };
      this.dialog = 'substitute';
    },
    requestMerge() {
      const { from } = this.form;
      const into = this.index.ingredients.find((i) => i.id === this.form.choice);
      openRequest(`Merge ${from.name} into ${into.name}`, `Merge **${from.name}** into **${into.name}**.`,
        { action: 'merge-ingredients', from: from.id, into: into.id });
      this.dialog = null;
    },
    requestAdd() {
      const name = this.form.name.trim();
      const aliases = this.form.aliases.split(',').map((a) => a.trim()).filter(Boolean);
      const taken = [name, ...aliases].map(normalize);
      const clash = this.index.ingredients.find((i) => [i.name, ...i.aliases].some((n) => taken.includes(normalize(n))));
      if (clash) {
        this.form.error = `${clash.name} is already on the list under that name.`;
        return;
      }
      openRequest(`Add the ingredient ${name}`, `Add **${name}** to the ingredient list.`,
        { action: 'add-ingredient', name, aliases, notes: this.form.notes.trim() });
      this.dialog = null;
    },
    requestSubstitution() {
      const ing = this.ingredient;
      const sub = this.index.ingredients.find((i) => i.id === this.form.choice);
      const note = this.form.note.trim();
      const titles = this.selected.map((s) => this.recipeTitle(s)).join(', ');
      openRequest(`Substitute ${sub.name} for ${ing.name}`,
        `In ${titles}, ${ing.name} can be replaced with **${sub.name}**:\n\n> ${note.replace(/\n/g, '\n> ')}`,
        { action: 'add-substitution', ingredient: ing.id, recipes: this.selected, with: sub.id, note });
      this.dialog = null;
    },
  }));
});
