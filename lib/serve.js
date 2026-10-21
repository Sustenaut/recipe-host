// `recipe-host serve`: a local preview on one origin, with the app from this
// checkout, its libraries from node_modules, and the built data.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Page options (see lib/page.js) that point index.html at this server.
export const LOCAL_PAGE = { engine: '/engine/app/', asset: (name, version, file) => `/vendor/${name}/${file}`, data: '/data/' };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Returns an http.Server for the site built into `out`; call listen() on it.
// `mock` (from lib/mock-login.js) answers its own paths first.
export function serve(out, { mock = null } = {}) {
  const engine = fileURLToPath(new URL('..', import.meta.url));
  const roots = { '/engine/': engine, '/vendor/': path.join(engine, 'node_modules'), '/data/': out, '/': out };
  return http.createServer(async (req, res) => {
    if (mock && await mock.handle(req, res)) return;
    // The base only lets URL parse and normalise the path; nothing is fetched.
    const url = decodeURIComponent(new URL(req.url, 'file:///').pathname).replace(/\/$/, '/index.html');
    const prefix = Object.keys(roots).find((p) => url.startsWith(p));
    const file = path.join(roots[prefix], url.slice(prefix.length));
    if (!file.startsWith(roots[prefix]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}
