@mock-login
Feature: The mock Sustenaut sign-in and favourites service (lib/mock-login.js): the code flow with PKCE, refresh, presigned links, and every refusal the real services make

  Scenario: Discovery and keys describe the realm
    Then discovery and keys describe the realm

  Scenario: The sign-in page offers the test accounts, and comes back with a code and the state
    Then the sign-in page offers the test accounts, and comes back with a code and the state

  Scenario: A code becomes tokens for the account, once
    Then a code becomes tokens for the account, once

  Scenario: The token exchange refuses a wrong verifier, client or redirect
    Then the token exchange refuses a wrong verifier, client or redirect

  Scenario: A refresh token gives new tokens once, to its own client
    Then a refresh token gives new tokens once, to its own client

  Scenario: The sign-in refuses unknown clients, foreign redirects and flows without PKCE
    Then the sign-in refuses unknown clients, foreign redirects and flows without PKCE

  Scenario: Logout returns to an allowed address, named by client or by the ID token
    Then logout returns to an allowed address, named by client or by the ID token

  Scenario: A presigned link reads and writes only the account’s own file in its app’s folder
    Then a presigned link reads and writes only the account’s own file in its app’s folder

  Scenario: The favourites service refuses missing tokens, other apps, bad methods and keys
    Then the favourites service refuses missing tokens, other apps, bad methods and keys

  Scenario: The mock answers only its own paths, preflights, and oversized bodies
    Then the mock answers only its own paths, preflights, and oversized bodies

  Scenario: The preview page settings point at the mock
    Then the preview page settings point at the mock

  Scenario: The session service signs in, says who, and signs out, back to the page
    Then the session service signs in, says who, and signs out, back to the page

  Scenario: The session service keeps each account its own favourites
    Then the session service keeps each account its own favourites
