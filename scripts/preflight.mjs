#!/usr/bin/env node
/**
 * directory-preflight: check a plugin folder against the plugin directory's pre-submission
 * checklist, and print each finding as the result the portal would give it.
 *
 * Read-only. This program never writes, moves or deletes a file.
 *
 * Usage: node preflight.mjs [path] [options]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createScan, resolveLimits, findGitRoot } from './lib/scan.mjs';
import { RULES, JUDGMENT_ITEMS } from './rules/index.mjs';
import { runRules, sortFindings, summarize, exitCodeFor } from './lib/run.mjs';
import { renderText, renderMarkdown, renderJson } from './lib/report.mjs';
import { TOOL_NAME, TOOL_VERSION, RULESET, BLOCKING_RESULTS } from './lib/registry.mjs';

const USAGE = `${TOOL_NAME} ${TOOL_VERSION}

Check a Claude Code plugin against the plugin directory's pre-submission checklist.

Usage
  node preflight.mjs [path] [options]

  path                 The plugin folder: the one that holds .claude-plugin/plugin.json.
                       Defaults to the current directory.

Options
  --repo <path>        Treat this folder as the repository root instead of the nearest
                       Git working tree.
  --json               Print a JSON report.
  --md                 Print a Markdown report.
  --worktree           Check the files on disk instead of the commit Git tracks.
  --quiet              Print only the findings that decide the exit code.
  --strict             Let heuristic findings decide the exit code too.
  --max-findings <n>   Cap how many findings each rule prints (default 20).
  --no-judgment        Leave out the list of decisions this checker cannot make.
  -h, --help           Show this text.
  -V, --version        Show the version.

Exit codes
  0  Nothing that blocks a submission was found.
  1  At least one finding stops validation or blocks a submission.
  2  The checker could not run: the path is not a plugin folder, or the options are wrong.

Ruleset ${RULESET.version}, mirroring ${RULESET.source}.
`;

function parseArgs(argv) {
  const options = {
    target: null,
    repo: null,
    format: 'text',
    quiet: false,
    strict: false,
    worktree: false,
    maxFindings: null,
    judgment: true,
  };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--repo': options.repo = readValue('--repo'); break;
      case '--json': options.format = 'json'; break;
      case '--md': case '--markdown': options.format = 'markdown'; break;
      case '--worktree': options.worktree = true; break;
      case '--quiet': options.quiet = true; break;
      case '--strict': options.strict = true; break;
      case '--no-judgment': options.judgment = false; break;
      case '--max-findings': {
        const value = Number(readValue('--max-findings'));
        if (!Number.isInteger(value) || value < 1) throw new Error('--max-findings needs a whole number of at least 1');
        options.maxFindings = value;
        break;
      }
      case '-h': case '--help': options.help = true; break;
      case '-V': case '--version': options.version = true; break;
      default:
        if (arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option "${arg}"`);
        rest.push(arg);
    }
  }
  if (rest.length > 1) throw new Error(`Expected at most one path, got ${rest.length}`);
  options.target = rest[0] ?? '.';
  return options;
}

/** The plugin folder for a path, or a reason the path cannot be one. */
function locatePlugin(target) {
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) return { error: `There is no folder at ${absolute}.` };
  if (!fs.statSync(absolute).isDirectory()) return { error: `${absolute} is not a folder.` };
  if (fs.existsSync(path.join(absolute, '.claude-plugin', 'plugin.json'))) return { pluginDir: absolute };

  const children = fs.readdirSync(absolute, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => fs.existsSync(path.join(absolute, name, '.claude-plugin', 'plugin.json')));
  if (children.length > 0) {
    return {
      error: `This folder holds ${children.length} plugin folder(s): ${children.join(', ')}.\n` +
        'The directory validates and submits one plugin at a time; run the checker on each folder.',
    };
  }

  // A folder with component folders but no manifest is still a plugin folder to check: the
// docs classify a missing manifest as Blocks, and nothing here should refuse to look.
  const componentFolders = ['skills', 'commands', 'agents', 'hooks', '.mcp.json', 'SKILL.md'];
  if (componentFolders.some((name) => fs.existsSync(path.join(absolute, name)))) {
    return { pluginDir: absolute };
  }

  const top = fs.readdirSync(absolute, { withFileTypes: true }).map((dirent) => dirent.name).slice(0, 12);
  return {
    error: `No plugin found at ${absolute}.\n` +
      'A plugin folder contains .claude-plugin/plugin.json, or a skills/<name>/SKILL.md.\n' +
      `This folder holds: ${top.join(', ') || '(nothing)'}\n` +
      'A marketplace entry can describe a plugin without a plugin folder of its own; there is nothing here to check.',
  };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }

  const located = locatePlugin(options.target);
  if (located.error) {
    process.stderr.write(`${located.error}\n`);
    return 2;
  }
  if (options.repo !== null && !fs.existsSync(options.repo)) {
    process.stderr.write(`There is no folder at ${path.resolve(options.repo)} to use as the repository root.\n`);
    return 2;
  }

  const overrides = {};
  if (options.maxFindings !== null) overrides.maxFindingsPerRule = options.maxFindings;
  let scan;
  try {
    scan = createScan({
      target: located.pluginDir,
      // Only an explicit --repo names the repository root. Discovery, and the fallback when
      // the repository above the plugin cannot be read, belong to the scan.
      repoRoot: options.repo ? path.resolve(options.repo) : null,
      limits: resolveLimits(overrides),
      worktree: options.worktree,
    });
  } catch (error) {
    process.stderr.write(`The checker could not read this folder: ${error.message}\n`);
    return 2;
  }

  const { findings, suppressed } = runRules(scan, RULES);
  let visible = sortFindings(findings);
  // The same set the exit code uses: a heuristic finding is not a portal result, so it is
  // not something --quiet should print as one.
  if (options.quiet) {
    visible = visible.filter((finding) =>
      BLOCKING_RESULTS.has(finding.result) && (!finding.heuristic || options.strict));
  }
  const judgment = options.judgment ? JUDGMENT_ITEMS : [];

  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(renderJson(scan, visible, { suppressed, judgment, strict: options.strict }), null, 2)}\n`);
  } else if (options.format === 'markdown') {
    process.stdout.write(`${renderMarkdown(scan, visible, { suppressed, judgment, strict: options.strict })}\n`);
  } else {
    process.stdout.write(`${renderText(scan, visible, { suppressed, judgment, strict: options.strict })}\n`);
  }

  return exitCodeFor(summarize(visible), { strict: options.strict });
}

process.exitCode = main(process.argv.slice(2));

export { locatePlugin, parseArgs };