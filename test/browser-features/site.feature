@site
Feature: Browser test of the site: builds test/fixtures/repo, serves it locally and clicks through every view in Chromium

  Scenario: The recipe list searches ingredients and filters by type and meal
    Then the recipe list searches ingredients and filters by type and meal

  Scenario: The front page shows the favourites starred on the list, kept per repository
    Then the front page shows the favourites starred on the list, kept per repository

  Scenario: The header marks the current section and shows the logo
    Then the header marks the current section and shows the logo

  Scenario: A recipe shows its facts, linked ingredients, swaps and notes
    Then a recipe shows its facts, linked ingredients, swaps and notes

  Scenario: An unknown recipe says so
    Then an unknown recipe says so

  Scenario: The ingredient list filters, and its menu requests a merge
    Then the ingredient list filters, and its menu requests a merge

  Scenario: The menu closes on an outside click and on Escape
    Then the menu closes on an outside click and on Escape

  Scenario: The menu opens below its button, or above it near the bottom of the window
    Then the menu opens below its button, or above it near the bottom of the window

  Scenario: Adding an ingredient refuses a name already on the list
    Then adding an ingredient refuses a name already on the list

  Scenario: An ingredient page lists its uses and requests a substitution for the ticked recipes
    Then an ingredient page lists its uses and requests a substitution for the ticked recipes

  Scenario: ?repo= shows another repository and sends its requests there
    Then ?repo= shows another repository and sends its requests there

  Scenario: ?repo= naming a repository with nothing published says how to set it up
    Then ?repo= naming a repository with nothing published says how to set it up

  Scenario: A site with login asks readers to sign in and keeps their favourites in their bucket
    Then a site with login asks readers to sign in and keeps their favourites in their bucket

  Scenario: A site with a session service signs readers in there and keeps their favourites there
    Then a site with a session service signs readers in there and keeps their favourites there

  Scenario: A pinned page lights the bell when a newer publish is out, and reloads into it
    Then a pinned page lights the bell when a newer publish is out, and reloads into it

  Scenario: A page that names its data's hash refuses data that is not what was published
    Then a page that names its data's hash refuses data that is not what was published

  Scenario: A page that names its data's hash reloads only into data its host names
    Then a page that names its data's hash reloads only into data its host names

  Scenario: A newer publish that changes the page itself reloads the page
    Then a newer publish that changes the page itself reloads the page

  Scenario: A page that reads the newest commit has no bell
    Then a page that reads the newest commit has no bell

  Scenario: No page logged an error
    Then no page logged an error
