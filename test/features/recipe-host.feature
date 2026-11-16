@recipe-host
Feature: Building a recipe site: parsing recipes and ingredients, the index, cards, requests and the pages

  Scenario: An ingredient line splits into quantity, references and preparation
    Then an ingredient line splits into quantity, references and preparation

  Scenario: A recipe parses into facts, ingredient groups and named steps
    Then a recipe parses into facts, ingredient groups and named steps

  Scenario: A recipe without links, servings or a method reports every problem
    Then a recipe without links, servings or a method reports every problem

  Scenario: A link to an ingredient without a file is an error
    Then a link to an ingredient without a file is an error

  Scenario: An unused ingredient is a warning, not an error
    Then an unused ingredient is a warning, not an error

  Scenario: The index lists each ingredient with the recipes that use it and how
    Then the index lists each ingredient with the recipes that use it and how

  Scenario: Card data is plain text with the draft note kept
    Then card data is plain text with the draft note kept

  Scenario: A request is read from the recipe-host block of an issue
    Then a request is read from the recipe-host block of an issue

  Scenario: Merging relinks recipes and keeps the old name as an alias
    Then merging relinks recipes and keeps the old name as an alias

  Scenario: Merging moves substitutions that point at the merged ingredient
    Then merging moves substitutions that point at the merged ingredient

  Scenario: An ingredient cannot be merged into itself or a missing one
    Then an ingredient cannot be merged into itself or a missing one

  Scenario: Adding an ingredient writes its file and refuses duplicates
    Then adding an ingredient writes its file and refuses duplicates

  Scenario: A substitution note is stored on the ingredient for the chosen recipes
    Then a substitution note is stored on the ingredient for the chosen recipes

  Scenario: A substitution for a recipe that does not use the ingredient is refused
    Then a substitution for a recipe that does not use the ingredient is refused

  Scenario: Link adds ingredient links by name and alias and reports the rest
    Then link adds ingredient links by name and alias and reports the rest

  Scenario: A page pinned to one data commit preloads its index and skips asking GitHub
    Then a page pinned to one data commit preloads its index and skips asking GitHub

  Scenario: A page given its data's hash names it, on the preload too
    Then a page given its data's hash names it, on the preload too

  Scenario: recipe-host page --index names the hash of that index.json in the page
    Then recipe-host page --index names the hash of that index.json in the page

  Scenario: The built index holds the integrity of every recipe file, and those files match it
    Then the built index holds the integrity of every recipe file, and those files match it

  Scenario: Every library the page loads carries the integrity of the file its version ships
    Then every library the page loads carries the integrity of the file its version ships

  Scenario: Every script and stylesheet on the page names its integrity, the app itself included
    Then every script and stylesheet on the page names its integrity, the app itself included

  Scenario: A site with login loads the sign-in library and passes its settings to the page
    Then a site with login loads the sign-in library and passes its settings to the page

  Scenario: Login settings in recipe-host.yml are read and checked
    Then login settings in recipe-host.yml are read and checked

  Scenario: A session service for sign-in is read and checked
    Then a session service for sign-in is read and checked

  Scenario: The page carries an Open Graph card for link previews, with the site's own image if it names one
    Then the page carries an Open Graph card for link previews, with the site's own image if it names one

  Scenario: Typst is found by absolute path, from $TYPST or else PATH, and never from a relative PATH entry
    Then typst is found by absolute path, from $TYPST or else PATH, and never from a relative PATH entry

  Scenario: The Markdown patterns keep their meaning and stay fast on hostile text
    Then the Markdown patterns keep their meaning and stay fast on hostile text
