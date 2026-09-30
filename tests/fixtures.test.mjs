/**
 * Integration tests over the fixture plugins: one that meets every rule, one that holds
 * structural problems only, and a folder with skills and no manifest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkFixture, ruleIds, findingsFor } from './helpers.mjs';

/**
 * A note about the place the tree happens to sit in, not about the plugin: a checkout that
 * is not itself inside a Git repository, and has one somewhere above it that Git will not
 * read, gets this. It is true, and it is not a finding about the fixture.
 */
const ENVIRONMENT_NOTES = new Set(['layout/repository-not-readable']);

test('a plugin that meets every rule produces no findings about the plugin', () => {
  const { json, status } = checkFixture('clean-plugin');
  const aboutThePlugin = json.findings.filter((finding) => !ENVIRONMENT_NOTES.has(finding.rule));
  assert.deepEqual(aboutThePlugin, [], JSON.stringify(json.findings, null, 2));
  assert.equal(status, 0);
});

test('the clean fixture is read as its own repository', () => {
  const { json } = checkFixture('clean-plugin');
  assert.equal(json.target.pluginPathInRepository, '.');
  assert.equal(json.summary.byResult.block, 0);
  assert.equal(json.summary.byResult.stop, 0);
  assert.equal(json.summary.byResult.hold, 0);
});

test('the broken fixture reports the manifest problems', () => {
  const { json } = checkFixture('broken-plugin');
  const rules = ruleIds(json);
  for (const rule of [
    'manifest/name-pattern',
    'manifest/missing-metadata',
    'manifest/author-shape',
    'manifest/component-path-outside',
  ]) {
    assert.equal(rules.has(rule), true, `expected ${rule}`);
  }
  assert.equal(json.findings.find((finding) => finding.rule === 'manifest/component-path-outside').result, 'block');
  assert.equal(json.findings.find((finding) => finding.rule === 'manifest/name-pattern').result, 'warning');
});

test('the broken fixture reports the hooks problems once each', () => {
  const { json } = checkFixture('broken-plugin');
  const hooks = findingsFor(json, 'components/hooks-json-invalid');
  assert.equal(hooks.length, 2, JSON.stringify(hooks, null, 2));
  assert.equal(hooks.every((finding) => finding.result === 'block'), true);
  assert.equal(hooks.some((finding) => finding.detail.includes('BeforeToolUse')), true);
  assert.equal(hooks.some((finding) => finding.detail.includes('webhook')), true);
});

test('the broken fixture reports front matter and spelling problems', () => {
  const { json } = checkFixture('broken-plugin');
  assert.equal(findingsFor(json, 'components/frontmatter-broken').length, 1);
  assert.equal(findingsFor(json, 'components/frontmatter-missing').length, 1);

  const spelling = findingsFor(json, 'components/folder-spelling');
  assert.equal(spelling.length, 1, 'the misspelled folder is reported once, not per file');
  assert.equal(spelling[0].path, 'Skills/');
});

test('a script a hook runs is held only where the table holds it', () => {
  // The table gives this hold "when the plugin folder is a subfolder of the repository".
  // The fixture sits at the root of its own repository, so its non-shell script
  // is read like any other file and is not held.
  const { json } = checkFixture('broken-plugin');
  assert.equal(findingsFor(json, 'runtime/script-follow').length, 0, JSON.stringify(json.findings, null, 2));
  assert.equal(findingsFor(json, 'runtime/launcher-unpinned').length, 0, 'a plain shell script is not a launcher');
});

test('the broken fixture reports the MCP server in the file that declares it', () => {
  const { json } = checkFixture('broken-plugin');
  const servers = findingsFor(json, 'runtime/mcp-server-shape');
  assert.equal(servers.length, 1);
  assert.equal(servers[0].path, '.claude-plugin/plugin.json');
  assert.match(servers[0].detail, /not https or wss/);
});

test('a folder with no manifest but a skill is a note, not a block', () => {
  const { json } = checkFixture('skills-only');
  const rules = ruleIds(json);
  assert.equal(rules.has('manifest/skills-only'), true);
  assert.equal(rules.has('manifest/missing'), false);
  assert.equal(json.summary.byResult.stop, 0);
  assert.equal(findingsFor(json, 'manifest/skills-only')[0].result, 'note');
});

test('every finding names a rule, a result class and documentation', () => {
  for (const fixture of ['clean-plugin', 'broken-plugin', 'skills-only']) {
    const { json } = checkFixture(fixture);
    for (const finding of json.findings) {
      assert.equal(typeof finding.rule, 'string', fixture);
      assert.equal(typeof finding.resultLabel, 'string', fixture);
      assert.equal(typeof finding.sourceLabel, 'string', fixture);
      if (finding.doc !== null) assert.match(finding.doc, /^https:\/\//, `${fixture}: ${finding.rule}`);
      assert.equal(typeof finding.what, 'string', fixture);
      assert.ok(finding.detail !== undefined, `${fixture}: ${finding.rule} has no detail`);
    }
  }
});

test('a report names the ruleset it is based on', () => {
  const { json } = checkFixture('clean-plugin');
  assert.equal(json.ruleset.version, '2026-09-30');
  assert.equal(json.ruleset.source, 'https://claude.com/docs/plugins/pre-submission-checklist');
  assert.equal(json.tool.name, 'directory-preflight');
});