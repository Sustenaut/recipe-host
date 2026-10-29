// The site's one HTML page: app/index.html with its {{…}} placeholders
// filled in. Everything it loads comes from jsDelivr at the versions below,
// which match package.json so `serve` can use the same files from
// node_modules.

import crypto from 'node:crypto';
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

// Each file above, as Subresource Integrity: the page names the hash, and a
// browser refuses a file that does not match it, whatever served it. A
// version change in ASSETS needs its new hash here; the tests compare each
// one with the file in node_modules and print the right value.
export const INTEGRITY = {
  pure: 'sha384-kj0X2NG2KHBie8Tq8fH1kxnyWM9XsXQpq7XdwbKmFKjwwaXGKBlB2Klu3VOltSFx',
  nunito: 'sha384-FDR7j6lZyUZH3b9V+42MUpI0gtW/yEJL0sCL6vjhnGMPvEN3BAyS1cF45S7Z2t0c',
  nunitoSans: 'sha384-s6JAIVaJhxesVRw1CFNLaLCPx+/BGAv6Wdhm9/IWMdbvk+FoP+9YwZEemySHa5T8',
  marked: 'sha384-IvVdUXkhyoD0shbjhiiOnuiTbervTaB0VJcnEcg3shUAMVOOF6lKj4ozJrCwvz6s',
  anchor: 'sha384-xLYun/iMcsUz+54yVQcBNAQFea38EXWtVZjLjKeAC67cEpFjEyqI/wPa9NtbFBnK',
  alpine: 'sha384-5/joNqFnRyVWzXp99bHot6RHG+EksGp+USSgZwPar7T9SD9PKKER37n/8bXBAZGd',
  oidc: 'sha384-PTRVZ+Irwhdd38ou1In8Amo5/CLZci9zRlwSiS7/OUYo6TbYw8QYTCkn6rKod6Tb',
};

// The Subresource Integrity of `bytes`, as an integrity attribute takes it.
export function sri(bytes) {
  return `sha384-${crypto.createHash('sha384').update(bytes).digest('base64')}`;
}

// The app's own script and stylesheet, hashed as this release ships them:
// the engine on jsDelivr is this same app/ folder at this version's tag.
const APP = new URL('../app/', import.meta.url);
const appIntegrity = (file) => sri(fs.readFileSync(new URL(file, APP)));

// This version of the app on jsDelivr.
export const DEFAULT_ENGINE = `https://cdn.jsdelivr.net/gh/Sustenaut/recipe-host@v${version}/app/`;

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
// `dataIntegrity` is the Subresource Integrity hash of `data`'s index.json,
// which in turn holds the hash of every recipe file, so the page refuses
// data that is not what was published.
// `login` and `favourites` replace the repository's own settings; a local
// preview uses them to point the page at lib/mock-login.js.
export function pageHtml(config, { engine = DEFAULT_ENGINE, asset = jsdelivr, data = null, dataIntegrity = null, login = config.login, favourites = config.favourites } = {}) {
  const site = { repo: config.repo, branch: config.branch, title: config.title, data, dataIntegrity, login: login ?? null, favourites: favourites ?? null };
  const values = {
    title: escapeHtml(config.title),
    description: escapeHtml(config.description),
    repo: escapeHtml(config.repo),
    engine: escapeHtml(engine),
    ogUrl: config.url ? `<meta property="og:url" content="${escapeHtml(config.url)}">` : '',
    // The site's own image, or the engine's: the logo on a 1200×630 card,
    // the size LinkedIn needs for a large preview.
    ogImage: escapeHtml(config.image ?? `${engine}social.png`),
    ogImageSize: config.image ? '' : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">',
    // JSON inside a <script>: `<` is escaped so no value can close the tag.
    config: JSON.stringify(site).replace(/</g, '\\u003c'),
  };
  for (const [key, spec] of Object.entries(ASSETS)) {
    values[key] = escapeHtml(asset(...spec));
    values[`${key}Sri`] = INTEGRITY[key];
  }
  values.appSri = appIntegrity('app.js');
  values.styleSri = appIntegrity('style.css');
  // The sign-in library loads only on a site that signs people in with it.
  values.oidc = login?.issuer ? `<script defer src="${values.oidc}" integrity="${values.oidcSri}" crossorigin="anonymous"></script>` : '';
  // Start loading the index while the scripts load, unless the page needs
  // sign-in: then nothing of the recipes is fetched before it.
  // The preload carries the same integrity as the fetch, or the browser
  // would not reuse it.
  const preloadIntegrity = dataIntegrity ? ` integrity="${escapeHtml(dataIntegrity)}"` : '';
  values.preload = data && !login?.required ? `<link rel="preload" href="${escapeHtml(data)}index.json" as="fetch" crossorigin${preloadIntegrity}>` : '';
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}
