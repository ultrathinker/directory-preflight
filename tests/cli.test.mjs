/**
 * Tests for the command line itself: how it is called, what it prints, and what it exits with.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  runChecker, checkFixture, checkGenerated, writeGeneratedFixture, minimalPlugin,
  fixtureDir, projectRoot, generatedRoot, findingsFor,
} from './helpers.mjs';

test('--help prints the usage and exits 0', () => {
  const { status, stdout } = runChecker(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /Usage/);
  assert.match(stdout, /--worktree/);
  assert.match(stdout, /Exit codes/);
});

test('--version prints the version and exits 0', () => {
  const { status, stdout } = runChecker(['--version']);
  assert.equal(status, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('an unknown option stops with an error, not a stack trace', () => {
  const { status, stderr } = runChecker(['--nonsense']);
  assert.equal(status, 2);
  assert.match(stderr, /Unknown option/);
});

test('--max-findings without a value is refused', () => {
  const { status, stderr } = runChecker(['--max-findings']);
  assert.equal(status, 2);
  assert.match(stderr, /needs a value/);
});

test('a folder that is not a plugin stops with the folder contents', () => {
  writeGeneratedFixture('not-a-plugin', { 'notes.txt': 'hello' });
  const dir = path.join(generatedRoot, 'not-a-plugin');
  const { status, stderr } = runChecker([dir, '--json']);
  assert.equal(status, 2);
  assert.match(stderr, /No plugin found/);
  assert.match(stderr, /notes\.txt/);
});

test('a folder holding several plugins says so and names them', () => {
  writeGeneratedFixture('many-plugins', {
    'alpha/.claude-plugin/plugin.json': '{"name":"alpha"}',
    'beta/.claude-plugin/plugin.json': '{"name":"beta"}',
  });
  const dir = path.join(generatedRoot, 'many-plugins');
  const { status, stderr } = runChecker([dir]);
  assert.equal(status, 2);
  assert.match(stderr, /one plugin at a time/);
  assert.match(stderr, /alpha, beta/);
});

test('a blocking finding exits 1 and a clean plugin exits 0', () => {
  assert.equal(checkFixture('broken-plugin').status, 1);
  assert.equal(checkFixture('clean-plugin').status, 0);
});

test('--quiet keeps only what blocks a submission', () => {
  const dir = fixtureDir('broken-plugin');
  const { stdout } = runChecker([dir, '--repo', dir, '--worktree', '--quiet', '--no-judgment']);
  assert.match(stdout, /BLOCKS/);
  assert.equal(stdout.includes('WARNING'), false);
  assert.equal(stdout.includes('HELD FOR A REVIEWER'), false);
});

test('the text report names the ruleset and both folders', () => {
  const { stdout } = checkFixtureText('clean-plugin');
  assert.match(stdout, /Ruleset 2026-09-30/);
  assert.match(stdout, /pre-submission-checklist/);
  assert.match(stdout, /Plugin folder/);
  assert.match(stdout, /Read from/);
});

test('the report says what it cannot decide', () => {
  const { stdout } = checkFixtureText('clean-plugin');
  assert.match(stdout, /WHAT THIS CHECKER CANNOT DECIDE/);
  assert.match(stdout, /security scan/);

  const quiet = runChecker([fixtureDir('clean-plugin'), '--worktree', '--no-judgment']).stdout;
  assert.equal(quiet.includes('WHAT THIS CHECKER CANNOT DECIDE'), false);
});

test('--md writes a Markdown report', () => {
  const dir = fixtureDir('broken-plugin');
  const { stdout } = runChecker([dir, '--repo', dir, '--worktree', '--md']);
  assert.match(stdout, /^# Preflight report: /);
  assert.match(stdout, /^## Blocks/m);
  assert.match(stdout, /Source: .*\n?.*https:\/\//);
  assert.match(stdout, /\[documentation\]\(https:\/\//);
});

test('--max-findings caps how many findings one rule prints', () => {
  writeGeneratedFixture('capped', {
    ...minimalPlugin(),
    '.DS_Store': 'a',
    'Thumbs.db': 'b',
    'desktop.ini': 'c',
  });
  const roomy = checkGenerated('capped');
  assert.equal(findingsFor(roomy.json, 'layout/os-junk-file').length, 3);

  const capped = checkGenerated('capped', ['--max-findings', '1']);
  assert.equal(findingsFor(capped.json, 'layout/os-junk-file').length, 1);
  assert.equal(capped.json.suppressed.some((item) => item.rule === 'layout/os-junk-file' && item.hidden === 2), true);
});

test('the JSON report has the shape another tool needs', () => {
  const { json } = checkFixture('broken-plugin');
  assert.deepEqual(Object.keys(json).sort(),
    ['cannotDecide', 'findings', 'ruleset', 'summary', 'suppressed', 'target', 'tool']);
  assert.equal(json.ruleset.alsoFrom.length >= 1, true);
  assert.equal(typeof json.target.filesRead, 'number');
  assert.equal(typeof json.summary.blockingConfirmed, 'number');
  assert.equal(Array.isArray(json.cannotDecide), true);
  for (const finding of json.findings) {
    assert.equal(typeof finding.rule, 'string');
    assert.equal(typeof finding.result, 'string');
    assert.equal(typeof finding.heuristic, 'boolean');
  }
});

test('the CLI reports on this repository, and this repository passes', () => {
  const { status, json } = runChecker([projectRoot, '--json', '--no-judgment']);
  assert.equal(json.tool.name, 'directory-preflight');
  assert.equal(['commit', 'index', 'worktree', 'directory'].includes(json.target.source), true);
  assert.equal(status, 0, 'the plugin passes its own check');
});

/** The plain-text report for a fixture, with everything the checker prints. */
function checkFixtureText(name) {
  const dir = fixtureDir(name);
  return runChecker([dir, '--repo', dir, '--worktree']);
}
// ------------------------------------------------------------------------- thresholds

function writeThreeDataFiles(name) {
  writeGeneratedFixture(name, {
    ...minimalPlugin(),
    'data/a.txt': 'a',
    'data/b.txt': 'b',
    'data/c.txt': 'c',
  });
}

test('--limit overrides one threshold for that run only', () => {
  writeThreeDataFiles('limit-flag');
  assert.equal(findingsFor(checkGenerated('limit-flag').json, 'files/too-many').length, 0);

  const { json } = checkGenerated('limit-flag', ['--limit', 'maxPluginFiles=3']);
  assert.equal(findingsFor(json, 'files/too-many').length, 1);

  const twice = checkGenerated('limit-flag', ['--limit', 'maxPluginFiles=3', '--limit', 'maxFindingsPerRule=1']);
  assert.equal(findingsFor(twice.json, 'files/too-many').length, 1);
});

test('--limit refuses a name it does not know, a missing number and a negative one', () => {
  for (const value of ['nonsense=3', 'maxPluginFiles', 'maxPluginFiles=', 'maxPluginFiles=many', 'maxPluginFiles=-1']) {
    const { status, stderr } = runChecker(['--limit', value]);
    assert.equal(status, 2, value);
    assert.match(stderr, /--limit needs name=number/, value);
  }
  const { status, stderr } = runChecker(['--limit']);
  assert.equal(status, 2);
  assert.match(stderr, /needs a value/);
});

test('the limits come from the command line, not from the environment', () => {
  writeThreeDataFiles('limit-environment');
  const { json } = checkGenerated('limit-environment', [], { env: { PREFLIGHT_LIMITS: '{"maxPluginFiles":3}' } });
  assert.equal(findingsFor(json, 'files/too-many').length, 0);
});
