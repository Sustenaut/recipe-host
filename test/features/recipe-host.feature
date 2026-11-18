@recipe-host
Feature: Building a recipe site: parsing recipes and ingredients, the index, cards, requests and the pages

  The kitchen (test/fixtures/kitchen) has two recipes, salsa verde (a sauce
  that makes about 500 ml) and a herb salad (serves 2), and the ingredients
  serrano chilli (or serrano), jalapeño, scallion (or green onion), spring
  onion, coriander (or cilantro) and onion. Neither recipe uses jalapeño or
  onion.

  Scenario: An ingredient line splits into quantity, references and preparation
    When I split the ingredient line "6 cloves [garlic](/ingredients/garlic.md), minced"
    Then the result's "refs" is '[{"id": "garlic", "label": "garlic"}]'
    And the result's "quantity" is "6 cloves"
    And the result's "preparation" is "minced"
    And the result's "text" is "6 cloves garlic, minced"

  Scenario: A recipe parses into facts, ingredient groups and named steps
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    When I parse the recipe "recipes/sauces/salsa-verde.md"
    Then the result's "slug" is "salsa-verde"
    And the result's "category" is "sauces"
    And the result's "facts" is '{"makes": "about 500 ml", "prep": "10 min"}'
    And the result's "ingredientGroups.0.items.2.preparation" is "with stems, roughly chopped"
    And the result's "ingredientGroups.0.items.3" is "null"
    And the result's "steps.0.name" is "Char the vegetables"
    And the result's "steps.1.name" is "Blend"
    And the result's "steps.2" is "null"

  Scenario: A recipe without links, servings or a method reports every problem
    Given a scratch directory
    And a file "recipes/x/bad.md" holding:
      """
      ---
      title: X
      subtitle: Y
      tags: [a]
      date: 2026-10-19
      ---

      ## Ingredients

      - 2 eggs
      """
    When I parse the recipe "recipes/x/bad.md"
    Then it is refused, saying "serves` or `makes`"
    And it is refused, saying "links no ingredient"
    And it is refused, saying "no `## Method`"

  Scenario: A recipe without links, servings or a method has three problems
    Given a scratch directory
    And a file "recipes/x/bad.md" holding:
      """
      ---
      title: X
      subtitle: Y
      tags: [a]
      date: 2026-10-19
      ---

      ## Ingredients

      - 2 eggs
      """
    When I list the problems parsing the recipe "recipes/x/bad.md" finds
    Then the result has 3 problems

  Scenario: A link to an ingredient without a file is an error
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And the file "ingredients/coriander.md" is removed
    When I load the recipe repository
    Then the result's "errors.0" is 'recipes/salads/herb-salad.md: "1 bunch coriander, leaves picked" links the ingredient "coriander", which has no file; add ingredients/coriander.md or link an existing one'
    And the result's "errors.1" is 'recipes/sauces/salsa-verde.md: "1 bunch cilantro with stems, roughly chopped" links the ingredient "coriander", which has no file; add ingredients/coriander.md or link an existing one'
    And the result's "errors.2" is "null"

  Scenario: An unused ingredient is a warning, not an error
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I load the recipe repository
    Then the result's "errors" is "[]"
    And the result's "warnings.0" is 'ingredients/jalapeno.md: no recipe uses "Jalapeño" yet'
    And the result's "warnings.1" is 'ingredients/onion.md: no recipe uses "Onion" yet'
    And the result's "warnings.2" is "null"

  Scenario: The index lists each ingredient with the recipes that use it and how
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I build the index and read the ingredient "coriander"
    Then the result's "uses.0.recipe" is "herb-salad"
    And the result's "uses.0.group" is "For the salad"
    And the result's "uses.0.preparation" is "leaves picked"
    And the result's "uses.1.recipe" is "salsa-verde"
    And the result's "uses.1.group" is "null"
    And the result's "uses.1.preparation" is "with stems, roughly chopped"
    And the result's "uses.2" is "null"

  Scenario: The index lists the ingredients each recipe uses
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I build the index and read the recipe "salsa-verde"
    Then the result's "ingredients" is '["serrano-chilli", "scallion", "coriander"]'

  Scenario: Card data is plain text with the draft note kept
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    When I make the card of the recipe "recipes/sauces/salsa-verde.md" for the site at "https://schryer.eu/recipes/"
    Then the result's "footer" is "schryer.eu/recipes"
    And the result's "intro.0" is '{"kind": "note", "text": "Draft method for David to check."}'
    And the result's "groups.0.items.0" is "2 serrano chillies, stems removed"
    And the result's "notes" is '["Keeps for a week."]'

  Scenario: An issue without a recipe-host block holds no request
    When I read the request in the issue:
      """
      Just a question
      """
    Then the result is "null"

  Scenario: A request is read from the recipe-host block of an issue
    When I read the request in the issue:
      """
      Text

      ```recipe-host
      {"action":"add-ingredient","name":"Leek"}
      ```

      """
    Then the result is:
      """
      {"action": "add-ingredient", "name": "Leek"}
      """

  Scenario: A recipe-host block that isn't JSON is refused
    When I read the request in the issue:
      """
      ```recipe-host
      not json
      ```
      """
    Then it is refused
    And the refusal is a RequestError

  Scenario: Merging relinks recipes and keeps the old name as an alias
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "merge-ingredients", "from": "spring-onion", "into": "scallion"}
      """
    Then the result's "title" is "Merge Spring onion into Scallion"
    And the file "ingredients/spring-onion.md" does not exist
    And the file "recipes/salads/herb-salad.md" includes "2 [spring onions](/ingredients/scallion.md), sliced"
    And the file "ingredients/scallion.md" holds:
      """
      ---
      name: Scallion
      aliases: [green onion, Spring onion]
      ---

      ### From Spring onion

      The same plant as a scallion.
      """

  Scenario: A merged repository has no errors
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And the request has been applied:
      """
      {"action": "merge-ingredients", "from": "spring-onion", "into": "scallion"}
      """
    When I load the recipe repository
    Then the result's "errors" is "[]"

  Scenario: Merging moves substitutions that point at the merged ingredient
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "ingredients/serrano-chilli.md" holding:
      """
      ---
      name: Serrano chilli
      substitutions:
        - with: jalapeno
          recipes: [salsa-verde]
          note: Use more.
      ---
      """
    When I apply the request:
      """
      {"action": "merge-ingredients", "from": "jalapeno", "into": "onion"}
      """
    Then the file "ingredients/serrano-chilli.md" includes "with: onion"

  Scenario Outline: An ingredient cannot be merged into itself or a missing one
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "merge-ingredients", "from": "onion", "into": "<into>"}
      """
    Then it is refused, saying '<saying>'

    Examples:
      | into  | saying               |
      | onion | into itself          |
      | leek  | no ingredient "leek" |

  Scenario: Adding an ingredient writes its file
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "add-ingredient", "name": "Roasted onion", "aliases": "charred onion", "notes": "Roast at 220 °C."}
      """
    Then the result's "branch" is "add-roasted-onion"
    And the file "ingredients/roasted-onion.md" holds:
      """
      ---
      name: Roasted onion
      aliases: [charred onion]
      ---

      Roast at 220 °C.
      """

  Scenario: Adding an ingredient refuses one already on the list
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "add-ingredient", "name": "cilantro"}
      """
    Then it is refused, saying "already an alias of Coriander"

  Scenario: A substitution note is stored on the ingredient for the chosen recipes
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "add-substitution", "ingredient": "serrano-chilli", "with": "jalapeno", "recipes": ["salsa-verde"],
       "note": "More roasted jalapeños plus a small dose of hotter chilli extract to taste."}
      """
    Then the result's "title" is "Substitute Jalapeño for Serrano chilli"
    And the file "ingredients/serrano-chilli.md" holds:
      """
      ---
      name: Serrano chilli
      aliases: [serrano]
      substitutions:
        - with: jalapeno
          recipes: [salsa-verde]
          note: More roasted jalapeños plus a small dose of hotter chilli extract to taste.
      ---
      """

  Scenario: A substitution for a recipe that does not use the ingredient is refused
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I apply the request:
      """
      {"action": "add-substitution", "ingredient": "serrano-chilli", "with": "jalapeno", "recipes": ["herb-salad"], "note": "x"}
      """
    Then it is refused, saying '"herb-salad", which does not use Serrano chilli'
    And the file "ingredients/serrano-chilli.md" does not include "substitutions"

  Scenario: Link adds ingredient links by name and alias and reports the rest
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipes/salads/herb-salad.md" holding:
      """
      ---
      title: Herb salad
      subtitle: Leaves and herbs
      tags: [salad]
      date: 2026-10-19
      serves: 2
      ---

      ## Ingredients

      ### For the salad

      - 1 bunch cilantro, leaves picked
      - 2 red onions, sliced
      - 1 lemon

      ## Method

      1. Toss.
      """
    When I link the recipe "recipes/salads/herb-salad.md"
    Then the result's "linked" is '["1 bunch [cilantro](/ingredients/coriander.md), leaves picked", "2 red [onions](/ingredients/onion.md), sliced"]'
    And the result's "unmatched" is '["1 lemon"]'
    And the file "recipes/salads/herb-salad.md" includes "- 1 bunch [cilantro](/ingredients/coriander.md), leaves picked"

  Scenario: A page pinned to one data commit preloads its index
    Given the site settings:
      """
      {"title": "R & D", "description": "", "repo": "o/r", "branch": "main"}
      """
    When I write its page with:
      """
      {"data": "https://cdn.jsdelivr.net/gh/o/r@abc/"}
      """
    Then the result includes '<link rel="preload" href="https://cdn.jsdelivr.net/gh/o/r@abc/index.json" as="fetch" crossorigin>'
    And the result includes '"data":"https://cdn.jsdelivr.net/gh/o/r@abc/"'
    And the result includes "<title>R &amp; D</title>"

  Scenario: A page that reads the newest commit preloads nothing, and asks GitHub
    Given the site settings:
      """
      {"title": "R & D", "description": "", "repo": "o/r", "branch": "main"}
      """
    When I write its page
    Then the result does not include 'rel="preload"'
    And the result includes '"data":null'
    And the result includes '"dataIntegrity":null'

  Scenario: A page given its data's hash names it, on the preload too
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main"}
      """
    When I write its page with:
      """
      {"data": "https://cdn.jsdelivr.net/gh/o/r@abc/", "dataIntegrity": "sha384-0qI7x4Pjqjj0AeE8dIhQUTfElUp/2IMx8Vl8X/cREdyAfHNwpbKCxtpUHFbt5p8w"}
      """
    Then the result includes 'index.json" as="fetch" crossorigin integrity="sha384-0qI7x4Pjqjj0AeE8dIhQUTfElUp/2IMx8Vl8X/cREdyAfHNwpbKCxtpUHFbt5p8w">'
    And the result includes '"dataIntegrity":"sha384-0qI7x4Pjqjj0AeE8dIhQUTfElUp/2IMx8Vl8X/cREdyAfHNwpbKCxtpUHFbt5p8w"'

  Scenario: recipe-host page --index names the hash of that index.json in the page
    Given the program under test is "recipe-host"
    And a scratch directory
    And a file "repo" copied from "test/fixtures/repo"
    And a file "index.json" holding '{"recipes":[]}'
    When I run "recipe-host page --root repo --out index.html --data https://cdn.example/d/ --index index.json"
    Then it succeeds
    And the file "index.html" includes '"dataIntegrity":"sha384-P9cuZv9FnY4bb4/0UWGG6p431ymOo4TbDfeW6jzS6r+u8HYJ6Y+VOetPCZ1c88Ik"'

  Scenario: The site builds, a file for each recipe
    Given the program under test is "recipe-host"
    And a scratch directory
    And a file "repo" copied from "test/fixtures/repo"
    When I run "recipe-host build --root repo --out out --no-cards"
    Then it succeeds
    And the directory "out/recipes" holds:
      """
      herb-salad.json
      salsa-verde.json
      """

  Scenario: The built index holds the integrity of every recipe file, and those files match it
    Given a scratch directory
    And a file "repo" copied from "test/fixtures/repo"
    And the site built from "repo" into "out", without cards
    When I hash each recipe file the index in "out" lists
    Then the result's "listed" is '["recipes/herb-salad.json", "recipes/salsa-verde.json"]'
    And the result's "mismatched" is "[]"

  Scenario: Every library the page loads carries the integrity of the file its version ships
    When I hash each library the page loads, as node_modules has it
    Then the result is "[]"

  Scenario: Every script and stylesheet on the page names its integrity
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main",
       "login": {"issuer": "https://auth.example/x", "client": "c"}, "favourites": "https://store.example/"}
      """
    When I list the scripts and stylesheets on its page that name no integrity
    Then the result is "[]"

  Scenario: The page with sign-in loads nine scripts and stylesheets
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main",
       "login": {"issuer": "https://auth.example/x", "client": "c"}, "favourites": "https://store.example/"}
      """
    When I list the scripts and stylesheets on its page
    Then the result has 9 tags

  Scenario Outline: The page names the integrity of the app itself
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main",
       "login": {"issuer": "https://auth.example/x", "client": "c"}, "favourites": "https://store.example/"}
      """
    When I ask whether its page names the integrity of "<file>" as the file is
    Then the result is "true"

    Examples:
      | file          |
      | app/app.js    |
      | app/style.css |

  Scenario: A site with login loads the sign-in library and passes its settings to the page
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main",
       "login": {"issuer": "https://auth.example/realms/x", "client": "recipes", "required": true}, "favourites": "https://store.example/"}
      """
    When I write its page
    Then the result matches '*<script defer src="https://cdn.jsdelivr.net/npm/oidc-client-ts@3.5.0/dist/browser/oidc-client-ts.min.js" integrity="sha384-*" crossorigin="anonymous"></script>*'
    And the result includes '"login":{"issuer":"https://auth.example/realms/x","client":"recipes","required":true},"favourites":"https://store.example/"'

  Scenario: A preview's page passes the settings it is given
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main",
       "login": {"issuer": "https://auth.example/realms/x", "client": "recipes", "required": true}, "favourites": "https://store.example/"}
      """
    When I write its page with:
      """
      {"login": {"issuer": "/mock/x", "client": "recipes", "required": false}, "favourites": "/mock/presign/"}
      """
    Then the result includes '"issuer":"/mock/x"'

  Scenario: A site without login loads no sign-in library
    Given the site settings:
      """
      {"title": "R", "description": "", "repo": "o/r", "branch": "main", "login": null, "favourites": null}
      """
    When I write its page
    Then the result does not include "oidc-client-ts"
    And the result includes '"login":null,"favourites":null'

  Scenario: Login settings in recipe-host.yml are read
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding:
      """
      login:
        issuer: https://auth.sustenaut.eu/realms/sustenaut
        client: recipes
        required: true
      favourites: https://presign.sustenaut.eu/
      """
    When I load the recipe repository
    Then the result's "errors" is "[]"
    And the result's "config.login" is '{"issuer": "https://auth.sustenaut.eu/realms/sustenaut", "client": "recipes", "required": true}'
    And the result's "config.favourites" is "https://presign.sustenaut.eu/"

  Scenario: A site without recipe-host.yml has no login
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    When I load the recipe repository
    Then the result's "config.login" is "null"

  Scenario: Login settings in recipe-host.yml are checked
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding:
      """
      login:
        issuer: http://auth.example
      favourites: nowhere
      """
    When I load the recipe repository
    Then the result's "errors.0" is "recipe-host.yml: login.issuer must be the https:// address of an OpenID Connect issuer, like https://auth.sustenaut.eu/realms/sustenaut, or use login.session"
    And the result's "errors.1" is "recipe-host.yml: login.client must name the client registered for this site at the issuer, like recipes"
    And the result's "errors.2" is "recipe-host.yml: favourites must be the https:// address of the favourites service, like https://presign.sustenaut.eu/"
    And the result's "errors.3" is "null"

  Scenario Outline: A session service for sign-in is checked
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding "<settings>"
    When I load the recipe repository
    Then the result's "errors.0" is "recipe-host.yml: <error>"

    Examples:
      | settings                                                                               | error                                                                                                                           |
      | favourites: https://presign.sustenaut.eu/                                              | favourites needs login, because the favourites service only answers signed-in readers; add a login section or remove favourites |
      | login: {session: 'http://share.example/'}                                              | login.session must be the https:// address of the sign-in service, ending in /, like https://share.schryer.eu/recipes/v1/       |
      | login: {session: 'https://share.example/v1'}                                           | login.session must be the https:// address of the sign-in service, ending in /, like https://share.schryer.eu/recipes/v1/       |
      | {login: {session: 'https://share.example/'}, favourites: 'https://presign.example/'}   | favourites is for sign-in with an issuer; a session service keeps favourites itself, so remove favourites                       |
      | login: {session: 'https://share.example/', issuer: 'https://auth.example/', client: x} | login takes either session or issuer and client, not both; keep the one this site signs in with                                 |

  Scenario: A session service for sign-in is read
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding:
      """
      login:
        session: https://share.schryer.eu/recipes/v1/
        required: true
      """
    When I load the recipe repository
    Then the result's "errors" is "[]"
    And the result's "config.login" is '{"session": "https://share.schryer.eu/recipes/v1/", "required": true}'

  Scenario: A site with a session service loads no sign-in library
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding:
      """
      login:
        session: https://share.schryer.eu/recipes/v1/
        required: true
      """
    And the site settings of the recipe repository
    When I write its page
    Then the result does not include "oidc-client-ts"
    And the result includes '"login":{"session":"https://share.schryer.eu/recipes/v1/","required":true}'

  Scenario: The page carries an Open Graph card for link previews
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding:
      """
      title: Family <Recipes>
      description: Our food
      url: https://recipes.example/
      """
    And the site settings of the recipe repository
    When I write its page with:
      """
      {"engine": "https://cdn.example/app/"}
      """
    Then the result includes '<meta property="og:title" content="Family &lt;Recipes&gt;">'
    And the result includes '<meta property="og:description" content="Our food">'
    And the result includes '<meta property="og:url" content="https://recipes.example/">'
    And the result includes '<meta property="og:image" content="https://cdn.example/app/social.png">'
    And the result includes '<meta property="og:image:width" content="1200">'
    And the result includes '<meta name="twitter:card" content="summary_large_image">'

  Scenario: The card's own image ships with the app
    When I run "ls app"
    Then it prints "social.png"

  Scenario: A site's own image is its Open Graph card's
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding "image: https://recipes.example/card.jpg"
    And the site settings of the recipe repository
    When I write its page
    Then the result includes '<meta property="og:image" content="https://recipes.example/card.jpg">'
    And the result does not include "og:image:width"
    And the result does not include "og:url"

  Scenario: A site's own image has no errors
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding "image: https://recipes.example/card.jpg"
    When I load the recipe repository
    Then the result's "errors" is "[]"

  Scenario: A site's own image must be an https:// address
    Given a scratch directory
    And a file "recipes" copied from "test/fixtures/kitchen/recipes"
    And a file "ingredients" copied from "test/fixtures/kitchen/ingredients"
    And a file "recipe-host.yml" holding "image: photos/card.jpg"
    When I load the recipe repository
    Then the result's "errors.0" is "recipe-host.yml: image must be the https:// address of the picture link previews show, like https://recipes.schryer.eu/card.jpg (1200×630 or larger), or be left out to use the recipe-host logo"

  Scenario Outline: Typst is found by absolute path, from $TYPST or else PATH, and never from a relative PATH entry
    Given a scratch directory
    And a file "bin/typst" holding "#!/bin/sh"
    And the file "bin/typst" is executable
    When I look for typst with:
      | name  | value   |
      | TYPST | <TYPST> |
      | PATH  | <PATH>  |
    Then the result is "<found>"

    Examples:
      | TYPST               | PATH                   | found               |
      | {unset}             | relative:{scratch}/bin | {scratch}/bin/typst |
      | {scratch}/bin/typst | {empty}                | {scratch}/bin/typst |
      | typst               | {scratch}/bin          | null                |
      | {unset}             | relative               | null                |

  Scenario: The Markdown patterns keep their meaning: a heading's closing #s
    When I split the Markdown into sections:
      """
      ## Method ##
      1. Stir
      """
    Then the result is:
      """
      [{"title": "Method", "markdown": "1. Stir"}]
      """

  Scenario: The Markdown patterns keep their meaning: links and images in plain text
    When I reduce "a [b](c) ![d](e.jpg) [f [g](h)" to plain text
    Then the result is "a b [f g"

  Scenario: The Markdown patterns keep their meaning: a name's slug
    When I slugify " -Crème  brûlée- "
    Then the result is "creme-brulee"

  Scenario: The Markdown patterns keep their meaning: a link after a stray bracket
    When I split the ingredient line "[a [garlic](/ingredients/garlic.md)"
    Then the result's "refs.0.id" is "garlic"
    And the result's "refs.1" is "null"

  Scenario: A request is read from an issue whose lines end in CRLF
    When I read the request in the issue, its lines ending in CRLF:
      """
      Hi
      ```recipe-host
      {"action":"add"}
      ```

      """
    Then the result is '{"action": "add"}'

  Scenario: A recipe-host block that never closes holds no request
    When I read the request in the issue:
      """
      ```recipe-host
      {"action":"add"}
      """
    Then the result is "null"

  Scenario: A step's name is its bold start, and a step without one has none
    When I parse the recipe "recipes/x/y.md":
      """
      ---
      title: Y
      subtitle: Z
      tags: [t]
      date: 2026-10-20
      serves: 1
      ---
      ## Ingredients
      - 1 [egg](/ingredients/egg.md)
      ## Method
      1. **Whisk.**   Beat it
      2. Cook
      """
    Then the result's "steps.0.name" is "Whisk"
    And the result's "steps.0.markdown" is "Beat it"
    And the result's "steps.1.name" is "null"
    And the result's "steps.1.markdown" is "Cook"
    And the result's "steps.2" is "null"

  Scenario: An issue of many unclosed recipe-host blocks is refused
    When I read the request in an issue of 5000 lines "```recipe-host"
    Then it is refused
    And the refusal is a RequestError

  Scenario: The Markdown patterns stay fast on hostile text
    When I run each Markdown pattern on hostile text 20000 long
    Then it is not refused
    And it took less than 1000 ms
