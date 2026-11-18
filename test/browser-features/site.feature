@site
Feature: Browser test of the site: builds test/fixtures/repo, serves it locally and clicks through every view in Chromium

  The fixture (test/fixtures/repo, "Test recipes" from example/recipes) has
  two recipes, salsa verde (a sauce) and a herb salad (a salad for lunch),
  and a list of ingredients. One page of Chromium reads every scenario, in
  this order.

  Scenario: The recipe list shows every recipe
    When I open "#/recipes", once ".row" shows
    Then the page's ".row a span" lists '["Herb salad", "Salsa verde"]'

  Scenario: The recipe list searches ingredients: no recipe uses jalapeño
    When I open "#/recipes", once ".row" shows
    And I type "jalap" into "input[type=search]"
    Then the page's ".row" lists "[]"

  Scenario: The recipe list searches ingredients: salsa verde uses serrano
    When I open "#/recipes", once ".row" shows
    And I type "serrano" into "input[type=search]"
    Then the page's ".row a span" lists '["Salsa verde"]'

  Scenario: The recipe list filters by type
    When I open "#/recipes", once ".row" shows
    And I click '.chip:has-text("Sauces")'
    Then the page's ".row a span" lists '["Salsa verde"]'

  Scenario: Within a group any ticked chip matches
    When I open "#/recipes", once ".row" shows
    And I click '.chip:has-text("Sauces")'
    And I click '.chip:has-text("Salads")'
    Then the page's ".row a span" lists '["Herb salad", "Salsa verde"]'

  Scenario: Across groups, a recipe matches one of each
    When I open "#/recipes", once ".row" shows
    And I click '.chip:has-text("Sauces")'
    And I click '.chip:has-text("Salads")'
    And I click '.chip:has-text("Lunch")'
    Then the page's ".row a span" lists '["Herb salad"]'
    And the page's '.chip:has-text("Dinner") small' reads "0"

  Scenario: Clearing the filters shows every recipe again
    When I open "#/recipes", once ".row" shows
    And I click '.chip:has-text("Sauces")'
    And I click '.chip:has-text("Lunch")'
    And I click "text=Clear filters"
    Then the page's ".row a span" lists '["Herb salad", "Salsa verde"]'

  Scenario: The front page without favourites says so
    Given the browser keeps no favourites
    When I open "#/", once ".empty" shows
    Then the page's ".empty" includes "No favourites yet"

  Scenario: A star on the list marks a favourite
    Given the browser keeps no favourites
    When I open "#/", once ".empty" shows
    And I click ".empty >> text=Browse all recipes"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    Then the page's '.row:has-text("Salsa verde") .star' has "aria-pressed" set to "true"

  Scenario: The favourites starred and added from the menu are kept in the browser
    Given the browser keeps no favourites
    When I open "#/recipes", once ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I click '.row:has-text("Herb salad") .dots'
    And I click ".menu >> text=Add to favourites"
    And I read what the browser keeps for example/recipes
    Then the result's "version" is "1"
    And the result's "favourites" is '["salsa-verde", "herb-salad"]'

  Scenario: The browser keeps the favourites under one key, named for the repository
    Given the browser keeps no favourites
    When I open "#/recipes", once ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I click '.row:has-text("Herb salad") .dots'
    And I click ".menu >> text=Add to favourites"
    And I count the keys the browser keeps
    Then the result is "1"

  Scenario: The front page shows the favourites kept, by type
    Given the browser keeps the favourites '["salsa-verde", "herb-salad"]'
    When I open "#/", once ".card" shows
    Then the page's "main h2" lists '["Sauces", "Salads"]'

  Scenario: The front page filters the favourites
    Given the browser keeps the favourites '["salsa-verde", "herb-salad"]'
    When I open "#/", once ".card" shows
    And I click '.chip:has-text("Lunch")'
    Then the page's ".card:visible strong" lists '["Herb salad"]'

  Scenario: A recipe's page says it is a favourite
    Given the browser keeps the favourites '["salsa-verde", "herb-salad"]'
    When I open "#/recipe/herb-salad", once ".steps li" shows
    Then the page's ".favourite span" reads "Favourite"

  Scenario: Unstarring on the recipe's page offers to add it again
    Given the browser keeps the favourites '["salsa-verde", "herb-salad"]'
    When I open "#/recipe/herb-salad", once ".steps li" shows
    And I click ".favourite"
    Then the page's ".favourite span" reads "Add to favourites"

  Scenario: Unstarring on the recipe's page takes it off the front page
    Given the browser keeps the favourites '["salsa-verde", "herb-salad"]'
    When I open "#/recipe/herb-salad", once ".steps li" shows
    And I click ".favourite"
    And I wait until '.favourite span:has-text("Add to favourites")' shows
    And I open "#/", once ".card" shows
    Then the page's ".card strong" lists '["Salsa verde"]'

  Scenario Outline: The header marks the current section
    Given the browser keeps no favourites
    When I open "<address>", once "<shows>" shows
    Then the page's ".pure-menu-selected" reads "<section>"

    Examples:
      | address                | shows           | section     |
      | #/                     | main h1:visible | Home        |
      | #/recipe/salsa-verde   | .steps li       | Recipes     |
      | #/ingredient/coriander | table           | Ingredients |

  Scenario: The header shows the logo
    When I open "#/ingredient/coriander", once "table" shows
    And I ask whether the image ".logo" has loaded
    Then the result is "true"
    And the page's "link[rel=icon]" has "href" matching "*logo.svg"

  Scenario: The links not selected are muted, never Pure's grey or its black for a visited selected link
    When I open "#/ingredient/coriander", once "table" shows
    And I list the colours of the menu's links not selected that are not the theme's muted colour
    Then the result is "[]"

  Scenario: A recipe shows its facts, linked ingredients, swaps and notes
    When I open "#/recipe/salsa-verde", once ".steps li" shows
    Then the page's "title" reads "Salsa verde · Test recipes"
    And the page's ".facts" matches "*Makes about 500 ml*Prep 10 min*Adapted from example.com*"
    And the page's ".alert" includes "Draft method to check"
    And the page's "a.ingredient-link >> text=scallions" has "href" set to "#/ingredient/scallion"
    And the page's ".swap" includes "Swap Jalapeño: Use more roasted jalapeños."
    And the page's "a >> text=herb salad" has "href" set to "#/recipe/herb-salad"

  Scenario: An unknown recipe says so
    When I open "#/recipe/nope", once "main h1:visible" shows
    Then the page's "main h1:visible" reads "Not found"

  Scenario: The ingredient list filters
    When I open "#/ingredients", once ".row" shows
    And I type "onion" into "input[type=search]"
    Then the page's ".row a span" lists '["Onion", "Scallion", "Spring onion"]'
    And the page does not show ".menu"

  Scenario: The ingredient list's menu requests a merge
    When I open "#/ingredients", once ".row" shows
    And I type "onion" into "input[type=search]"
    And I hover over '.row:has-text("Spring onion")'
    And I click '.row:has-text("Spring onion") .dots'
    And I wait until ".menu" shows
    And I click ".menu >> text=Merge into another ingredient"
    And I type "scal" into "dialog[open] input[type=search]"
    And I click 'dialog[open] .picker li:has-text("Scallion")'
    And I click "dialog[open] >> text=Request merge on GitHub", which opens a GitHub issue
    Then the result's "issue" is "https://github.com/example/recipes/issues/new"
    And the result's "request" is '{"action": "merge-ingredients", "from": "spring-onion", "into": "scallion"}'

  Scenario: The menu closes on an outside click
    When I open "#/ingredients", once ".row" shows
    And I click '.row:has-text("Basil") .dots'
    And I wait until ".menu" shows
    And I click "section .lede"
    Then the page does not show ".menu"

  Scenario: The menu closes on Escape
    When I open "#/ingredients", once ".row" shows
    And I click '.row:has-text("Basil") .dots'
    And I wait until ".menu" shows
    And I press "Escape"
    Then the page does not show ".menu"

  Scenario: The menu opens below its button
    Given the window is 1000 by 500
    When I open "#/ingredients", once ".row" shows
    And I open the menu of the first row
    Then the result is "below"

  Scenario: The menu opens above its button near the bottom of the window
    Given the window is 1000 by 500
    When I open "#/ingredients", once ".row" shows
    And I open the menu of the last row, scrolled to the bottom of the window
    Then the result is "above"

  Scenario: Adding an ingredient refuses a name already on the list
    When I open "#/ingredients", once ".row" shows
    And I click "text=Add ingredient"
    And I type "cilantro" into "dialog[open] input >> nth=0"
    And I click "dialog[open] button[type=submit]"
    Then the page's "dialog[open] .error" reads "Coriander is already on the list under that name."

  Scenario: Adding an ingredient requests it on GitHub
    When I open "#/ingredients", once ".row" shows
    And I click "text=Add ingredient"
    And I type "cilantro" into "dialog[open] input >> nth=0"
    And I click "dialog[open] button[type=submit]"
    And I type "Roasted onion" into "dialog[open] input >> nth=0"
    And I click "dialog[open] button[type=submit]", which opens a GitHub issue
    Then the result's "issue" is "https://github.com/example/recipes/issues/new"
    And the result's "request" is '{"action": "add-ingredient", "name": "Roasted onion", "aliases": [], "notes": ""}'

  Scenario: An ingredient page lists its uses
    When I open "#/ingredient/coriander", once "table" shows
    Then the page's "tbody tr td:nth-child(2)" lists '["Herb salad", "Salsa verde"]'
    And the page's "tbody tr >> nth=0 >> td >> nth=2" includes "For the salad: 1 bunch coriander, leaves picked"

  Scenario: An ingredient page requests a substitution only once a recipe is ticked
    When I open "#/ingredient/coriander", once "table" shows
    And I ask whether "form button[type=submit]" is disabled
    Then the result is "true"

  Scenario: Ticking a recipe lets an ingredient page request a substitution
    When I open "#/ingredient/coriander", once "table" shows
    And I tick "input[value=herb-salad]"
    And I ask whether "form button[type=submit]" is disabled
    Then the result is "false"

  Scenario: An ingredient page requests a substitution for the ticked recipes
    When I open "#/ingredient/coriander", once "table" shows
    And I tick "input[value=herb-salad]"
    And I click "form button[type=submit]"
    And I type "onion" into "dialog[open] input[type=search]"
    And I click 'dialog[open] .picker li:has-text("Onion") >> nth=0'
    And I type "Use the same weight of roasted onions." into "dialog[open] textarea"
    And I click "dialog[open] >> text=Request on GitHub", which opens a GitHub issue
    Then the result's "issue" is "https://github.com/example/recipes/issues/new"
    And the result's "request" is '{"action": "add-substitution", "ingredient": "coriander", "recipes": ["herb-salad"], "with": "onion", "note": "Use the same weight of roasted onions."}'

  Scenario: ?repo= shows another repository
    Given "friend/cookbook" has published the fixture as "Friend's cookbook"
    When I open "?repo=friend/cookbook#/recipe/salsa-verde", once ".steps li" shows
    Then the page's ".pure-menu-heading span" reads "Friend's cookbook"
    And the page's "title" reads "Salsa verde · Friend's cookbook"
    And the page's "text=Source on GitHub" has "href" set to "https://github.com/friend/cookbook/blob/main/recipes/sauces/salsa-verde.md"
    And the page's ".site-footer" matches "*Recipes from friend/cookbook*· Back to the recipes from example/recipes*"

  Scenario: ?repo='s links inside the site keep the repository
    Given "friend/cookbook" has published the fixture as "Friend's cookbook"
    When I open "?repo=friend/cookbook#/recipe/salsa-verde", once ".steps li" shows
    And I click "a.ingredient-link >> text=scallions"
    And I wait until "table" shows
    And I read the page's address
    Then the result matches "/?repo=friend/cookbook#*"

  Scenario: ?repo= sends its requests there
    Given "friend/cookbook" has published the fixture as "Friend's cookbook"
    When I open "?repo=friend/cookbook#/recipe/salsa-verde", once ".steps li" shows
    And I click "a.ingredient-link >> text=scallions"
    And I wait until "table" shows
    And I tick "input[value=salsa-verde]"
    And I click "form button[type=submit]"
    And I click 'dialog[open] .picker li:has-text("Onion") >> nth=0'
    And I type "Roasted onions." into "dialog[open] textarea"
    And I click "dialog[open] >> text=Request on GitHub", which opens a GitHub issue
    Then the result's "issue" is "https://github.com/friend/cookbook/issues/new"
    And the result's "request.action" is "add-substitution"

  Scenario: ?repo= naming a repository with nothing published says how to set it up
    Given GitHub and jsDelivr know nothing
    And the browser may log any error here
    When I open "?repo=nobody/nothing#/", once 'article:has-text("No recipes here yet")' shows
    Then the page's 'article:has-text("No recipes here yet")' includes "This repository (nobody/nothing) has not yet been set up to host recipes."
    And the page's 'article:has-text("No recipes here yet") a:has-text("nobody/nothing")' has "href" set to "https://github.com/nobody/nothing"
    And the page's 'article:has-text("No recipes here yet") a:has-text("these instructions")' has "href" set to "https://github.com/Sustenaut/recipe-host#set-up-a-recipe-repository"
    And the page does not show 'article:has-text("Something went wrong")'

  Scenario: A site with login shows nothing before signing in
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    Then the page does not show ".row"

  Scenario: A site with login comes back from the sign-in to the same address, ?repo= and view included
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I read the page's address
    Then the result is "/?repo=example/recipes#/recipes"
    And the page's ".account .who" reads "Anna Tester"

  Scenario: A site with login keeps a star in the reader's file
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Anna Tester"
    Then the result is '["salsa-verde"]'

  Scenario: A site with login keeps nothing in the browser
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    And the browser keeps no favourites
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Anna Tester"
    And I count the keys the browser keeps
    Then the result is "0"

  Scenario: A site with login reads the reader's favourites back, and signing out goes back to the sign-in screen
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    And I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Anna Tester"
    When I open "#/", once ".card" shows
    Then the page's ".card strong" lists '["Salsa verde"]'
    When I sign out
    Then the page shows ".sign-in button"

  Scenario: A reader who signs in starts from what this browser kept, and that moves to their file
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    And I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Anna Tester"
    And I sign out
    And I wait until ".sign-in button" shows
    And the browser keeps the favourites '["herb-salad"]'
    When I open "#/", once ".sign-in button" shows
    And I sign in as "Ben Tester"
    And I wait until ".card" shows
    Then the page's ".card strong" lists '["Herb salad"]'
    When I read the favourites the mock keeps for "Ben Tester" now
    Then the result is '["herb-salad"]'
    When I read the favourites the mock keeps for "Anna Tester" now
    Then the result is '["salsa-verde"]'

  Scenario: An expired sign-in is renewed with the refresh token, on opening the page and before saving
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    And the browser keeps the favourites '["herb-salad"]'
    And the mock's sign-in lasts 1 second
    And I open "#/", once ".sign-in button" shows
    And I sign in as "Ben Tester"
    And I wait until ".card" shows
    And I wait 1500 ms
    When I open "#/recipes", once ".row" shows
    Then the page's ".account .who" reads "Ben Tester"
    When I wait 1500 ms
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Ben Tester"
    Then the result is '["herb-salad", "salsa-verde"]'

  Scenario: A published page that needs sign-in asks nothing of GitHub or the recipe data before it
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    And the site has a page "pinned.html" that needs sign-in and is pinned to one commit
    When I list what opening "pinned.html#/" asks for beyond the site's page, app and libraries
    Then the result is "[]"

  Scenario: Cancelling at the sign-in page says so
    Given the site signs in through the mock with openid
    And the browser may log errors mentioning "404" here
    When I open "#/", once ".sign-in button" shows
    And I click ".sign-in button"
    And I click "text=Cancel"
    Then the page's ".sign-in .alert" reads "Sign-in was cancelled."

  Scenario: A site with a session service loads no sign-in library: the service does the signing in
    Given the site signs in through the mock with session
    And the browser may log errors mentioning "401" here
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I evaluate "typeof window.oidc" on the page
    Then the result is "undefined"

  Scenario: A site with a session service comes back from the sign-in to the same address
    Given the site signs in through the mock with session
    And the browser may log errors mentioning "401" here
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I read the page's address
    Then the result is "/?repo=example/recipes#/recipes"
    And the page's ".account .who" reads "Anna Tester"

  Scenario: A site with a session service keeps a star there, and reads it back
    Given the site signs in through the mock with session
    And the browser may log errors mentioning "401" here
    And the browser may log errors mentioning "404" here
    When I open "?repo=example/recipes#/recipes", once ".sign-in button" shows
    And I sign in as "Anna Tester"
    And I wait until ".row" shows
    And I click '.row:has-text("Salsa verde") .star'
    And I read the favourites the mock keeps for "Anna Tester"
    Then the result is '["salsa-verde"]'
    When I open "#/", once ".card" shows
    Then the page's ".card strong" lists '["Salsa verde"]'

  Scenario: A site with a session service moves what this browser kept to the reader who signs in
    Given the site signs in through the mock with session
    And the browser may log errors mentioning "401" here
    And the browser may log errors mentioning "404" here
    And the browser keeps the favourites '["herb-salad"]'
    When I open "#/", once ".sign-in button" shows
    And I sign in as "Ben Tester"
    And I wait until ".card" shows
    Then the page's ".card strong" lists '["Herb salad"]'
    When I read the favourites the mock keeps for "Ben Tester" now
    Then the result is '["herb-salad"]'
    When I sign out
    Then the page shows ".sign-in button"

  Scenario: A pinned page has a bell, unlit while the publish it reads is the newest
    Given the site has a page "pinned.html" pinned to the commit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And "example/recipes" has published the fixture as "Old recipes" at "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And "example/recipes" has published the fixture as "New recipes" at "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    And GitHub reports "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as the newest publish
    And the page's clock is a test clock
    When I open "pinned.html#/recipe/salsa-verde", once ".steps li" shows
    And I wait until ".bell" shows
    Then the page does not show ".bell.active"
    And the page does not show ".reload"

  Scenario: A pinned page lights the bell an hour after a newer publish is out, and reloads into it
    Given the site has a page "pinned.html" pinned to the commit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And "example/recipes" has published the fixture as "Old recipes" at "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And "example/recipes" has published the fixture as "New recipes" at "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    And GitHub reports "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as the newest publish
    And the page's clock is a test clock
    When I open "pinned.html#/recipe/salsa-verde", once ".steps li" shows
    And I wait until ".bell" shows
    And the page has asked GitHub for the newest publish
    And GitHub reports "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as the newest publish from now on
    And 30 minutes pass on the page's clock
    Then the page does not show ".bell.active"
    When 30 minutes pass on the page's clock
    And I wait until ".bell.active" shows
    Then the page's ".pure-menu-heading span" reads "Old recipes"
    When I click ".reload"
    Then the page's ".pure-menu-heading span" reads "New recipes"
    And the page does not show ".bell.active"
    And the page does not show ".reload"
    And the page shows ".steps li"

  Scenario: A page that names its data's hash reads the data that was published
    Given jsDelivr serves the publish "cccccccccccccccccccccccccccccccccccccccc" titled "Checked recipes" with "recipes/herb-salad.json" changed from "Herb salad" to "Weed salad"
    And GitHub reports "cccccccccccccccccccccccccccccccccccccccc" as the newest publish
    And the host serves a page that reads the publish "cccccccccccccccccccccccccccccccccccccccc" and names its hash
    And the browser may log errors mentioning "integrity" here
    And the browser may log errors mentioning "valid digest" here
    When I open "checked.html#/recipe/salsa-verde", once ".steps li" shows
    Then the page's ".pure-menu-heading span" reads "Checked recipes"

  Scenario: A page that names its data's hash refuses a recipe file changed on the way
    Given jsDelivr serves the publish "cccccccccccccccccccccccccccccccccccccccc" titled "Checked recipes" with "recipes/herb-salad.json" changed from "Herb salad" to "Weed salad"
    And GitHub reports "cccccccccccccccccccccccccccccccccccccccc" as the newest publish
    And the host serves a page that reads the publish "cccccccccccccccccccccccccccccccccccccccc" and names its hash
    And the browser may log errors mentioning "integrity" here
    And the browser may log errors mentioning "valid digest" here
    When I open "checked.html#/recipe/salsa-verde", once ".steps li" shows
    And I go to "checked.html#/recipe/herb-salad" on the same page, once "text=Something went wrong" shows
    Then the page does not show "text=Weed salad"

  Scenario: A page that names its data's hash refuses an index that is not the one it names
    Given jsDelivr serves the publish "cccccccccccccccccccccccccccccccccccccccc" titled "Checked recipes" byte for byte
    And GitHub reports "cccccccccccccccccccccccccccccccccccccccc" as the newest publish
    And the host serves a page that reads the publish "cccccccccccccccccccccccccccccccccccccccc" and names another hash
    And the browser may log errors mentioning "integrity" here
    And the browser may log errors mentioning "valid digest" here
    When I open "checked.html#/recipes", once "text=Something went wrong" shows
    Then the page does not show ".row"

  Scenario: A page that names its data's hash reloads only into data its host names
    Given jsDelivr serves the publish "dddddddddddddddddddddddddddddddddddddddd" titled "Old checked recipes" byte for byte
    And jsDelivr serves the publish "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" titled "New checked recipes" byte for byte
    And the host serves a page that reads the publish "dddddddddddddddddddddddddddddddddddddddd" and names its hash
    And GitHub reports "dddddddddddddddddddddddddddddddddddddddd" as the newest publish
    And the browser may log errors mentioning "integrity" here
    And the browser may log errors mentioning "valid digest" here
    And the page's clock is a test clock
    And I open "checked.html#/recipe/salsa-verde", once ".steps li" shows
    And the page has asked GitHub for the newest publish
    And GitHub reports "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as the newest publish from now on
    And 60 minutes pass on the page's clock
    And I wait until ".bell.active" shows
    # GitHub has the newer publish, but the host still serves the old page.
    When I click ".reload"
    And I wait 200 ms
    Then the page's ".pure-menu-heading span" reads "Old checked recipes"
    And the page shows ".bell.active"
    And the page's ".update-note" includes "still being published"
    # Nor while the host can't be reached.
    When the host can't be reached for "checked.html"
    And I click ".reload"
    And I wait 200 ms
    Then the page's ".pure-menu-heading span" reads "Old checked recipes"
    # A newer page whose hash the data does not match: the page keeps what it shows.
    When the host can be reached for "checked.html" again
    And the host serves a page that reads the publish "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" and names another hash
    And I click ".reload"
    And I wait 200 ms
    Then the page's ".pure-menu-heading span" reads "Old checked recipes"
    And the page shows ".bell.active"
    # Once the newer page is deployed, the reload takes its data and hash.
    When the host serves a page that reads the publish "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" and names its hash
    And I click ".reload"
    Then the page's ".pure-menu-heading span" reads "New checked recipes"
    And the page does not show ".bell.active"
    And the page shows ".steps li"
    And the page does not show ".update-note"

  Scenario: A newer publish that changes the page itself reloads the page, onto the same view
    Given jsDelivr serves the publish "ffffffffffffffffffffffffffffffffffffffff" titled "Old checked recipes" byte for byte
    And jsDelivr serves the publish "1111111111111111111111111111111111111111" titled "New checked recipes" byte for byte
    And the host serves a page that reads the publish "ffffffffffffffffffffffffffffffffffffffff" and names its hash
    And GitHub reports "ffffffffffffffffffffffffffffffffffffffff" as the newest publish
    And the browser may log errors mentioning "integrity" here
    And the browser may log errors mentioning "valid digest" here
    And the page's clock is a test clock
    And I open "checked.html#/recipe/salsa-verde", once ".steps li" shows
    And the page has asked GitHub for the newest publish
    And GitHub reports "1111111111111111111111111111111111111111" as the newest publish from now on
    And 60 minutes pass on the page's clock
    And I wait until ".bell.active" shows
    When the host serves the page for the publish "1111111111111111111111111111111111111111" under the title "Renamed recipes"
    And I click ".reload", which reloads the page
    And I wait until ".steps li" shows
    And I evaluate "window.RECIPE_HOST.title" on the page
    Then the result is "Renamed recipes"
    And the page's ".pure-menu-heading span" reads "New checked recipes"

  Scenario: A page that reads the newest commit has no bell
    When I open "#/recipes", once ".row" shows
    Then the page does not show ".bell"

  Scenario: No page logged an error
    When I gather the errors every page logged
    Then the result is "[]"
