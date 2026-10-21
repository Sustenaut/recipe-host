# Working on recipe-host

Read README.md first for what this is. This file is for changing it.

## Rules to keep

- **The format is a contract.** FORMAT.md describes what recipe
  repositories hold, and `lib/parse.js` and `lib/repo.js` implement it. A
  change to one changes the other, in the same pull request, with a test.
  Recipe repositories pin a release, so a breaking format change is
  recorded as `changed` (below) and says in the row how to migrate.
- **Every pull request that changes what users run records it** with
  `pubrel add CATEGORY "what changed"` (`added`, `fixed`, `changed`,
  `removed`, `security`, or `internal`), and the release job in CI fails
  one that doesn't. The rows decide the next version; nobody picks it.
- **Every check reports a sentence an author can act on**, naming the file
  and saying what to do, and `loadRepo` collects problems rather than
  stopping at the first.
- **The app has no build step.** `app/` is served from jsDelivr exactly as
  committed. `index.html` is Alpine.js markup, `app.js` its state, and
  `style.css` the site's own styles on top of Pure CSS. Its colours, fonts
  and radii follow the Sustenaut design tokens (`ui/src/theme.css` in
  schryer/business-plan), under the same names; change them there first.
  The libraries (Alpine, its anchor plugin, Pure, the Nunito fonts and
  marked) load from jsDelivr at the
  versions in `ASSETS` in `lib/page.js`, which must match `package.json`
  so `serve` can use the same files from `node_modules`. Prefer Alpine
  markup and Pure classes to new JavaScript or CSS.
- **The app never writes.** Every change goes through a GitHub issue and
  `lib/requests.js`, which applies it, re-checks the whole repository, and
  leaves the pull request to a person. A new kind of change is a new entry
  in `ACTIONS` there, a button and dialog in `app/index.html` whose method in `app/app.js` calls
  `openRequest`, and tests for both the change and its refusals.
- **Text from issues is untrusted.** The action passes the issue to node
  through a file and environment variables, never by interpolating it into
  a shell script. The app drops raw HTML from Markdown and escapes
  everything it inserts.

## Layout

| Path | What it is |
|---|---|
| `lib/parse.js` | One recipe or ingredient file: frontmatter, sections, ingredient lines. |
| `lib/repo.js` | The whole repository: loading, cross-file checks, the site index. |
| `lib/build.js` | The `site` folder: index.html, JSON, photos, cards. |
| `lib/link.js` | Linking plain ingredient lines to the ingredient list. |
| `lib/requests.js` | Add, merge and substitute: issue body in, files changed, pull request described. |
| `bin/recipe-host.js` | The command line. |
| `lib/page.js`, `lib/serve.js` | The site's page with its settings filled in; the local preview server. |
| `app/` | The site: `index.html` (views and dialogs), `app.js` (state and requests), `style.css`. |
| `cards/recipe-card.typ` | The A5 card, fed plain-text JSON by `cardData`. |
| `action.yml` | The GitHub Action that recipe repositories run. |
| `test/` | `*.test.js`: unit tests, each building a small repository in a temp folder. `site.browser.js`: Playwright clicks through `test/fixtures/repo` and records the coverage of `app/app.js` (`v8-lcov.js`). |

## Checking a change

Run `npm test` and `npm run test:browser`, then preview a real repository with
`node bin/recipe-host.js serve --root ../recipes` and click through the
views you touched: the home page of favourites, the recipe list (search,
the type and meal filters, stars), a recipe, the ingredient list (search,
the ⋯ menu near the top and the bottom of the window, merge), and an
ingredient page (tick recipes, add a substitution). Check a narrow window
too.
