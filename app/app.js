// State and actions behind app/index.html: loading the built data, routing
// on the URL hash, rendering Markdown, and turning the site's buttons into
// GitHub requests. The markup is in index.html; Alpine.js connects the two.

/* global Alpine, marked, oidc */

const config = window.RECIPE_HOST;

// `?repo=owner/name` shows another repository's recipes on this page; without
// it the page shows the repository it was built for. Every recipe repository
// publishes its built data to a `site` branch, so any public one works.
const asked = new URLSearchParams(location.search).get('repo');
const repo = /^[\w.-]+\/[\w.-]+$/.test(asked ?? '') ? asked : config.repo;
const github = `https://github.com/${repo}`;
const FACT_LABELS = { serves: 'Serves', makes: 'Makes', prep: 'Prep', cook: 'Cook', rest: 'Rest', total: 'Total' };
// The header's links: label, address, and the views that light it up.
const NAV = [['Home', '#/', ['home']], ['Recipes', '#/recipes', ['recipes', 'recipe']], ['Ingredients', '#/ingredients', ['ingredients', 'ingredient']]];
// Tags that name a meal; the recipe lists filter on them next to the categories.
const MEALS = ['breakfast', 'lunch', 'dinner'];

// Favourites are kept per repository, so a page showing `?repo=` has its own.
// A store is `{ load(): Promise<string[]>, save(slugs): Promise<void> }`;
// load() may reject (offline), and the page then keeps what it shows. Every
// store keeps the same document.
const favouritesDocument = (slugs) => JSON.stringify({ version: 1, favourites: slugs, updated: new Date().toISOString() });
const readFavourites = (saved) => (Array.isArray(saved?.favourites) ? saved.favourites.filter((s) => typeof s === 'string') : []);

// This browser's localStorage, for a reader who is not signed in.
function localFavourites(name) {
  const key = `recipe-host:favourites:${name}`;
  return {
    async load() {
      return readFavourites(JSON.parse(localStorage.getItem(key) ?? 'null'));
    },
    async save(slugs) {
      localStorage.setItem(key, favouritesDocument(slugs));
    },
  };
}

// One JSON file per repository, kept for the signed-in reader somewhere
// else. `get()` and `put(body)` answer fetch Responses; a 404 means nothing
// is kept yet, and then what this browser kept is carried over.
function keptFavourites(get, put, local) {
  return {
    async load() {
      const res = await get();
      if (res.status === 404) {
        const slugs = await local.load();
        if (slugs.length) await this.save(slugs);
        return slugs;
      }
      if (!res.ok) throw new Error(`Could not read your favourites (${res.status})`);
      return readFavourites(await res.json());
    },
    async save(slugs) {
      const res = await put(favouritesDocument(slugs));
      if (!res.ok) throw new Error(`Could not save your favourites (${res.status})`);
    },
  };
}

const JSON_BODY = { 'content-type': 'application/json' };

// ---- signing in
// `login` in recipe-host.yml signs readers in one of two ways. Only
// `?repo=` survives the trip, and the addresses may be relative, which the
// local mock (lib/mock-login.js) uses.
const shownPage = `${location.origin}${location.pathname}${repo === asked ? `?repo=${repo}` : ''}`;

// `issuer` and `client`: OpenID Connect in the page, the code flow with
// PKCE through oidc-client-ts, coming back to this page. Tokens are kept
// for the tab only and renewed with the refresh token. Favourites, when
// `favourites` names a service, go to a file in the reader's own bucket:
// the service checks the access token and answers a link valid for a few
// minutes, so the page never holds the bucket's keys.
function openIdLogin(settings) {
  const auth = new oidc.UserManager({
    authority: new URL(settings.login.issuer, location.href).href,
    client_id: settings.login.client,
    redirect_uri: shownPage,
    post_logout_redirect_uri: shownPage,
    scope: 'openid profile',
    userStore: new oidc.WebStorageStateStore({ store: sessionStorage }),
    automaticSilentRenew: true,
  });

  async function accessToken() {
    let user = await auth.getUser();
    if (!user || user.expired) user = await auth.signinSilent();
    return user.access_token;
  }

  async function link(service, method, key) {
    const res = await fetch(new URL('v1/presign', service), {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, ...JSON_BODY },
      body: JSON.stringify({ method, key }),
    });
    if (!res.ok) throw new Error(`The favourites service answered ${res.status}`);
    return (await res.json()).url;
  }

  return {
    // The signed-in reader's name, or null: finishes a sign-in that has
    // just come back to this page, or renews one the tab already had.
    async signedIn() {
      const params = new URLSearchParams(location.search);
      let user;
      if (params.has('state') && (params.has('code') || params.has('error'))) {
        try {
          user = await auth.signinCallback();
        } finally {
          // Off the address bar, so a reload does not replay it.
          history.replaceState(null, '', shownPage + (user?.state?.hash ?? ''));
        }
      } else {
        user = await auth.getUser();
        if (user?.expired) user = user.refresh_token ? await auth.signinSilent().catch(() => null) : null;
      }
      return user ? (user.profile.name ?? user.profile.preferred_username ?? 'Signed in') : null;
    },
    signIn: () => void auth.signinRedirect({ state: { hash: location.hash } }),
    signOut: () => void auth.signoutRedirect(),
    favourites(name, local) {
      if (!settings.favourites) return local;
      const service = new URL(settings.favourites, location.href);
      const key = `favourites/${name}.json`;
      return keptFavourites(
        async () => fetch(await link(service, 'GET', key), { cache: 'no-store' }),
        async (body) => fetch(await link(service, 'PUT', key), { method: 'PUT', headers: JSON_BODY, body }),
        local);
    },
  };
}

// `session`: a service on the same site (a sibling host under the same
// domain) that signs readers in itself and remembers them with its own
// cookie, which the browser sends along. It answers
//   GET me                               {email, name?}, or 401
//   GET sign-in?rd=<page>, sign-out?rd=  sends the reader there and back
//   GET, PUT favourites/<owner>/<name>.json   the reader's favourites (404: none yet)
function sessionLogin(settings) {
  const service = new URL(settings.login.session, location.href);
  const away = (path) => location.assign(`${new URL(path, service)}?rd=${encodeURIComponent(shownPage + location.hash)}`);
  const call = (path, init = {}) => fetch(new URL(path, service), { credentials: 'include', cache: 'no-store', ...init });
  return {
    async signedIn() {
      const res = await call('me');
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`the sign-in service answered ${res.status}`);
      const me = await res.json();
      return me.name || me.email;
    },
    signIn: () => away('sign-in'),
    signOut: () => away('sign-out'),
    favourites(name, local) {
      const path = `favourites/${name}.json`;
      return keptFavourites(() => call(path), (body) => call(path, { method: 'PUT', headers: JSON_BODY, body }), local);
    },
  };
}

function signInWith(settings) {
  if (!settings.login) return null;
  return settings.login.session ? sessionLogin(settings) : openIdLogin(settings);
}

const login = signInWith(config);

// This browser's favourites, or the signed-in reader's kept elsewhere.
function favouritesStore(name, signedIn = false) {
  const local = localFavourites(name);
  return signedIn ? login.favourites(name, local) : local;
}

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
        const recipe = href.split('/').pop().match(/^([a-z0-9-]+)\.md$/);
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

// How often an open page checks for a newer publish.
const UPDATE_EVERY = 60 * 60 * 1000;

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

// The settings of a fresh copy of this page from its own host: a newer
// publish deploys a page naming its data and that data's hash, and only
// then does a page with checked data switch to it. Null until the host has
// the newer page, or when it can't be reached.
async function hostedSettings() {
  try {
    const res = await fetch(location.href.split('#')[0], { cache: 'no-cache' });
    const json = res.ok && (await res.text()).match(/window\.RECIPE_HOST = (\{.*\});<\/script>/)?.[1];
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
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
    NAV,
    base: null,
    index: null,
    // Subresource Integrity hashes of the data files, by path under `base`:
    // index.json's from the page, every recipe's from index.json. A file
    // with a hash here is refused unless it matches.
    integrity: {},
    error: null,
    // Set when `?repo=` names a repository with nothing published: why.
    notSetUp: null,
    route: { view: 'home', arg: null },
    recipe: null,
    notFound: false,
    q: '',
    selected: [],
    menu: null,
    dialog: null,
    form: {},
    filters: [],
    favourites: [],
    store: favouritesStore(repo),
    signsIn: Boolean(login),
    account: null,
    signInNeeded: false,
    signInError: null,

    async init() {
      if (login) {
        const name = await login.signedIn().catch((err) => {
          this.signInError = err.error === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in did not work: ${err.message}`;
          return null;
        });
        if (name) {
          this.account = { name };
          this.store = favouritesStore(repo, true);
        } else if (config.login.required) {
          this.signInNeeded = true;
          return;
        }
      }
      try {
        this.base = await dataBase();
        if (config.dataIntegrity && this.base === new URL(config.data, location.href).href) this.integrity = { 'index.json': config.dataIntegrity };
        await this.loadIndex();
      } catch (err) {
        if (repo === config.repo) this.error = err.message;
        else this.notSetUp = err.message;
        return;
      }
      window.addEventListener('hashchange', () => this.show());
      this.show();
      this.watchForUpdates();
      await this.loadFavourites();
      // Back on the tab: pick up what another tab or device saved meanwhile.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.loadFavourites());
    },

    // An unreadable store leaves the favourites shown rather than failing the page.
    async loadFavourites() {
      this.favourites = await this.store.load().catch(() => this.favourites);
    },

    signIn() {
      login.signIn();
    },

    signOut() {
      login.signOut();
    },

    // ---- newer publishes
    // A page reads one commit of the `site` branch for as long as it is open.
    // Every hour, and when the tab comes back after an hour away, it asks
    // GitHub for the newest commit; if there is a newer one, the bell in the
    // header lights up and the reload button switches to it. The page itself
    // may come from the browser's cache, so it also checks once on opening.
    update: null,
    checkedAt: 0,

    get pinned() { return this.base?.match(/@([0-9a-f]{40})\/$/)?.[1] ?? null; },

    watchForUpdates() {
      if (!this.pinned) return;
      const check = () => { if (Date.now() - this.checkedAt >= UPDATE_EVERY) void this.checkForUpdate(); };
      // checkForUpdate() handles its own errors, so nothing waits for it.
      void this.checkForUpdate();
      setInterval(check, UPDATE_EVERY);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },

    async checkForUpdate() {
      this.checkedAt = Date.now();
      const sha = await latestSite();
      // Offline or rate limited: keep what the last check found.
      if (sha) this.update = sha === this.pinned ? null : sha;
    },

    // Switches to the newer publish without go(), so nothing typed or
    // ticked meanwhile is lost.
    async applyUpdate() {
      const base = atCommit(this.update);
      const before = { base: this.base, index: this.index, integrity: this.integrity };
      try {
        // Checked data is replaced only by data the host's newer page
        // names the hash of; until that page is deployed, the bell stays lit.
        if (this.integrity['index.json']) {
          const fresh = await hostedSettings();
          if (!fresh?.dataIntegrity || new URL(fresh.data, location.href).href !== base) return;
          this.integrity = { 'index.json': fresh.dataIntegrity };
        } else this.integrity = {};
        this.base = base;
        await this.loadIndex();
        this.update = null;
        if (this.recipe) this.recipe = await this.fetchJson(`recipes/${this.recipe.slug}.json`);
      } catch {
        // Keep showing this commit; the bell stays lit to try again.
        Object.assign(this, before);
      }
    },

    async loadIndex() {
      const index = await this.fetchJson('index.json');
      this.integrity = { ...index.integrity, ...this.integrity };
      this.index = index;
    },

    // A fetch whose integrity does not match rejects, like a network error.
    async fetchJson(path) {
      const integrity = this.integrity[path];
      const res = await fetch(this.dataUrl(path), integrity ? { integrity } : {});
      if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
      return res.json();
    },

    // go() for an event handler, showing any failure instead of dropping it.
    show() {
      this.go().catch((err) => { this.error = err.message; });
    },

    async go() {
      const [, view = '', arg] = (location.hash || '#/').split('/');
      this.route = { view: view || 'home', arg: arg && decodeURIComponent(arg) };
      Object.assign(this, { q: '', selected: [], menu: null, dialog: null, recipe: null, notFound: false });
      if (this.route.view === 'recipe') {
        if (this.index.recipes.some((r) => r.slug === this.route.arg)) {
          this.recipe = await this.fetchJson(`recipes/${this.route.arg}.json`).catch((err) => { this.error = err.message; });
        } else this.notFound = true;
      }
      if (this.route.view === 'ingredient' && !this.ingredient) this.notFound = true;
      if (!NAV.some(([, , views]) => views.includes(this.route.view))) this.notFound = true;
      const name = this.recipe?.title ?? this.ingredient?.name ?? { recipes: 'All recipes', ingredients: 'Ingredients' }[this.route.view];
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

    // ---- favourites and the recipe lists
    get categories() {
      return [...new Set([...this.index.site.categories, ...this.index.recipes.map((r) => r.category).sort()])]
        .filter((c) => this.index.recipes.some((r) => r.category === c));
    },
    get favouriteRecipes() { return this.index.recipes.filter((r) => this.favourites.includes(r.slug)); },
    isFavourite(slug) { return this.favourites.includes(slug); },
    toggleFavourite(slug) {
      this.favourites = this.isFavourite(slug) ? this.favourites.filter((s) => s !== slug) : [...this.favourites, slug];
      // A failed save keeps the change on screen; the next one saves it again.
      this.store.save(this.favourites).catch(() => {});
    },
    // Filter chips: one group for the categories, one for the meals. Ticking
    // several in a group shows recipes matching any of them; both groups
    // together show recipes matching one of each.
    get filterGroups() { return [['Type', this.categories], ['Meal', MEALS]]; },
    toggleFilter(key) {
      this.filters = this.filters.includes(key) ? this.filters.filter((f) => f !== key) : [...this.filters, key];
    },
    hasKey: (r, key) => r.category === key || r.tags.includes(key),
    countFor(key, recipes) { return this.searched(recipes).filter((r) => this.hasKey(r, key)).length; },
    searched(recipes) {
      const q = normalize(this.q.trim());
      return recipes.filter((r) => !q || normalize([r.title, r.subtitle, ...r.tags, ...r.ingredients.map((id) => this.ingredientName(id))].join(' ')).includes(q));
    },
    // The recipes left after the search and the filters, by title.
    shown(recipes) {
      const types = this.filters.filter((f) => !MEALS.includes(f));
      const meals = this.filters.filter((f) => MEALS.includes(f));
      return this.searched(recipes)
        .filter((r) => (!types.length || types.includes(r.category)) && (!meals.length || meals.some((m) => r.tags.includes(m))))
        .sort((a, b) => a.title.localeCompare(b.title));
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
    // The ⋯ menu of a row on the recipe or ingredient list.
    toggleMenu(id, item, button) {
      this.menu = this.menu?.id === id ? null : { id, item, button };
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
