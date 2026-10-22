# recipe-host

Host a recipe collection straight from a GitHub repository. Recipes are
Markdown files; every ingredient they use is on a master ingredient list;
the site is a single static page that loads everything through
[jsDelivr](https://www.jsdelivr.com/); and every change, including the ones
made from the site's own buttons, arrives as a pull request.

## What the site does

- **Home**: the reader's favourite recipes, by category. A star on the recipe
  list or on a recipe's page adds one. Favourites are kept in the reader's
  browser, separately for each recipe repository, or, on a site with sign-in,
  in the reader's own storage (below).
- **Recipes**: every recipe, searchable by title, tag and ingredient, with
  filter chips for each category and for the meals breakfast, lunch and dinner
  (taken from the tags). Each recipe has a printable A5 recipe card (PDF).
- **Ingredients**: a searchable list of every ingredient in every recipe. An
  ingredient's page lists the recipes it is in and how each one prepares it,
  its substitutions, and its notes.
- **Changes as pull requests**, from buttons on the site:
  - *Add ingredient*, at the top of the ingredient list.
  - *Merge into another ingredient*, from the ⋯ menu on an ingredient row.
    The merged ingredient's name becomes an alias of the one kept, and every
    recipe link moves across.
  - *Add substitution note*, on an ingredient's page after ticking the
    recipes it applies to: pick the substitute and say how to use it.
  - *Edit the notes on GitHub*, on an ingredient's page.

  A static page cannot write to GitHub itself, so each button opens a
  prefilled GitHub issue. Submitting it runs the repository's workflow, which
  makes the change, checks it, and opens a pull request that closes the
  issue. Reviewers comment on the pull request like any other; merging it
  rebuilds the site. Anyone with a GitHub account can make a request; nothing
  changes until someone with write access merges it.

## How it fits together

```
recipe repository (main)            recipe repository (site branch)
  recipes/, ingredients/  ──build──▶  index.json, recipes/*.json,
  photos/, recipe-host.yml            cards/*.pdf, photos/, index.html
                                                │
                                         jsDelivr CDN
                                                │
your web server: index.html ──▶ app (this repo, at a pinned tag, via jsDelivr)
                                 + data (the site branch, via jsDelivr)
```

- **`app/`** is the site, with no build step: `index.html` is an
  [Alpine.js](https://alpinejs.dev) template styled with
  [Pure CSS](https://pure-css.github.io), and `app.js` holds its state.
  `recipe-host build` fills in the repository's settings and writes the page
  as the site's `index.html`; everything it loads comes from jsDelivr at
  pinned versions, each script and stylesheet with its
  [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
  hash, so a browser refuses any file that is not the one released.
- **`lib/`** and **`bin/recipe-host.js`** are the command line: `check`,
  `build`, `link`, `request` and `serve`.
- **`cards/recipe-card.typ`** is the A5 card, set with [Typst](https://typst.app).
- **`action.yml`** runs all of it in GitHub Actions.

The page deployed to your server names the exact `site` commit it was
published with and loads everything from jsDelivr at that commit and at
pinned library versions. None of those URLs ever change, so browsers and
the CDN cache them for good; publishing warms jsDelivr with the new commit
and then deploys a page that names it, which is the only invalidation
needed. The copy of the page on the `site` branch (for GitHub Pages and
other hosts) instead asks GitHub's API for the newest commit when it opens.

An open page checks GitHub for a newer publish when it opens and then every
hour. When there is one, the bell in the header lights up and a *Reload*
button appears; it loads the new recipes in place.

Any recipe site can show any other public recipe repository: add
`?repo=owner/name` to its address, as in
`https://schryer.eu/recipes/?repo=friend/cookbook`. The page loads that
repository's `site` branch instead, and its buttons open requests there.

## Set up a recipe repository

1. Lay it out as [FORMAT.md](FORMAT.md) describes, with a `recipe-host.yml`.
2. Add two workflows:

   `.github/workflows/recipes.yml` checks pull requests and publishes `main`:

   ```yaml
   name: Recipes
   on:
     push: { branches: [main] }
     pull_request:
     workflow_dispatch:
   permissions:
     contents: write
   concurrency:
     group: recipes-${{ github.ref }}
     cancel-in-progress: true
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: schryer/recipe-host@v0.1.0
           with:
             command: ${{ github.event_name == 'pull_request' && 'check' || 'publish' }}
             # Optional: copy index.html to your own web server.
             deploy-key: ${{ secrets.RECIPES_DEPLOY_KEY }}
             deploy-target: deploy@example.org:./
   ```

   `.github/workflows/requests.yml` turns requests from the site into pull requests:

   ```yaml
   name: Requests
   on:
     issues:
       types: [opened, edited]
   permissions:
     contents: write
     pull-requests: write
     issues: write
   concurrency:
     group: request-${{ github.event.issue.number }}
   jobs:
     request:
       if: contains(github.event.issue.body, '```recipe-host')
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: schryer/recipe-host@v0.1.0
           with:
             command: request
   ```

3. In the repository's settings, under *Actions → General → Workflow
   permissions*, tick **Allow GitHub Actions to create and approve pull
   requests**.
4. Serve the built `index.html`. It is on the `site` branch, and with
   `deploy-key` set the publish step copies it to your server. It is the
   only file your server needs.

Pull requests opened by the request workflow use the workflow's own token,
and GitHub does not run other workflows for those, so the request workflow
checks the change itself before it opens the pull request.

## Sign-in and favourites that follow the reader

A site can sign readers in with any OpenID Connect provider and keep each
reader's favourites in their own S3 bucket. Both are off unless
`recipe-host.yml` turns them on (see [FORMAT.md](FORMAT.md)):

```yaml
login:
  issuer: https://auth.sustenaut.eu/realms/sustenaut
  client: recipes        # a public client with PKCE, redirecting to the site
  required: true         # show nothing until signed in; false: sign-in only for favourites
favourites: https://presign.sustenaut.eu/
```

- The page uses the code flow with PKCE (oidc-client-ts), comes back to the
  same view and `?repo=`, keeps its tokens for the tab only and renews them
  with the refresh token.
- The favourites service answers `POST v1/presign` with the reader's access
  token and `{"method": "GET" | "PUT", "key": "favourites/<owner>/<name>.json"}`
  with `{"url", "expires"}`: a link, valid a few minutes, to that file in
  the bucket the reader registered. The page never holds bucket keys. A
  missing file is a 404, and the page then starts from what the browser kept.
- `required: true` hides the site, not the recipes: those stay public on
  GitHub and jsDelivr.

`recipe-host serve --mock-login` previews a site this way without the real
services: [lib/mock-login.js](lib/mock-login.js) stands in for the sign-in
(two test accounts instead of a wallet) and for the favourites service and
bucket, in memory, on the preview's own origin.

## Working on recipes locally

```sh
npm install -g github:schryer/recipe-host#v0.1.0
cd recipes
recipe-host link recipes/sauces/new-sauce.md   # link ingredient lines
recipe-host check                              # every rule in FORMAT.md
recipe-host serve                              # preview at http://localhost:8080/
```

`build` and `serve` make the cards when they find `typst` (the absolute
path in `$TYPST`, or else on the path), and skip them otherwise.

## Working on recipe-host

```sh
npm install
npm test
node bin/recipe-host.js serve --root ../recipes
```

`npm run test:browser` clicks through a built test site in Chromium (run
`npx playwright install chromium` once first).

See [AGENTS.md](AGENTS.md) for how the pieces fit and what to keep true when
changing them.

### Releasing

Releases are cut with [pubrel](https://github.com/schryer/pubrel). Each
pull request that changes what users run records the change with
`pubrel add`, and the version follows from those rows. To release, on a
clean, up-to-date `main`:

```sh
pubrel prepare   # signs the release record and opens a release/vX.Y.Z pull request
```

Merging that pull request is the release: the release job in CI tags it,
creates the GitHub release, and warms jsDelivr at the new tag. A recipe
repository pins a tag in its workflows, so a release changes nothing until
a site moves to it; Dependabot opens that pull request.

## Licence

MIT
