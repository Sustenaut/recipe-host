@mock-login
Feature: The mock Sustenaut sign-in and favourites service (lib/mock-login.js): the code flow with PKCE, refresh, presigned links, and every refusal the real services make

  The mock is asked as http://login.test. The app "recipes" signs in with
  PKCE (S256), the state s1 and the nonce n1, back to
  http://app.test/recipes/?repo=a/b. Account 0 is Anna Tester, 1 Ben Tester.

  Background:
    Given the mock sign-in service, for the apps recipes at http://app.test/recipes/* and other at http://app.test/other/

  Scenario: Discovery describes the realm
    When I GET "/mock/auth/realms/sustenaut/.well-known/openid-configuration"
    Then the answer is 200
    And the answer includes '"issuer":"http://login.test/mock/auth/realms/sustenaut"'
    And the answer includes '"code_challenge_methods_supported":["S256"]'
    And the answer includes '"jwks_uri":"http://login.test/mock/auth/realms/sustenaut/protocol/openid-connect/certs"'

  Scenario: The realm's keys are RS256
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/certs"
    Then the answer is 200
    And the answer includes '"alg":"RS256"'

  Scenario: The sign-in page offers the test accounts
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/auth?client_id=recipes&redirect_uri=http%3A%2F%2Fapp.test%2Frecipes%2F%3Frepo%3Da%2Fb&response_type=code&code_challenge=JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic&code_challenge_method=S256&state=s1&nonce=n1&scope=openid+profile"
    Then the answer is 200
    And the answer includes "Sign in as Anna Tester"
    And the answer includes "Sign in as Ben Tester"
    And the answer includes 'action="/mock/auth/realms/sustenaut/protocol/openid-connect/auth"'

  Scenario: Signing in comes back to the app with a code and the state
    When I sign in as account "0"
    Then the result's "status" is "302"
    And the result's "back" is "http://app.test/recipes/"
    And the result's "repo" is "a/b"
    And the result's "state" is "s1"
    And the result's "iss" is "http://login.test/mock/auth/realms/sustenaut"
    And the result includes "code"

  Scenario: A code becomes tokens for the account
    Given I signed in as account "1"
    When I exchange the code for tokens
    Then the result's "status" is "200"
    And the result's "access.iss" is "http://login.test/mock/auth/realms/sustenaut"
    And the result's "access.sub" is "f2c6a1de-0000-4000-8000-000000000002"
    And the result's "access.azp" is "recipes"
    And the result's "access.aud" is '["presign"]'
    And the result's "id.nonce" is "n1"
    And the result's "id.name" is "Ben Tester"

  Scenario: A code becomes tokens only once
    Given I signed in as account "1"
    When I exchange the code for tokens
    And I exchange the code for tokens again
    Then the result's "status" is "400"
    And the result's "error" is "invalid_grant"

  Scenario: The access token says who signed in
    Given I hold tokens for account "1"
    And requests carry my access token
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/userinfo"
    Then the answer is 200
    And the answer includes '"name":"Ben Tester"'

  Scenario Outline: The token exchange refuses a wrong verifier, client or redirect
    Given I signed in as account "0"
    When I exchange the code for tokens with "<field>" set to "<value>"
    Then the result's "status" is "400"
    And the result's "error" is "invalid_grant"

    Examples:
      | field         | value                    |
      | code_verifier | wrong                    |
      | client_id     | other                    |
      | redirect_uri  | http://app.test/recipes/ |

  Scenario: The token exchange takes no other grant
    Given I signed in as account "0"
    When I exchange the code for tokens with "grant_type" set to "password"
    Then the result's "error" is "unsupported_grant_type"

  Scenario: A refresh token is its own client's
    Given I hold tokens for account "0"
    When I refresh my tokens as the client "other"
    Then the result's "status" is "400"

  Scenario: A refresh token gives new tokens
    Given I hold tokens for account "0"
    When I refresh my tokens as the client "recipes"
    Then the result's "status" is "200"
    And the result includes "access_token"

  Scenario: A refresh token gives new tokens once
    Given I hold tokens for account "0"
    When I refresh my tokens as the client "recipes"
    And I refresh my tokens as the client "recipes" again
    Then the result's "status" is "400"

  Scenario Outline: The sign-in refuses unknown clients and foreign redirects
    When I GET "<path>"
    Then the answer is 400

    Examples:
      | path                                                                                                                                                                                                                                                                                     |
      | /mock/auth/realms/sustenaut/protocol/openid-connect/auth?client_id=nobody&redirect_uri=http%3A%2F%2Fapp.test%2Frecipes%2F%3Frepo%3Da%2Fb&response_type=code&code_challenge=JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic&code_challenge_method=S256&state=s1&nonce=n1&scope=openid+profile |
      | /mock/auth/realms/sustenaut/protocol/openid-connect/auth?client_id=recipes&redirect_uri=http%3A%2F%2Fevil.test%2F&response_type=code&code_challenge=JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic&code_challenge_method=S256&state=s1&nonce=n1&scope=openid+profile                        |

  Scenario: The sign-in refuses a flow without PKCE's S256
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/auth?client_id=recipes&redirect_uri=http%3A%2F%2Fapp.test%2Frecipes%2F%3Frepo%3Da%2Fb&response_type=code&code_challenge=JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic&code_challenge_method=plain&state=s1&nonce=n1&scope=openid+profile"
    Then the answer redirects to "http://app.test/recipes/?repo=a%2Fb&state=s1&iss=http%3A%2F%2Flogin.test%2Fmock%2Fauth%2Frealms%2Fsustenaut&error=invalid_request&error_description=Only+the+code+flow+with+PKCE+%28S256%29+is+allowed"

  Scenario: Cancelling the sign-in goes back saying so
    When I POST to "/mock/auth/realms/sustenaut/protocol/openid-connect/auth" with the form:
      | field                 | value                                       |
      | client_id             | recipes                                     |
      | redirect_uri          | http://app.test/recipes/?repo=a/b           |
      | response_type         | code                                        |
      | code_challenge        | JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic |
      | code_challenge_method | S256                                        |
      | state                 | s1                                          |
      | nonce                 | n1                                          |
      | scope                 | openid profile                              |
      | cancel                | 1                                           |
    Then the answer redirects to "http://app.test/recipes/?repo=a%2Fb&state=s1&iss=http%3A%2F%2Flogin.test%2Fmock%2Fauth%2Frealms%2Fsustenaut&error=access_denied"

  Scenario: The sign-in refuses an account it doesn't have
    When I POST to "/mock/auth/realms/sustenaut/protocol/openid-connect/auth" with the form:
      | field                 | value                                       |
      | client_id             | recipes                                     |
      | redirect_uri          | http://app.test/recipes/?repo=a/b           |
      | response_type         | code                                        |
      | code_challenge        | JeR30v2Rq36d9_adNyut3uISPkJUgNuPkCAHZYvkQic |
      | code_challenge_method | S256                                        |
      | state                 | s1                                          |
      | nonce                 | n1                                          |
      | scope                 | openid profile                              |
      | account               | 9                                           |
    Then the answer is 400

  Scenario: Who signed in is told only for a token the mock signed
    Given requests carry the header "authorization" set to "Bearer nonsense"
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/userinfo"
    Then the answer is 401

  Scenario: Logout returns to an address of the client the ID token names
    Given I hold tokens for account "0"
    When I log out with my ID token as the hint, back to "http://app.test/recipes/"
    Then the result's "location" is "http://app.test/recipes/"

  Scenario: Logout returns to an address of the client named
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/logout?client_id=other&post_logout_redirect_uri=http%3A%2F%2Fapp.test%2Fother%2F"
    Then the answer redirects to "http://app.test/other/"

  Scenario: Logout returns nowhere the client doesn't allow
    When I GET "/mock/auth/realms/sustenaut/protocol/openid-connect/logout?client_id=recipes&post_logout_redirect_uri=http%3A%2F%2Fevil.test%2F"
    Then the answer is 200

  Scenario: A presigned link is to the account's own file in its app's folder
    Given I hold tokens for account "0"
    When I ask for a link to "PUT" the file "favourites/a/b.json"
    Then the result's "status" is "200"
    And the result's "path" is "/mock/bucket/recipes/f2c6a1de-0000-4000-8000-000000000001/favourites/a/b.json"

  Scenario: A file not written yet isn't there
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    When I read through the read link
    Then the result's "status" is "404"

  Scenario: A presigned link writes the file
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    When I write '{"favourites":["x"]}' through the write link
    Then the result's "status" is "200"

  Scenario: A presigned link reads what was written
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    And '{"favourites":["x"]}' was written through the link
    When I read through the read link
    Then the result's "status" is "200"
    And the result's "type" is "application/json"
    And the result's "body.favourites" is '["x"]'

  Scenario: A link to read doesn't write
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    When I write "{}" through the read link
    Then the result's "status" is "403"

  Scenario: A tampered link does nothing
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    And '{"favourites":["x"]}' was written through the link
    When I read through the read link with its signature changed
    Then the result's "status" is "403"

  Scenario: An old link has expired
    Given I hold tokens for account "0"
    And links to read and write the file "favourites/a/b.json"
    And '{"favourites":["x"]}' was written through the link
    And 6 minutes pass
    When I read through the read link
    Then the result's "status" is "403"

  Scenario: The favourites service refuses a token the mock didn't sign
    Given I hold the access token "nonsense"
    When I ask for a link to "GET" the file "x"
    Then the result's "status" is "401"

  Scenario: The favourites service gives links only to read and write
    Given I hold tokens for account "0"
    When I ask for a link to "DELETE" the file "x"
    Then the result's "status" is "400"

  Scenario Outline: The favourites service refuses a key that isn't a plain path
    Given I hold tokens for account "0"
    When I ask for a link to "GET" the file "<key>"
    Then the result's "status" is "400"

    Examples:
      | key                                                                                                                                                                                                       |
      | ../x                                                                                                                                                                                                      |
      | a/../b                                                                                                                                                                                                    |
      | Capital                                                                                                                                                                                                   |
      |                                                                                                                                                                                                           |
      | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx |

  Scenario: The favourites service refuses what isn't JSON
    Given I hold tokens for account "0"
    And requests carry my access token
    When I send "POST" to "/mock/presign/v1/presign" with:
      """
      not json
      """
    Then the answer is 400

  Scenario Outline: The mock answers only its own paths
    When I send "<method>" to "<path>"
    Then the answer is <status>

    Examples:
      | method | path                   | status |
      | GET    | /elsewhere             | 418    |
      | GET    | /mock/nothing          | 404    |
      | GET    | /mock/auth/nothing     | 404    |
      | POST   | /mock/presign/v1/other | 404    |

  Scenario: The mock answers a preflight
    When I send "OPTIONS" to "/mock/presign/v1/presign"
    Then the answer is 204
    And the answer's "access-control-allow-headers" is "authorization, content-type"

  Scenario: The mock refuses an oversized body
    When I send the token endpoint a form of 300 KiB
    Then the result is "413"

  Scenario: The preview page settings point at the mock's session service
    When I read the preview page settings
    Then the result is:
      """
      {"login": {"session": "/mock/session/", "required": true}, "favourites": null}
      """

  Scenario: The preview page settings for OpenID Connect point at the mock
    When I read the preview page settings for "openid"
    Then the result is:
      """
      {"login": {"issuer": "/mock/auth/realms/sustenaut", "client": "recipes", "required": true}, "favourites": "/mock/presign/"}
      """

  Scenario: The session service's sign-in page offers the test accounts
    When I GET "/mock/session/sign-in?rd=x"
    Then the answer includes "Sign in as Anna Tester"

  Scenario: The session service signs in, back to the page
    When I sign in to the session service as account "0", back to "http://login.test/recipes/#/"
    Then the result's "status" is "302"
    And the result's "location" is "http://login.test/recipes/#/"
    And the result includes "cookie"

  Scenario: The session service says who is signed in
    Given I am signed in to the session service as account "0"
    When I GET "/mock/session/me"
    Then the answer is the JSON:
      """
      {"email": "anna@example.org", "name": "Anna Tester"}
      """

  Scenario: The session service says no one is signed in without its cookie
    When I GET "/mock/session/me"
    Then the answer is 401

  Scenario: The session service signs out, back to the page
    Given I am signed in to the session service as account "0"
    When I GET "/mock/session/sign-out?rd=http%3A%2F%2Flogin.test%2Frecipes%2F"
    Then the answer redirects to "http://login.test/recipes/"
    And the answer's "set-cookie" is "mock-session=; Path=/; Max-Age=0"

  Scenario: Cancelling, or a page elsewhere, goes back to the site without a session
    When I cancel the session service's sign-in, back to "http://evil.test/"
    Then the result's "location" is "http://login.test/"
    And the result does not include "cookie"

  Scenario: The session service has no favourites before they are written
    Given I am signed in to the session service as account "0"
    When I GET "/mock/session/favourites/a/b.json"
    Then the answer is 404

  Scenario: The session service keeps favourites written
    Given I am signed in to the session service as account "0"
    When I send "PUT" to "/mock/session/favourites/a/b.json" with:
      """
      {"favourites":["x"]}
      """
    Then the answer is 200

  Scenario: The session service gives back the favourites written
    Given I am signed in to the session service as account "0"
    And '{"favourites":["x"]}' was written to the session service's "/mock/session/favourites/a/b.json"
    When I GET "/mock/session/favourites/a/b.json"
    Then the answer is the JSON:
      """
      {"favourites": ["x"]}
      """

  Scenario: The session service keeps each account its own favourites
    Given I am signed in to the session service as account "0"
    And '{"favourites":["x"]}' was written to the session service's "/mock/session/favourites/a/b.json"
    And I am signed in to the session service as account "1"
    When I GET "/mock/session/favourites/a/b.json"
    Then the answer is 404

  Scenario: The session service keeps one file for one account's favourites
    Given I am signed in to the session service as account "0"
    And '{"favourites":["x"]}' was written to the session service's "/mock/session/favourites/a/b.json"
    And I am signed in to the session service as account "1"
    When I GET "/mock/session/favourites/a/b.json"
    And I count the files the session service keeps
    Then the result is "1"

  Scenario: The session service keeps favourites only for who signed in
    When I GET "/mock/session/favourites/a/b.json"
    Then the answer is 401

  Scenario: The session service keeps only JSON
    Given I am signed in to the session service as account "0"
    And a scratch directory
    And a file "favourites.txt" holding "x"
    And requests carry the header "Content-Type" set to "text/plain"
    When I send "PUT" to "/mock/session/favourites/a/b.json" with the file "favourites.txt"
    Then the answer is 415

  Scenario: The session service refuses what isn't JSON
    Given I am signed in to the session service as account "0"
    When I send "PUT" to "/mock/session/favourites/a/b.json" with:
      """
      not json
      """
    Then the answer is 400

  Scenario: The session service has no file outside the reader's folder
    Given I am signed in to the session service as account "0"
    When I GET "/mock/session/favourites/../b.json"
    Then the answer is 404

  Scenario: The session service refuses favourites too big
    Given I am signed in to the session service as account "0"
    When I write favourites of 70 KiB to "/mock/session/favourites/a/b.json"
    Then the result is "413"
