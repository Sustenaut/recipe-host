// The mock Sustenaut sign-in and favourites service (lib/mock-login.js):
// the code flow with PKCE, refresh, presigned links, and every refusal the
// real services make. The browser test signs in through it from the page.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { MOCK_ACCOUNTS, mockLogin, mockPageSettings } from '../lib/mock-login.js';

let server;
let base;
let mock;
let clock = Date.now();

before(async () => {
  mock = mockLogin({ clients: { recipes: ['http://app.test/recipes/*'], other: ['http://app.test/other/'] }, now: () => clock });
  server = http.createServer(async (req, res) => {
    if (!(await mock.handle(req, res))) { res.writeHead(418); res.end(); }
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const issuer = () => `${base}/mock/auth/realms/sustenaut`;
const oidc = (path) => `${issuer()}/protocol/openid-connect/${path}`;
const verifier = 'a-verifier-long-enough-for-pkce-0123456789abcdef';
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), redirect: 'manual' });

const authParams = (extra = {}) => ({
  client_id: 'recipes', redirect_uri: 'http://app.test/recipes/?repo=a/b', response_type: 'code',
  code_challenge: challenge, code_challenge_method: 'S256', state: 's1', nonce: 'n1', scope: 'openid profile', ...extra,
});

// Signs in as a test account; returns the redirect back to the app.
async function signIn(account = '0', extra = {}) {
  const res = await fetch(oidc('auth'), form({ ...authParams(extra), account }));
  assert.equal(res.status, 302);
  return new URL(res.headers.get('location'));
}

async function tokens(extra = {}) {
  const back = await signIn();
  const res = await fetch(oidc('token'), form({ grant_type: 'authorization_code', client_id: 'recipes', code: back.searchParams.get('code'), redirect_uri: authParams().redirect_uri, code_verifier: verifier, ...extra }));
  return { res, body: await res.json() };
}

async function presign(token, ask) {
  const res = await fetch(`${base}/mock/presign/v1/presign`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(ask) });
  return { status: res.status, body: await res.json() };
}

test('discovery and keys describe the realm', async () => {
  const meta = await (await fetch(`${issuer()}/.well-known/openid-configuration`)).json();
  assert.equal(meta.issuer, issuer());
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  const { keys } = await (await fetch(meta.jwks_uri)).json();
  assert.equal(keys[0].alg, 'RS256');
});

test('the sign-in page offers the test accounts, and comes back with a code and the state', async () => {
  const page = await (await fetch(`${oidc('auth')}?${new URLSearchParams(authParams())}`)).text();
  for (const a of MOCK_ACCOUNTS) assert.match(page, new RegExp(`Sign in as ${a.name}`));
  assert.match(page, /action="\/mock\/auth\/realms\/sustenaut\/protocol\/openid-connect\/auth"/);
  const back = await signIn();
  assert.equal(back.origin + back.pathname, 'http://app.test/recipes/');
  assert.equal(back.searchParams.get('repo'), 'a/b');
  assert.equal(back.searchParams.get('state'), 's1');
  assert.equal(back.searchParams.get('iss'), issuer());
  assert.ok(back.searchParams.get('code'));
});

test('a code becomes tokens for the account, once', async () => {
  const back = await signIn('1');
  const exchange = () => fetch(oidc('token'), form({ grant_type: 'authorization_code', client_id: 'recipes', code: back.searchParams.get('code'), redirect_uri: authParams().redirect_uri, code_verifier: verifier }));
  const body = await (await exchange()).json();
  const access = claims(body.access_token);
  assert.deepEqual([access.iss, access.sub, access.azp, access.aud], [issuer(), MOCK_ACCOUNTS[1].sub, 'recipes', ['presign']]);
  assert.deepEqual([claims(body.id_token).nonce, claims(body.id_token).name], ['n1', 'Ben Tester']);
  const again = await exchange();
  assert.equal(again.status, 400);
  assert.equal((await again.json()).error, 'invalid_grant');
  const user = await (await fetch(oidc('userinfo'), { headers: { authorization: `Bearer ${body.access_token}` } })).json();
  assert.equal(user.name, 'Ben Tester');
});

test('the token exchange refuses a wrong verifier, client or redirect', async () => {
  for (const extra of [{ code_verifier: 'wrong' }, { client_id: 'other' }, { redirect_uri: 'http://app.test/recipes/' }]) {
    const { res, body } = await tokens(extra);
    assert.equal(res.status, 400);
    assert.equal(body.error, 'invalid_grant');
  }
  const { body } = await tokens({ grant_type: 'password' });
  assert.equal(body.error, 'unsupported_grant_type');
});

test('a refresh token gives new tokens once, to its own client', async () => {
  const { body } = await tokens();
  const refresh = (client) => fetch(oidc('token'), form({ grant_type: 'refresh_token', client_id: client, refresh_token: body.refresh_token }));
  assert.equal((await refresh('other')).status, 400);
  const { body: second } = await tokens();
  const res = await fetch(oidc('token'), form({ grant_type: 'refresh_token', client_id: 'recipes', refresh_token: second.refresh_token }));
  assert.ok((await res.json()).access_token);
  const replay = await fetch(oidc('token'), form({ grant_type: 'refresh_token', client_id: 'recipes', refresh_token: second.refresh_token }));
  assert.equal(replay.status, 400);
});

test('the sign-in refuses unknown clients, foreign redirects and flows without PKCE', async () => {
  const get = (extra) => fetch(`${oidc('auth')}?${new URLSearchParams(authParams(extra))}`, { redirect: 'manual' });
  assert.equal((await get({ client_id: 'nobody' })).status, 400);
  assert.equal((await get({ redirect_uri: 'http://evil.test/' })).status, 400);
  const plain = new URL((await get({ code_challenge_method: 'plain' })).headers.get('location'));
  assert.equal(plain.searchParams.get('error'), 'invalid_request');
  const cancel = await fetch(oidc('auth'), form({ ...authParams(), cancel: '1' }));
  assert.equal(new URL(cancel.headers.get('location')).searchParams.get('error'), 'access_denied');
  assert.equal((await fetch(oidc('auth'), form({ ...authParams(), account: '9' }))).status, 400);
  assert.equal((await fetch(oidc('userinfo'), { headers: { authorization: 'Bearer nonsense' } })).status, 401);
});

test('logout returns to an allowed address, named by client or by the ID token', async () => {
  const { body } = await tokens();
  const out = (q) => fetch(`${oidc('logout')}?${new URLSearchParams(q)}`, { redirect: 'manual' });
  const byHint = await out({ id_token_hint: body.id_token, post_logout_redirect_uri: 'http://app.test/recipes/' });
  assert.equal(byHint.headers.get('location'), 'http://app.test/recipes/');
  const byClient = await out({ client_id: 'other', post_logout_redirect_uri: 'http://app.test/other/' });
  assert.equal(byClient.headers.get('location'), 'http://app.test/other/');
  assert.equal((await out({ client_id: 'recipes', post_logout_redirect_uri: 'http://evil.test/' })).status, 200);
});

test('a presigned link reads and writes only the account’s own file in its app’s folder', async () => {
  const { body } = await tokens();
  const put = await presign(body.access_token, { method: 'PUT', key: 'favourites/a/b.json' });
  assert.equal(new URL(put.body.url).pathname, `/mock/bucket/recipes/${MOCK_ACCOUNTS[0].sub}/favourites/a/b.json`);
  const get = await presign(body.access_token, { method: 'GET', key: 'favourites/a/b.json' });
  assert.equal((await fetch(get.body.url)).status, 404);
  assert.equal((await fetch(put.body.url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"favourites":["x"]}' })).status, 200);
  const read = await fetch(get.body.url);
  assert.deepEqual([read.headers.get('content-type'), (await read.json()).favourites], ['application/json', ['x']]);
  // A GET link does not write, a tampered one does nothing, an old one has expired.
  assert.equal((await fetch(get.body.url, { method: 'PUT', body: '{}' })).status, 403);
  assert.equal((await fetch(get.body.url.replace('signature=', 'signature=x'))).status, 403);
  clock += 6 * 60 * 1000;
  assert.equal((await fetch(get.body.url)).status, 403);
  clock -= 6 * 60 * 1000;
});

test('the favourites service refuses missing tokens, other apps, bad methods and keys', async () => {
  assert.equal((await presign('nonsense', { method: 'GET', key: 'x' })).status, 401);
  const { body } = await tokens();
  assert.equal((await presign(body.access_token, { method: 'DELETE', key: 'x' })).status, 400);
  for (const key of ['../x', 'a/../b', 'Capital', '', 'x'.repeat(201)]) {
    assert.equal((await presign(body.access_token, { method: 'GET', key })).status, 400, key);
  }
  const res = await fetch(`${base}/mock/presign/v1/presign`, { method: 'POST', headers: { authorization: `Bearer ${body.access_token}` }, body: 'not json' });
  assert.equal(res.status, 400);
});

test('the mock answers only its own paths, preflights, and oversized bodies', async () => {
  assert.equal((await fetch(`${base}/elsewhere`)).status, 418);
  assert.equal((await fetch(`${base}/mock/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/mock/auth/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/mock/presign/v1/other`, { method: 'POST' })).status, 404);
  const pre = await fetch(`${base}/mock/presign/v1/presign`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const big = await fetch(oidc('token'), form({ grant_type: 'x'.repeat(300 * 1024) }));
  assert.equal(big.status, 413);
});

test('the preview page settings point at the mock', () => {
  assert.deepEqual(mockPageSettings(), { login: { session: '/mock/session/', required: true }, favourites: null });
  assert.deepEqual(mockPageSettings('openid'), {
    login: { issuer: '/mock/auth/realms/sustenaut', client: 'recipes', required: true },
    favourites: '/mock/presign/',
  });
});

// Signs in to the session service as a test account; returns the cookie.
async function sessionCookie(account = '0', rd = `${base}/recipes/#/`) {
  const res = await fetch(`${base}/mock/session/sign-in?rd=${encodeURIComponent(rd)}`, form({ account }));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), rd);
  return res.headers.get('set-cookie').split(';')[0];
}

test('the session service signs in, says who, and signs out, back to the page', async () => {
  const page = await (await fetch(`${base}/mock/session/sign-in?rd=x`)).text();
  assert.match(page, /Sign in as Anna Tester/);
  const cookie = await sessionCookie();
  const me = await fetch(`${base}/mock/session/me`, { headers: { cookie } });
  assert.deepEqual(await me.json(), { email: 'anna@example.org', name: 'Anna Tester' });
  assert.equal((await fetch(`${base}/mock/session/me`)).status, 401);
  const out = await fetch(`${base}/mock/session/sign-out?rd=${encodeURIComponent(`${base}/recipes/`)}`, { redirect: 'manual' });
  assert.equal(out.headers.get('location'), `${base}/recipes/`);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  // Cancelling, or a page elsewhere, goes back without a session.
  const cancel = await fetch(`${base}/mock/session/sign-in?rd=${encodeURIComponent('http://evil.test/')}`, form({ cancel: '1' }));
  assert.equal(cancel.headers.get('location'), `${base}/`);
  assert.equal(cancel.headers.get('set-cookie'), null);
});

test('the session service keeps each account its own favourites', async () => {
  const anna = await sessionCookie('0');
  const ben = await sessionCookie('1');
  const file = `${base}/mock/session/favourites/a/b.json`;
  const put = (cookie, body, type = 'application/json') => fetch(file, { method: 'PUT', headers: { cookie, 'content-type': type }, body });
  assert.equal((await fetch(file, { headers: { cookie: anna } })).status, 404);
  assert.equal((await put(anna, '{"favourites":["x"]}')).status, 200);
  assert.deepEqual((await (await fetch(file, { headers: { cookie: anna } })).json()).favourites, ['x']);
  assert.equal((await fetch(file, { headers: { cookie: ben } })).status, 404);
  assert.equal(mock.kept.size, 1);
  // Refusals: not signed in, not JSON, a bad name, too big.
  assert.equal((await fetch(file)).status, 401);
  assert.equal((await put(anna, 'x', 'text/plain')).status, 415);
  assert.equal((await put(anna, 'not json')).status, 400);
  assert.equal((await fetch(`${base}/mock/session/favourites/../b.json`, { headers: { cookie: anna } })).status, 404);
  assert.equal((await put(anna, JSON.stringify({ x: 'y'.repeat(70 * 1024) }))).status, 413);
});
