// The mock Sustenaut sign-in and favourites service (lib/mock-login.js),
// served on a port of its own and asked as http://login.test, so the
// addresses it names are the same in every run. The suite's steps carry
// what a flow passes on (a code, tokens, a link, a cookie); pubtest's steps
// send the plain requests and check what came back.

import crypto from 'node:crypto';
import http from 'node:http';
import { Given, When } from '@cucumber/cucumber';
import { Answer } from '@sustenaut/pubtest/http';
import { mockLogin, mockPageSettings } from '../lib/mock-login.js';

const ORIGIN = 'http://login.test';
const OIDC = '/mock/auth/realms/sustenaut/protocol/openid-connect';
const verifier = 'a-verifier-long-enough-for-pkce-0123456789abcdef';
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const authParams = (extra = {}) => ({
  client_id: 'recipes', redirect_uri: 'http://app.test/recipes/?repo=a/b', response_type: 'code',
  code_challenge: challenge, code_challenge_method: 'S256', state: 's1', nonce: 'n1', scope: 'openid profile', ...extra,
});

// A request to the mock as http://login.test: a path, or an address there.
function ask(world, method, address, headers = {}, body = undefined) {
  const url = new URL(address, ORIGIN);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: world.mockPort, method, path: url.pathname + url.search, headers: { ...headers, host: 'login.test' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(new Answer(res.statusCode, Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])), Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const post = (world, path, fields) => ask(world, 'POST', path, FORM, new URLSearchParams(fields).toString());
const json = (a) => { try { return a.json(); } catch { return a.text; } };

Given('the mock sign-in service, for the apps recipes at http:\\/\\/app.test\\/recipes\\/* and other at http:\\/\\/app.test\\/other\\/', async function () {
  this.clock = Date.now();
  this.mock = mockLogin({ clients: { recipes: ['http://app.test/recipes/*'], other: ['http://app.test/other/'] }, now: () => this.clock });
  const server = http.createServer(async (req, res) => {
    if (!(await this.mock.handle(req, res))) { res.writeHead(418); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  this.pubtest.cleanup(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  this.mockPort = server.address().port;
  this.service = (method, path, headers, body) => ask(this, method, path, headers, body);
});

// The code flow: sign in as a test account, and the redirect back to the app.
async function signIn(world, account) {
  const back = await post(world, `${OIDC}/auth`, { ...authParams(), account });
  return { status: back.status, location: back.header('location') };
}

async function exchange(world, extra = {}) {
  const code = new URL(world.signedIn.location).searchParams.get('code');
  const res = await post(world, `${OIDC}/token`, { grant_type: 'authorization_code', client_id: 'recipes', code, redirect_uri: authParams().redirect_uri, code_verifier: verifier, ...extra });
  const body = json(res);
  return { status: res.status, ...body, ...(body.access_token ? { access: claims(body.access_token), id: claims(body.id_token) } : {}) };
}

When('I sign in as account {string}', async function (account) {
  await this.attempt(async () => {
    const { status, location } = await signIn(this, account);
    const back = new URL(location);
    const params = Object.fromEntries(back.searchParams);
    if (!params.code) delete params.code;
    return { status, back: back.origin + back.pathname, ...params };
  });
});

Given('I signed in as account {string}', async function (account) {
  this.signedIn = await signIn(this, account);
});

Given('I hold tokens for account {string}', async function (account) {
  this.signedIn = await signIn(this, account);
  this.tokens = await exchange(this);
});

Given('I hold the access token {string}', function (token) {
  this.tokens = { access_token: token };
});

// pubtest's HTTP steps send it from here on.
Given('requests carry my access token', function () {
  this.pubtest.headers.authorization = `Bearer ${this.tokens.access_token}`;
});

When('I exchange the code for tokens', async function () {
  await this.attempt(() => exchange(this));
});

When('I exchange the code for tokens again', async function () {
  await this.attempt(() => exchange(this));
});

When('I exchange the code for tokens with {string} set to {string}', async function (field, value) {
  await this.attempt(() => exchange(this, { [field]: value }));
});

async function refresh(world, client) {
  const res = await post(world, `${OIDC}/token`, { grant_type: 'refresh_token', client_id: client, refresh_token: world.tokens.refresh_token });
  return { status: res.status, ...json(res) };
}

When('I refresh my tokens as the client {string}', async function (client) {
  await this.attempt(() => refresh(this, client));
});

When('I refresh my tokens as the client {string} again', async function (client) {
  await this.attempt(() => refresh(this, client));
});

When('I log out with my ID token as the hint, back to {string}', async function (to) {
  await this.attempt(async () => {
    const res = await ask(this, 'GET', `${OIDC}/logout?${new URLSearchParams({ id_token_hint: this.tokens.id_token, post_logout_redirect_uri: to })}`);
    return { status: res.status, location: res.header('location') };
  });
});

// The favourites service: a presigned link for a key.
async function presign(world, method, key) {
  const res = await ask(world, 'POST', '/mock/presign/v1/presign', { authorization: `Bearer ${world.tokens.access_token}`, 'content-type': 'application/json' }, JSON.stringify({ method, key }));
  const body = json(res);
  return { status: res.status, ...(body.url ? { path: new URL(body.url).pathname, url: body.url } : body) };
}

When('I ask for a link to {string} the file {string}', async function (method, key) {
  await this.attempt(() => presign(this, method, key));
});

Given('links to read and write the file {string}', async function (key) {
  this.links = { GET: (await presign(this, 'GET', key)).url, PUT: (await presign(this, 'PUT', key)).url };
});

Given('{string} was written through the link', async function (body) {
  await ask(this, 'PUT', this.links.PUT, { 'content-type': 'application/json' }, body);
});

Given('{int} minutes pass', function (minutes) {
  this.clock += minutes * 60 * 1000;
});

const through = async (world, link, method, body, change = (u) => u) => {
  const res = await ask(world, method, change(world.links[link]), body ? { 'content-type': 'application/json' } : {}, body);
  return { status: res.status, type: res.header('content-type') ?? null, body: json(res) };
};

When('I read through the read link', async function () {
  await this.attempt(() => through(this, 'GET', 'GET'));
});

When('I write {string} through the write link', async function (body) {
  await this.attempt(() => through(this, 'PUT', 'PUT', body));
});

When('I write {string} through the read link', async function (body) {
  await this.attempt(() => through(this, 'GET', 'PUT', body));
});

When('I read through the read link with its signature changed', async function () {
  await this.attempt(() => through(this, 'GET', 'GET', undefined, (u) => u.replace('signature=', 'signature=x')));
});

When('I send the token endpoint a form of {int} KiB', async function (size) {
  await this.attempt(async () => (await post(this, `${OIDC}/token`, { grant_type: 'x'.repeat(size * 1024) })).status);
});

When('I read the preview page settings', async function () {
  await this.attempt(() => mockPageSettings());
});

When('I read the preview page settings for {string}', async function (way) {
  await this.attempt(() => mockPageSettings(way));
});

// The session service: its cookie, carried by pubtest's requests.
Given('I am signed in to the session service as account {string}', async function (account) {
  const res = await post(this, `/mock/session/sign-in?rd=${encodeURIComponent(`${ORIGIN}/recipes/#/`)}`, { account });
  this.pubtest.headers.cookie = res.header('set-cookie').split(';')[0];
});

When('I sign in to the session service as account {string}, back to {string}', async function (account, rd) {
  await this.attempt(async () => {
    const res = await post(this, `/mock/session/sign-in?rd=${encodeURIComponent(rd)}`, { account });
    return { status: res.status, location: res.header('location'), ...(res.header('set-cookie') ? { cookie: res.header('set-cookie') } : {}) };
  });
});

When('I cancel the session service\'s sign-in, back to {string}', async function (rd) {
  await this.attempt(async () => {
    const res = await post(this, `/mock/session/sign-in?rd=${encodeURIComponent(rd)}`, { cancel: '1' });
    return { status: res.status, location: res.header('location'), ...(res.header('set-cookie') ? { cookie: res.header('set-cookie') } : {}) };
  });
});

When('I count the files the session service keeps', async function () {
  await this.attempt(() => this.mock.kept.size);
});

When('I write favourites of {int} KiB to {string}', async function (size, path) {
  await this.attempt(async () => (await ask(this, 'PUT', path, { cookie: this.pubtest.headers.cookie, 'content-type': 'application/json' }, JSON.stringify({ x: 'y'.repeat(size * 1024) }))).status);
});

Given('{string} was written to the session service\'s {string}', async function (body, path) {
  await ask(this, 'PUT', path, { cookie: this.pubtest.headers.cookie, 'content-type': 'application/json' }, body);
});
