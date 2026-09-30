/**
 * Tests for the ruleset itself: that it is well formed, that the catalogue matches it, and
 * that the promises the README makes about it hold.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { RULES, JUDGMENT_ITEMS } from '../scripts/rules/index.mjs';
import { SECTIONS, RESULTS, RULESET, RESULT_ORDER } from '../scripts/lib/registry.mjs';
import { projectRoot } from './helpers.mjs';

test('every rule carries what the report needs', () => {
  for (const rule of RULES) {
    assert.equal(typeof rule.id, 'string', 'a rule has no id');
    assert.equal(SECTIONS[rule.section] !== undefined, true, `${rule.id}: unknown section`);
    assert.equal(RESULTS[rule.result] !== undefined, true, `${rule.id}: unknown result`);
    assert.equal(typeof rule.what, 'string', `${rule.id}: no explanation`);
    assert.equal(typeof rule.run, 'function', `${rule.id}: no check`);
    if (rule.doc === null) {
      assert.equal(rule.source, 'tool', `${rule.id}: only this tool's own advice may skip the link`);
    } else {
      assert.match(rule.doc, /^https:\/\//, `${rule.id}: malformed documentation link`);
    }
    assert.equal(typeof rule.heuristic, 'boolean', `${rule.id}: no heuristic flag`);
  }
});

test('rule ids are unique and stable in shape', () => {
  const seen = new Set();
  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z]+\/[a-z0-9-]+$/, rule.id);
    assert.equal(seen.has(rule.id), false, `duplicate rule id ${rule.id}`);
    seen.add(rule.id);
  }
});

test('every checklist section has rules, and the security section is all heuristics', () => {
  for (const section of Object.keys(SECTIONS)) {
    const rules = RULES.filter((rule) => rule.section === section);
    assert.ok(rules.length > 0, `section ${section} has no rules`);
    if (section === 'security') {
      assert.equal(rules.every((rule) => rule.heuristic), true, 'a security rule is not marked as a heuristic');
    }
  }
});

test('a rule never reports a result class outside the portal vocabulary', () => {
  for (const rule of RULES) {
    assert.equal(RESULT_ORDER.includes(rule.result), true, rule.id);
  }
});

test('the catalogue on disk matches the ruleset', () => {
  const generated = execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'rules-doc.mjs')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const onDisk = fs.readFileSync(path.join(projectRoot, 'docs', 'rules.md'), 'utf8');
  assert.equal(onDisk.replace(/\r\n/g, '\n'), generated.replace(/\r\n/g, '\n'),
    'docs/rules.md is out of date: run node scripts/rules-doc.mjs > docs/rules.md');
});

test('the report says which ruleset it is based on, and the catalogue says the same', () => {
  const onDisk = fs.readFileSync(path.join(projectRoot, 'docs', 'rules.md'), 'utf8');
  assert.equal(onDisk.includes(`Ruleset version: **${RULESET.version}**`), true);
  assert.equal(onDisk.includes(RULESET.source), true);
});

test('the decisions the checker cannot make are listed, not hidden', () => {
  assert.ok(JUDGMENT_ITEMS.length >= 5);
  for (const item of JUDGMENT_ITEMS) {
    assert.equal(typeof item.title, 'string', item.id);
    assert.ok(item.detail.length > 20, item.id);
  }
});

test('nothing in the ruleset reads memory, transcripts or chat history', () => {
  // The directory forbids it, and so does the README. Guard the promise with a test.
  const sources = fs.readdirSync(path.join(projectRoot, 'scripts', 'rules'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => fs.readFileSync(path.join(projectRoot, 'scripts', 'rules', name), 'utf8'))
    .join('\n');
  for (const forbidden of ['\\.claude/projects', 'history.jsonl', 'transcript', 'TODO.md']) {
    assert.equal(new RegExp(forbidden).test(sources), false, `the rules mention ${forbidden}`);
  }
});