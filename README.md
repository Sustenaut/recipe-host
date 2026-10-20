# recipe-host

Host a recipe collection straight from a GitHub repository. Recipes are
Markdown files; every ingredient they use is on a master ingredient list;
the site is a single static page that loads everything through
[jsDelivr](https://www.jsdelivr.com/); and every change, including the ones
made from the site's own buttons, arrives as a pull request.

It serves [schryer.eu/recipes](https://schryer.eu/recipes/) from
[schryer/recipes](https://github.com/schryer/recipes).

## What the site does

- **Recipes**, by category, searchable by title, tag and ingredient. Each has
  a printable A5 recipe card (PDF).
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
  pinned versions.
- **`lib/`** and **`bin/recipe-host.js`** are the command line: `check`,
  `build`, `link`, `request` and `serve`.
- **`cards/recipe-card.typ`** is the A5 card, set with [Typst](https://typst.app).
- **`action.yml`** runs all of it in GitHub Actions.

The site reads the newest commit of the `site` branch (it asks GitHub's API
for the commit, then loads that commit from jsDelivr), so a merged change
shows up as soon as its build finishes, with no cache to wait out.

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

## Working on recipes locally

```sh
npm install -g github:schryer/recipe-host#v0.1.0
cd recipes
recipe-host link recipes/sauces/new-sauce.md   # link ingredient lines
recipe-host check                              # every rule in FORMAT.md
recipe-host serve                              # preview at http://localhost:8080/
```

`build` and `serve` make the cards when `typst` is on the path, and skip
them otherwise.

## Working on recipe-host

```sh
npm install
npm test
node bin/recipe-host.js serve --root ../recipes
```

`npm run test:browser` clicks through a built test site in Chromium (run
`npx playwright install chromium` once first).

See [AGENTS.md](AGENTS.md) for how the pieces fit and what to keep true when
changing them. Releases are git tags (`v0.1.0`); a recipe repository pins one
in its workflows, and its built page loads the app from that tag, so a
release changes nothing until a site moves to it.

## Licence

MIT
