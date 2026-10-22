// The site's one HTML page: app/index.html with its {{…}} placeholders
// filled in. Everything it loads comes from jsDelivr at the versions below,
// which match package.json so `serve` can use the same files from
// node_modules.

import fs from 'node:fs';

const TEMPLATE = new URL('../app/index.html', import.meta.url);
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const ASSETS = {
  pure: ['purecss', '3.1.0', 'build/pure-min.css'],
  nunito: ['@fontsource-variable/nunito', '5.3.0', 'index.css'],
  nunitoSans: ['@fontsource-variable/nunito-sans', '5.3.0', 'opsz.css'],
  marked: ['marked', '18.1.0', 'lib/marked.umd.js'],
  anchor: ['@alpinejs/anchor', '3.17.4', 'dist/cdn.min.js'],
  alpine: ['alpinejs', '3.17.4', 'dist/cdn.min.js'],
  oidc: ['oidc-client-ts', '3.5.0', 'dist/browser/oidc-client-ts.min.js'],
};

// This version of the app on jsDelivr.
export const DEFAULT_ENGINE = `https://cdn.jsdelivr.net/gh/schryer/recipe-host@v${version}/app/`;

const jsdelivr = (name, ver, file) => `https://cdn.jsdelivr.net/npm/${name}@${ver}/${file}`;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// `engine` is the URL of the app/ folder; `asset(name, version, file)` gives
// each library's URL; `data` fixes where the built data is read from. A
// published page sets `data` to one commit of the `site` branch on jsDelivr:
// the URLs then never change, so browsers and the CDN cache them for good,
// and the next publish deploys a page naming the next commit. Without
// `data`, the page asks GitHub for the newest commit each time it opens.
// `login` and `favourites` replace the repository's own settings; a local
// preview uses them to point the page at lib/mock-login.js.
export function pageHtml(config, { engine = DEFAULT_ENGINE, asset = jsdelivr, data = null, login = config.login, favourites = config.favourites } = {}) {
  const site = { repo: config.repo, branch: config.branch, title: config.title, data, login: login ?? null, favourites: favourites ?? null };
  const values = {
    title: escapeHtml(config.title),
    description: escapeHtml(config.description),
    repo: escapeHtml(config.repo),
    engine: escapeHtml(engine),
    // JSON inside a <script>: `<` is escaped so no value can close the tag.
    config: JSON.stringify(site).replace(/</g, '\\u003c'),
  };
  for (const [key, spec] of Object.entries(ASSETS)) values[key] = escapeHtml(asset(...spec));
  // The sign-in library loads only on a site that signs people in.
  values.oidc = login ? `<script defer src="${values.oidc}"></script>` : '';
  // Start loading the index while the scripts load, unless the page needs
  // sign-in: then nothing of the recipes is fetched before it.
  values.preload = data && !login?.required ? `<link rel="preload" href="${escapeHtml(data)}index.json" as="fetch" crossorigin>` : '';
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}
