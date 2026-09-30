/**
 * Test helpers.
 *
 * Two kinds of fixture, both written under one fresh directory created for this run inside
 * the system temporary directory, so a test run never touches the repository. That
 * directory is this run's own, and the run removes it on the way out.
 *
 * - The fixture plugins (tests/fixture-trees.mjs) are two whole plugins, one that meets
 *   every rule and one with structural problems. `fixtureDir` writes them on first use.
 *   One small committed tree remains under tests/fixtures/, a folder with skills and no
 *   manifest; it holds nothing that looks like a credential, an invisible character, an
 *   encoded blob or an undisclosed host, because the plugin under test scans its own
 *   folder too, and a committed tree has to pass the checks it ships.
 * - The generated trees hold the content patterns, one per test.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { FIXTURE_TREES } from './fixture-trees.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cli = path.join(projectRoot, 'scripts', 'preflight.mjs');
export const fixturesDir = path.join(projectRoot, 'tests', 'fixtures');

/** Run the checker and return `{ status, stdout, stderr, json }`. */
export function runChecker(args, options = {}) {
  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...options.env },
    });
  } catch (error) {
    status = error.status ?? 1;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }
  let json = null;
  if (args.includes('--json') && stdout.trim() !== '') {
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
  }
  return { status, stdout, stderr, json };
}

/**
 * The folder of a fixture plugin. The two plugins in fixture-trees.mjs are written into this
 * run's temporary directory the first time they are asked for; any other name is a folder
 * committed under tests/fixtures/.
 */
export function fixtureDir(name) {
  const tree = FIXTURE_TREES[name];
  if (!tree) return path.join(fixturesDir, name);
  const dir = path.join(generatedRoot, 'fixture-plugins', name);
  if (!fs.existsSync(dir)) {
    for (const [relative, content] of Object.entries(tree)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return dir;
}

/** Check a fixture plugin, treating it as its own repository. */
export function checkFixture(name, extraArgs = []) {
  const dir = fixtureDir(name);
  return runChecker([dir, '--repo', dir, '--worktree', '--json', ...extraArgs]);
}

/** The rule ids in a report, as a Set. */
export function ruleIds(report) {
  return new Set((report?.findings ?? []).map((finding) => finding.rule));
}

/** The findings of one rule. */
export function findingsFor(report, rule) {
  return (report?.findings ?? []).filter((finding) => finding.rule === rule);
}

/**
 * One fresh directory per test run, under the system temporary directory. A fixed path
 * would collide with a second run and would carry state from the last one.
 *
 * The run removes this directory on the way out. It is the only thing the tests delete,
 * and it is theirs: everything in it was written by this process a moment ago. A run that
 * dies without running the hook leaves the folder behind for the system to clear.
 */
const generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-preflight-'));

function removeGeneratedRoot() {
  try {
    fs.rmSync(generatedRoot, { recursive: true, force: true });
  } catch {
    /* a fixture still open on Windows is not worth failing a run over */
  }
}

process.on('exit', removeGeneratedRoot);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    removeGeneratedRoot();
    process.exit(130);
  });
}

/**
 * Write a generated fixture and return its path. Files are overwritten in place on every
 * run; nothing is ever removed.
 *
 * `files` maps a relative path to a string, or to `{ buffer }` for bytes, or to
 * `{ repeat: { text, times } }` for a file large enough to trip a size rule.
 */
export function writeGeneratedFixture(name, files) {
  const root = path.join(generatedRoot, name);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (typeof content === 'string') fs.writeFileSync(target, content);
    else if (content.buffer) fs.writeFileSync(target, content.buffer);
    else if (content.repeat) fs.writeFileSync(target, content.repeat.text.repeat(content.repeat.times));
  }
  return root;
}

/** Run the checker against a generated fixture. */
export function checkGenerated(name, extraArgs = [], options = {}) {
  const dir = path.join(generatedRoot, name);
  return runChecker([dir, '--repo', dir, '--json', ...extraArgs], options);
}

/** Run the checker against one folder inside a generated fixture. */
export function checkGeneratedDir(dir, extraArgs = [], options = {}) {
  return runChecker([dir, '--json', ...extraArgs], options);
}

/**
 * Put a generated fixture under Git, without a commit and without touching any global
 * configuration: `git init` plus `git add` is enough, because `git ls-files` reads the
 * index. Returns false when Git is not available.
 */
export function gitIndexFixture(name, paths = []) {
  const dir = path.join(generatedRoot, name);
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    // A machine with no global Git identity (a CI runner) cannot commit without one, so the
    // throwaway repository carries its own.
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    // Everything by default; name paths to leave something out of the index on purpose.
    execFileSync('git', ['add', ...(paths.length > 0 ? ['--', ...paths] : ['-A'])],
      { cwd: dir, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Add one more file to an already built fixture. */
export function addFile(name, relative, content) {
  const target = path.join(generatedRoot, name, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/**
 * Drop a path from a generated fixture's Git index, so it counts as untracked again.
 * This touches the index of a throwaway repository in the temporary directory and no
 * file on disk.
 */
export function gitUntrack(name, relative) {
  const dir = path.join(generatedRoot, name);
  try {
    execFileSync('git', ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', relative],
      { cwd: dir, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A hand-made scan object, for the rules whose subject cannot exist on this file system:
 * Windows refuses to create a file called `con.md` or two names that differ only by case.
 */
export function stubScan(paths) {
  const files = paths.map((repoRel) => ({
    repoRel,
    pluginRel: repoRel,
    abs: path.join('C:', 'stub', repoRel),
    size: 1,
    missing: false,
    kind: 'other',
    ext: path.extname(repoRel).toLowerCase(),
    name: path.posix.basename(repoRel),
    link: false,
    submodule: false,
    mode: null,
  }));
  return {
    files,
    pluginFiles: files,
    pluginWorkingFiles: files,
    diskPluginFiles: files,
    ignoredPluginFiles: [],
    untrackedPluginFiles: [],
    unreadFiles: [],
    noCommittedPluginFiles: false,
    viewsDisk: true,
    isGit: false,
    pluginRel: '',
    target: 'C:/stub',
    repoRoot: 'C:/stub',
    pluginDir: 'C:/stub',
    pluginName: 'stub',
    totalBytes: files.length,
    pluginBytes: files.length,
    byRepoRel: new Map(files.map((entry) => [entry.repoRel, entry])),
    isTracked: () => false,
    fileAt: (repoRel) => files.find((entry) => entry.repoRel === repoRel) ?? null,
    readText: () => null,
    readBytes: () => null,
    textAt: () => null,
    textInPlugin: () => null,
  };
}

/** A minimal valid plugin, as a map of relative path to content. */
export function minimalPlugin(overrides = {}) {
  return {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'generated-tools',
      version: '1.0.0',
      description: 'A plugin generated by the test suite.',
      author: { name: 'Example Author' },
      license: 'MIT',
    }, null, 2),
    LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Author\n',
    'README.md': `# generated-tools\n\n${'A sentence that makes the README long enough to pass the word count rule. '.repeat(8)}\n`,
    ...overrides,
  };
}

export { generatedRoot };