#!/usr/bin/env node
// Command line for a recipe repository. Run it from the repository's root,
// or pass --root. See README.md for what each command is for.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../lib/build.js';
import { linkRecipe } from '../lib/link.js';
import { loadRepo } from '../lib/repo.js';
import { applyRequest, readRequest, RequestError } from '../lib/requests.js';

const USAGE = `Usage: recipe-host <command> [options]

  check                    check every recipe and ingredient
  build [--out DIR]        build the site data (default _site) and cards
        [--engine URL]     the app's boot.js for index.html (default: this version on jsDelivr)
  link FILE...             link a recipe's plain ingredient lines to the ingredient list
  request --issue FILE     apply the request in a GitHub issue (JSON from the API)
  serve [--port N]         build, then preview the site at http://localhost:N

  --root DIR               the recipe repository (default: current folder)
  --no-cards               build without the PDF cards`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-cards') args.cards = false;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function report({ errors, warnings }) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
}

// GitHub Actions output, when running there.
function setOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([k, v]) => `${k}<<RECIPE_HOST_EOF\n${v}\nRECIPE_HOST_EOF\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join(''));
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? '.');
const [command, ...rest] = args._;

switch (command) {
  case 'check': {
    const repo = loadRepo(root);
    report(repo);
    console.log(`${repo.recipes.length} recipes, ${repo.ingredients.size} ingredients, ${repo.errors.length} errors, ${repo.warnings.length} warnings`);
    process.exit(repo.errors.length ? 1 : 0);
  }
  case 'build': {
    const out = path.resolve(args.out ?? path.join(root, '_site'));
    const options = {};
    if (args.cards === false) options.cards = false;
    if (args.engine) options.engine = args.engine;
    const repo = buildSite(root, out, options);
    report(repo);
    process.exit(repo.errors.length ? 1 : 0);
  }
  case 'link': {
    if (!rest.length) {
      console.error('link needs at least one recipe file');
      process.exit(2);
    }
    let unmatched = 0;
    for (const file of rest) {
      const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/');
      const result = linkRecipe(root, rel);
      for (const line of result.linked) console.log(`${rel}: linked  ${line}`);
      for (const line of result.unmatched) console.log(`${rel}: no match for "${line}"; link an existing ingredient or add ingredients/<id>.md`);
      unmatched += result.unmatched.length;
    }
    process.exit(unmatched ? 1 : 0);
  }
  case 'request': {
    const issue = JSON.parse(fs.readFileSync(args.issue, 'utf8'));
    let request;
    try {
      request = readRequest(issue.body);
      if (!request) {
        console.log('This issue holds no recipe-host request.');
        setOutput({ status: 'none' });
        process.exit(0);
      }
      const result = applyRequest(root, request);
      const body = [
        result.summary,
        `Requested by @${issue.user?.login ?? 'unknown'} in #${issue.number}. Review the change here; merging it rebuilds the site.`,
        `Closes #${issue.number}`,
      ].join('\n\n');
      setOutput({ status: 'ok', branch: `recipe-host/${issue.number}-${result.branch}`.slice(0, 100), title: result.title, body });
      console.log(result.title);
    } catch (err) {
      if (!(err instanceof RequestError)) throw err;
      console.log(err.message);
      setOutput({ status: 'error', message: err.message });
    }
    process.exit(0);
  }
  case 'serve': {
    const out = path.resolve(args.out ?? path.join(root, '_site'));
    const repo = buildSite(root, out, args.cards === false ? { cards: false } : {});
    report(repo);
    if (repo.errors.length) process.exit(1);
    serve(out, Number(args.port ?? 8080), repo.config);
    break;
  }
  default:
    console.log(USAGE);
    process.exit(command ? 2 : 0);
}

// A local preview: the app from this checkout, marked from node_modules,
// and the built data, all on one origin.
function serve(out, port, config) {
  const engine = fileURLToPath(new URL('..', import.meta.url));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const shell = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${config.title}</title>
<script src="/engine/app/boot.js" data-repo="${config.repo ?? 'owner/repo'}" data-data="/data/"
  data-marked="/engine/node_modules/marked/lib/marked.esm.js"></script>
</head><body></body></html>`;
  http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(shell);
    }
    if (url.startsWith('/engine/')) file = path.join(engine, url.slice(8));
    if (url.startsWith('/data/')) file = path.join(out, url.slice(6));
    if (!file || !file.startsWith(url.startsWith('/engine/') ? engine : out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`Previewing at http://localhost:${port}/`));
}
