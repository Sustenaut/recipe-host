#!/usr/bin/env node
// Command line for a recipe repository. Run it from the repository's root,
// or pass --root. See README.md for what each command is for.

import fs from 'node:fs';
import path from 'node:path';
import { buildSite } from '../lib/build.js';
import { linkRecipe } from '../lib/link.js';
import { checkConfig, loadConfig, loadRepo } from '../lib/repo.js';
import { mockLogin, mockPageSettings } from '../lib/mock-login.js';
import { pageHtml, sri } from '../lib/page.js';
import { applyRequest, readRequest, RequestError } from '../lib/requests.js';
import { LOCAL_PAGE, serve } from '../lib/serve.js';

const USAGE = `Usage: recipe-host <command> [options]

  check                    check every recipe and ingredient
  build [--out DIR]        build the site data (default _site) and cards
        [--engine URL]     the app/ folder index.html loads from (default: this version on jsDelivr)
  page --out FILE          write only index.html, for the web server
       [--engine URL]     as for build
       [--data URL]       read the data from here (e.g. one commit on jsDelivr) instead of asking GitHub
       [--index FILE]     that data's index.json, whose hash the page then checks
  link FILE...             link a recipe's plain ingredient lines to the ingredient list
  request --issue FILE     apply the request in a GitHub issue (JSON from the API)
  serve [--port N]         build, then preview the site at http://localhost:N
        [--mock-login]     sign in and keep favourites through a local stand-in
                           for auth.sustenaut.eu and the favourites service

  --root DIR               the recipe repository (default: current folder)
  --no-cards               build without the PDF cards`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-cards') args.cards = false;
    else if (a === '--mock-login') args.mockLogin = true;
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
    if (args.engine) options.page = { engine: args.engine };
    const repo = buildSite(root, out, options);
    report(repo);
    process.exit(repo.errors.length ? 1 : 0);
  }
  case 'page': {
    if (!args.out) {
      console.error('page needs --out FILE');
      process.exit(2);
    }
    const page = {};
    if (args.engine) page.engine = args.engine;
    if (args.data) page.data = args.data;
    if (args.index) page.dataIntegrity = sri(fs.readFileSync(args.index));
    const config = loadConfig(root);
    const errors = checkConfig(config);
    report({ errors, warnings: [] });
    if (errors.length) process.exit(1);
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, pageHtml(config, page));
    process.exit(0);
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
    // Everything on one local origin: the app from this checkout, the
    // libraries from node_modules, and the built data.
    const out = path.resolve(args.out ?? path.join(root, '_site'));
    const options = { page: args.mockLogin ? { ...LOCAL_PAGE, ...mockPageSettings() } : LOCAL_PAGE };
    if (args.cards === false) options.cards = false;
    const repo = buildSite(root, out, options);
    report(repo);
    if (repo.errors.length) process.exit(1);
    const port = Number(args.port ?? 8080);
    const mock = args.mockLogin ? mockLogin() : null;
    serve(out, { mock }).listen(port, () => console.log(`Previewing at http://localhost:${port}/${mock ? ', signing in through the mock at /mock/' : ''}`));
    break;
  }
  default:
    console.log(USAGE);
    process.exit(command ? 2 : 0);
}
