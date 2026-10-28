// A stand-in for the Sustenaut sign-in (Keycloak at auth.sustenaut.eu) and
// the favourites service (presign.sustenaut.eu), for `recipe-host serve
// --mock-login` and the browser tests. It speaks the same protocol the page
// uses with the real ones:
//
// - OpenID Connect under <prefix>/auth/realms/sustenaut: discovery, the code
//   flow with PKCE (S256 only), refresh tokens, the signing keys (RS256),
//   userinfo and logout. Its sign-in page offers test accounts where the real
//   one asks for an EU wallet.
// - The favourites service under <prefix>/presign: POST v1/presign with the
//   access token and `{method: "GET" | "PUT", key}` answers `{url, expires}`,
//   a link to `<app>/<account>/<key>` in a bucket, valid for five minutes.
//   <app> is the token's `azp` and <account> its `sub`.
// - That bucket under <prefix>/bucket, in memory: GET answers 404 for a file
//   never written, PUT stores the body. Links are checked like S3 checks its
//   presigned ones: an unsigned or expired link is refused.
// - A session service under <prefix>/session, like the share.schryer.eu
//   portal's recipes part: sign-in and sign-out send the reader back to
//   `rd` with or without its cookie, `me` says who it is, and favourites
//   are kept in memory per account (see `sessionLogin` in app/app.js).
//
// Nothing here is secure enough for real use: the keys live as long as the
// process, and anyone can pick any test account.

import crypto from 'node:crypto';

export const MOCK_ACCOUNTS = [
  { sub: 'f2c6a1de-0000-4000-8000-000000000001', name: 'Anna Tester', given_name: 'Anna', family_name: 'Tester', email: 'anna@example.org' },
  { sub: 'f2c6a1de-0000-4000-8000-000000000002', name: 'Ben Tester', given_name: 'Ben', family_name: 'Tester', email: 'ben@example.org' },
];

const REALM = '/auth/realms/sustenaut';
const OIDC = `${REALM}/protocol/openid-connect`;
const LINK_SECONDS = 300;
const KEY = /^[a-z0-9._/-]{1,200}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// `prefix` is the path the mock answers under, `clients` the client ids it
// accepts, each with the redirect URIs it allows (a trailing * matches any
// rest), `audience` what the access token is for, and `accessSeconds` how
// long tokens last (a test can change it on the returned `settings`).
export function mockLogin({ prefix = '/mock', clients = { recipes: ['*'] }, audience = 'presign', accessSeconds = 300, now = () => Date.now() } = {}) {
  const settings = { accessSeconds };
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = b64url(crypto.randomBytes(8));
  const linkSecret = crypto.randomBytes(32);
  const codes = new Map();
  const refreshTokens = new Map();
  const bucket = new Map();
  const seconds = () => Math.floor(now() / 1000);

  const sign = (claims) => {
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${b64url(crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey))}`;
  };

  // The claims of a token this mock signed, or null. A logout hint may
  // have expired.
  const verify = (token, issuer, { expired = false } = {}) => {
    const [head, body, sig] = String(token).split('.');
    if (!sig || !crypto.verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, 'base64url'))) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url'));
    return claims.iss === issuer && (expired || claims.exp > seconds()) ? claims : null;
  };

  const allowedRedirect = (client, uri) => (clients[client] ?? [])
    .some((p) => (p.endsWith('*') ? uri.startsWith(p.slice(0, -1)) : uri === p));

  const tokens = (issuer, client, account, nonce) => {
    const iat = seconds();
    const base = { iss: issuer, sub: account.sub, azp: client, iat, sid: crypto.randomUUID() };
    const refresh = b64url(crypto.randomBytes(24));
    refreshTokens.set(refresh, { client, account });
    const { sub, ...profile } = account;
    return {
      access_token: sign({ ...base, aud: [audience], exp: iat + settings.accessSeconds, typ: 'Bearer', scope: 'openid profile', jti: crypto.randomUUID() }),
      id_token: sign({ ...base, ...profile, aud: client, exp: iat + settings.accessSeconds, typ: 'ID', ...(nonce ? { nonce } : {}) }),
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: settings.accessSeconds,
      scope: 'openid profile',
    };
  };

  const linkSignature = (method, path, expires) => crypto.createHmac('sha256', linkSecret).update(`${method}\n${path}\n${expires}`).digest('base64url');

  // ---- responses
  const send = (res, status, body, headers = {}) => {
    const json = typeof body !== 'string';
    res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store', ...cors, ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
  const oauthError = (res, status, error, description) => send(res, status, { error, error_description: description });
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };

  async function readBody(req, limit = 256 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  function signInPage(params, action) {
    const hidden = [...params].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
    const buttons = MOCK_ACCOUNTS.map((a, i) => `<button name="account" value="${i}">Sign in as ${escapeHtml(a.name)}</button>`).join(' ');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in (mock)</title>
<style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem;margin:.25rem 0}</style>
<h1>Sustenaut sign-in (mock)</h1>
<p>This stands in for auth.sustenaut.eu, where you would sign in with your EU wallet. Pick a test account.</p>
<form method="post" action="${escapeHtml(action)}">${hidden}${buttons} <button name="cancel" value="1">Cancel</button></form>`;
  }

  // ---- OpenID Connect
  async function oidc(req, res, url, issuer) {
    const path = url.pathname;
    if (path === `${REALM}/.well-known/openid-configuration`) {
      return send(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        subject_types_supported: ['public'],
        scopes_supported: ['openid', 'profile'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (path === `${OIDC}/certs`) {
      return send(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    }
    if (path === `${OIDC}/auth`) {
      const params = req.method === 'POST' ? new URLSearchParams((await readBody(req)).toString()) : url.searchParams;
      const client = params.get('client_id');
      const uri = params.get('redirect_uri') ?? '';
      if (!clients[client]) return send(res, 400, `<p>Unknown client ${escapeHtml(client)}.</p>`);
      if (!allowedRedirect(client, uri)) return send(res, 400, `<p>The redirect URI ${escapeHtml(uri)} is not allowed for ${escapeHtml(client)}.</p>`);
      const back = new URL(uri);
      if (params.get('state')) back.searchParams.set('state', params.get('state'));
      back.searchParams.set('iss', issuer);
      if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) {
        back.searchParams.set('error', 'invalid_request');
        back.searchParams.set('error_description', 'Only the code flow with PKCE (S256) is allowed');
        return redirect(res, back.href);
      }
      if (req.method !== 'POST') {
        const shown = new URLSearchParams([...params].filter(([k]) => !['account', 'cancel'].includes(k)));
        return send(res, 200, signInPage(shown, `${prefix}${url.pathname}`));
      }
      if (params.get('cancel')) {
        back.searchParams.set('error', 'access_denied');
        return redirect(res, back.href);
      }
      const account = MOCK_ACCOUNTS.at(Number(params.get('account')));
      if (!account) return send(res, 400, '<p>Pick one of the test accounts.</p>');
      const code = b64url(crypto.randomBytes(24));
      codes.set(code, { client, uri, account, challenge: params.get('code_challenge'), nonce: params.get('nonce'), expires: now() + 60_000 });
      back.searchParams.set('code', code);
      return redirect(res, back.href);
    }
    if (path === `${OIDC}/token` && req.method === 'POST') {
      const params = new URLSearchParams((await readBody(req)).toString());
      const client = params.get('client_id');
      if (params.get('grant_type') === 'authorization_code') {
        const grant = codes.get(params.get('code'));
        codes.delete(params.get('code'));
        if (!grant || grant.expires < now()) return oauthError(res, 400, 'invalid_grant', 'Code not valid');
        if (grant.client !== client || grant.uri !== params.get('redirect_uri')) return oauthError(res, 400, 'invalid_grant', 'Code was issued to another client or redirect URI');
        const verifier = params.get('code_verifier') ?? '';
        if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== grant.challenge) return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
        return send(res, 200, tokens(issuer, client, grant.account, grant.nonce));
      }
      if (params.get('grant_type') === 'refresh_token') {
        const grant = refreshTokens.get(params.get('refresh_token'));
        refreshTokens.delete(params.get('refresh_token'));
        if (!grant || grant.client !== client) return oauthError(res, 400, 'invalid_grant', 'Token is not active');
        return send(res, 200, tokens(issuer, client, grant.account));
      }
      return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
    }
    if (path === `${OIDC}/userinfo`) {
      const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), issuer);
      if (!claims) return oauthError(res, 401, 'invalid_token', 'Token verification failed');
      const account = MOCK_ACCOUNTS.find((a) => a.sub === claims.sub);
      return send(res, 200, account);
    }
    if (path === `${OIDC}/logout`) {
      const to = url.searchParams.get('post_logout_redirect_uri');
      const client = url.searchParams.get('client_id') ?? verify(url.searchParams.get('id_token_hint'), issuer, { expired: true })?.aud;
      if (to && allowedRedirect(client, to)) return redirect(res, to);
      return send(res, 200, '<p>You are signed out.</p>');
    }
    return send(res, 404, { error: 'not_found' });
  }

  // ---- the favourites service
  async function presign(req, res, url, issuer, origin) {
    if (url.pathname !== '/presign/v1/presign' || req.method !== 'POST') return send(res, 404, { error: 'not_found' });
    const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), issuer);
    if (!claims || ![claims.aud].flat().includes(audience)) return send(res, 401, { error: 'Sign in again: the access token is missing, expired or not for this service.' });
    if (!clients[claims.azp]) return send(res, 403, { error: `The app ${claims.azp} may not store files here.` });
    let ask;
    try { ask = JSON.parse((await readBody(req, 4096)).toString()); } catch { ask = null; }
    if (!['GET', 'PUT'].includes(ask?.method)) return send(res, 400, { error: 'method must be GET or PUT' });
    if (!KEY.test(ask.key ?? '') || ask.key.split('/').includes('..')) return send(res, 400, { error: 'key must be 1 to 200 of a-z 0-9 . _ / - with no ..' });
    const path = `${prefix}/bucket/${claims.azp}/${claims.sub}/${ask.key}`;
    const expires = seconds() + LINK_SECONDS;
    const link = new URL(path, origin);
    link.searchParams.set('expires', String(expires));
    link.searchParams.set('signature', linkSignature(ask.method, path, expires));
    return send(res, 200, { url: link.href, expires: new Date(expires * 1000).toISOString() });
  }

  async function bucketFile(req, res, url) {
    const path = `${prefix}${url.pathname}`;
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';
    const expected = linkSignature(req.method, path, expires);
    const fresh = expires >= seconds();
    if (!fresh || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return send(res, 403, { error: 'AccessDenied' });
    }
    if (req.method === 'GET') {
      const file = bucket.get(path);
      if (!file) return send(res, 404, { error: 'NoSuchKey' });
      res.writeHead(200, { 'content-type': file.type, ...cors });
      return res.end(file.body);
    }
    bucket.set(path, { body: await readBody(req), type: req.headers['content-type'] ?? 'application/octet-stream' });
    return send(res, 200, {});
  }

  // Answers a request whose path starts with `prefix`; returns false for
  // any other, so a server can fall through to its own files.
  // ---- the session service
  const SESSION_COOKIE = 'mock-session';
  const sessions = new Map();
  const kept = new Map();
  const FILE = /^favourites\/[\w.-]+\/[\w.-]+\.json$/;

  const sessionAccount = (req) => {
    const id = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return sessions.get(id) ?? null;
  };

  async function session(req, res, url, origin) {
    const path = url.pathname.slice('/session/'.length);
    const rd = url.searchParams.get('rd') ?? '';
    // Back only to a page on this origin, as the real one allows only its sites.
    const back = rd.startsWith(`${origin}/`) ? rd : `${origin}/`;
    if (path === 'sign-in' && req.method === 'GET') {
      const buttons = MOCK_ACCOUNTS.map((a, i) => `<button name="account" value="${i}">Sign in as ${escapeHtml(a.name)}</button>`).join(' ');
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Sign in (mock)</title><h1>Sign in (mock)</h1>
<p>This stands in for the share portal's sign-in, where you would use a passkey or an emailed code.</p>
<form method="post">${buttons} <button name="cancel" value="1">Cancel</button></form>`);
    }
    if (path === 'sign-in' && req.method === 'POST') {
      const params = new URLSearchParams((await readBody(req)).toString());
      const account = MOCK_ACCOUNTS.at(Number(params.get('account')));
      if (params.get('cancel') || !account) return redirect(res, back);
      const id = b64url(crypto.randomBytes(24));
      sessions.set(id, account);
      res.setHeader('set-cookie', `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`);
      return redirect(res, back);
    }
    if (path === 'sign-out' && req.method === 'GET') {
      res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
      return redirect(res, back);
    }
    const account = sessionAccount(req);
    if (!account) return send(res, 401, { error: 'Sign in first.' });
    if (path === 'me' && req.method === 'GET') return send(res, 200, { email: account.email, name: account.name });
    if (!FILE.test(path) || !['GET', 'PUT'].includes(req.method)) return send(res, 404, { error: 'not_found' });
    const key = `${account.email}/${path}`;
    if (req.method === 'GET') return kept.has(key) ? send(res, 200, JSON.parse(kept.get(key))) : send(res, 404, { error: 'none yet' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' });
    const body = (await readBody(req, 64 * 1024)).toString();
    try { JSON.parse(body); } catch { return send(res, 400, { error: 'Send JSON.' }); }
    kept.set(key, body);
    return send(res, 200, {});
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    const origin = `http://${req.headers.host}`;
    const issuer = `${origin}${prefix}${REALM}`;
    url.pathname = url.pathname.slice(prefix.length);
    try {
      if (req.method === 'OPTIONS') send(res, 204, '');
      else if (url.pathname.startsWith('/auth/')) await oidc(req, res, url, issuer);
      else if (url.pathname.startsWith('/presign/')) await presign(req, res, url, issuer, origin);
      else if (url.pathname.startsWith('/bucket/') && ['GET', 'PUT'].includes(req.method)) await bucketFile(req, res, url);
      else if (url.pathname.startsWith('/session/')) await session(req, res, url, origin);
      else send(res, 404, { error: 'not_found' });
    } catch (err) {
      send(res, err.status ?? 500, { error: err.message });
    }
    return true;
  }

  return { handle, bucket, kept, settings };
}

// The page settings that point a local preview at the mock, signing in
// through the session service or with OpenID Connect.
export const mockPageSettings = (way = 'session', prefix = '/mock') => (way === 'session'
  ? { login: { session: `${prefix}/session/`, required: true }, favourites: null }
  : { login: { issuer: `${prefix}${REALM}`, client: 'recipes', required: true }, favourites: `${prefix}/presign/` });
