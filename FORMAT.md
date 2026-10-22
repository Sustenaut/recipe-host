# Recipe repository format

The contract for a repository recipe-host can serve. Anything that writes
recipes follows it, people and agents alike. `recipe-host check` enforces
every rule marked *checked*.

```
recipe-host.yml            site settings
recipes/<category>/<slug>.md   one recipe
ingredients/<id>.md        one ingredient on the master list
photos/<slug>.jpg          your own photos
```

## recipe-host.yml

```yaml
title: Recipes
description: Family recipes, each with a printable A5 card.
repo: schryer/recipes           # owner/name on GitHub
url: https://schryer.eu/recipes/ # where the site is served; printed on cards
categories: [mains, sauces, sides, desserts, baking, drinks]  # front page order
# Optional, both: sign readers in, and keep their favourites in their own storage.
login:
  issuer: https://auth.sustenaut.eu/realms/sustenaut  # an OpenID Connect issuer (https)
  client: recipes                                    # this site's public client there
  required: true                                     # default false: sign-in only for favourites
favourites: https://presign.sustenaut.eu/            # needs login (*checked*)
```

## Recipes

One Markdown file per recipe at `recipes/<category>/<slug>.md` (*checked*).
The category is a folder: `mains`, `sauces`, `sides`, `desserts`,
`baking`, `drinks`, or a new one when none fits. The slug is the title in
lowercase ASCII with hyphens (`boeuf-bourguignon`, `nuoc-cham`), unique
across all categories (*checked*). It names the file, the photo and the
card, and is the page's address (`#/recipe/<slug>`).

Files whose names start with `_` (like `_template.md`) are not recipes.

### Frontmatter

```yaml
---
title: Sous vide boeuf bourguignon
subtitle: Beef chuck in reduced red wine, 24 hours at 68 °C
tags: [beef, sous vide, french, stew]
date: 2026-10-19
serves: 4
prep: 45 min
cook: 24 h
source: https://recipes.anovaculinary.com/recipe/beef-bourguignon
photo: photos/boeuf-bourguignon.jpg
photo_alt: The finished bourguignon over mashed potatoes
---
```

| Field | Required | What it holds |
|---|---|---|
| `title` | yes (*checked*) | The recipe's name, in sentence case. |
| `subtitle` | yes (*checked*) | One line: the main ingredient and method, or why it's good. |
| `tags` | yes (*checked*) | Lowercase list: main ingredient, cuisine, technique, course. Searched on the recipe lists; `breakfast`, `lunch` and `dinner` also put the recipe under that meal's filter. |
| `date` | yes (*checked*) | When it was written or last substantially changed, `YYYY-MM-DD`. |
| `serves` / `makes` | one of them (*checked*) | How many it feeds (`4`, `4–6`), or its yield when servings make no sense (`about 250 ml (1 cup)`). |
| `prep`, `cook`, `rest`, `total` | when they apply | Hands-on time, time on the heat, waiting (marinating, chilling, proving), and start to finish when it isn't prep + cook. Written `15 min`, `1 h 30 min`, `24 h`. |
| `source` | when adapted | The URL this recipe was mainly adapted from. |
| `photo`, `photo_alt` | when there is one | Your own photo, `photos/<slug>.jpg` (*checked* to exist and be in `photos/`), and a short description of it. A landscape JPEG about 1600 px wide, under 500 KB. Never copy another site's photos; link them from "Similar recipes". |

### Body

In this order, with these section names, so every recipe reads alike:

1. **A note, when needed.** A recipe whose method or quantities were worked
   out rather than tested opens with a GitHub alert, which shows on the
   page, on GitHub and on the card:

   ```markdown
   > [!NOTE]
   > **Draft method for David to check.** The note lists only the
   > ingredients, so the method is worked out from them.
   ```

2. **Introduction** (required). One or two sentences: what makes the recipe
   work, or the one thing not to get wrong.

3. **`## Ingredients`** (required, *checked*). A bullet list, one
   ingredient per line, in the order they're used: quantity, ingredient,
   then how it's prepared. Use `### For the marinade` headings when the
   ingredients fall into groups. Metric first, with the original measure in
   brackets: `500 ml (2 cups) beef stock`. Spoons stay spoons.

   **Every line links at least one ingredient on the master list**
   (*checked*), with a root-relative link to its file:

   ```markdown
   - 6 cloves [garlic](/ingredients/garlic.md), minced
   - 250 g [pork shoulder](/ingredients/pork-shoulder.md) or [loin](/ingredients/pork-loin.md), thinly sliced
   ```

   The link text is the recipe's own wording; the file decides which
   ingredient it is. The text before the first link is read as the
   quantity, and the text after the last link as how it's prepared, so
   keep that order. The ingredient's page lists each recipe with this line.

4. **`## Method`** (required, *checked*). A numbered list. Each step starts
   with a short bold name, then what to do, with heat, time and the cue
   that says it's done: `1. **Sear the beef.** Pat the beef dry...`

5. **`## Notes`** (optional). Make-ahead, storage, variations, a table when
   one earns its place. Other section names are fine here too. Notes in
   a bullet list are printed on the card. Substitutions for a single
   ingredient go on the ingredient (see below), so the site can show them.

6. **`## Similar recipes`** (optional, recommended). One link per line:
   `- [Their title](url) (Site name), how it differs`. Link a recipe on this
   site relatively: `[Kalbi marinade](../sauces/kalbi-marinade.md)`.

Leave out citation markers and reference lists from pasted AI answers,
follow-up questions ("Would you like...?"), and raw HTML, which the site
drops.

## Ingredients

One file per ingredient at `ingredients/<id>.md`, where the id is the
singular name in lowercase ASCII with hyphens (`serrano-chilli`,
`pork-shoulder`):

```markdown
---
name: Serrano chilli
aliases: [serrano]
substitutions:
  - with: jalapeno
    recipes: [salsa-verde]
    note: More roasted jalapeños plus a small dose of hotter chilli extract to taste.
---

Notes and instructions for the ingredient, in Markdown: how to choose,
store or prepare it.
```

| Field | What it holds |
|---|---|
| `name` | Required (*checked*). Singular, as it reads in a list. |
| `aliases` | Other names it goes by. The `link` command matches them, and the site searches them. |
| `substitutions` | Each with `with` (the substitute's id), `recipes` (slugs of recipes that use this ingredient, *checked*) and `note` (how to substitute). The site shows them on the ingredient page and next to the ingredient in each recipe. |

An ingredient no recipe uses is a warning, not an error, so one can be
added before the recipe that needs it.

The site's buttons add ingredients, merge two into one, and add
substitutions through pull requests; editing these files by hand in a pull
request works just as well.

## Adding a recipe

1. Copy `recipes/_template.md` to `recipes/<category>/<slug>.md` and write it.
2. Run `recipe-host link recipes/<category>/<slug>.md`. It links each plain
   ingredient line whose text contains an ingredient's name or alias, and
   lists the lines it couldn't match.
3. Check every link it made (it picks the longest match, which is usually
   but not always right), and for each unmatched line either link an
   existing ingredient (search `ingredients/` and the aliases first, so
   "spring onions" goes to `scallion` rather than a duplicate) or add a new
   `ingredients/<id>.md`. When a new name means an existing ingredient, add
   it to that ingredient's `aliases`.
4. Run `recipe-host check` until it reports no errors, then open a pull
   request.
