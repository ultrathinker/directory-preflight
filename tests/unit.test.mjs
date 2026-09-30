/**
 * Unit tests for the pure helpers: the parts of the checker that decide what a finding is,
 * and that a fixture tree would only be able to exercise in one direction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countWords, stripFencedCode, windowsNameProblem, caseKey, nameHazards, humanSize,
  looksBinary, markdownCodeSpans, toPosix,
} from '../scripts/lib/util.mjs';
import { parseFrontMatter, describeFrontMatter } from '../scripts/lib/frontmatter.mjs';
import { findLaunchers, isPinned, tokenize, findInstalls, looksLikePackageSpec } from '../scripts/lib/launchers.mjs';
import { findCredentials, ENV_CREDENTIAL_RE, findEnvCredential, redact } from '../scripts/lib/secrets.mjs';
import { parseGitAttributes } from '../scripts/rules/layout.mjs';
import { findEncodedBlob } from '../scripts/rules/security.mjs';
import { HOOK_EVENTS, HOOK_TYPES, iterateHandlers } from '../scripts/lib/hooks.mjs';

test('countWords ignores fenced code blocks', () => {
  const markdown = 'one two three\n\n```sh\nnpm install a b c d e f\n```\n\nfour five\n';
  assert.equal(countWords(markdown), 5);
});

test('countWords counts a hyphenated word once', () => {
  assert.equal(countWords('a well-known pre-submission checklist'), 4);
});

test('stripFencedCode keeps the text around a fence', () => {
  assert.equal(stripFencedCode('before\n~~~\ninside\n~~~\nafter').trim(), 'before\nafter');
});

test('windowsNameProblem accepts ordinary names', () => {
  assert.equal(windowsNameProblem('SKILL.md'), null);
  assert.equal(windowsNameProblem('release-notes'), null);
});

test('windowsNameProblem rejects what Windows and macOS reject', () => {
  assert.match(windowsNameProblem('notes:1.md'), /character Windows does not allow/);
  assert.match(windowsNameProblem('notes.'), /ends with a dot/);
  assert.match(windowsNameProblem('notes '), /ends with a dot or a space/);
  assert.match(windowsNameProblem('con.md'), /reserved device name/);
  assert.match(windowsNameProblem('LPT1.txt'), /reserved device name/);
});

test('caseKey folds names the way a case-insensitive file system does', () => {
  assert.equal(caseKey('README.md'), caseKey('readme.MD'));
});

test('nameHazards finds invisible characters and mixed scripts', () => {
  // Built from code points so this test file holds no invisible characters of its own:
  // the plugin under test scans its own source too.
  const zeroWidthSpace = String.fromCharCode(0x200b);
  assert.equal(nameHazards(`dep${zeroWidthSpace}loy`).some((hazard) => hazard.kind === 'invisible'), true);

  const cyrillicIe = String.fromCharCode(0x435);
  assert.equal(nameHazards(`d${cyrillicIe}ploy`).some((hazard) => hazard.kind === 'look-alike'), true);

  const han = String.fromCharCode(0x4e2d, 0x6587);
  assert.equal(nameHazards(`deploy ${han}`).some((hazard) => hazard.kind === 'mixed-script'), true);

  assert.deepEqual(nameHazards('deploy-tools'), []);
});

test('humanSize stays readable', () => {
  assert.equal(humanSize(512), '512 B');
  assert.equal(humanSize(2048), '2.0 KiB');
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MiB');
});

test('looksBinary trusts a NUL byte and nothing else', () => {
  assert.equal(looksBinary(Buffer.from('plain text')), false);
  assert.equal(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), true);
});

test('markdownCodeSpans returns fenced and inline code only', () => {
  const spans = markdownCodeSpans('prose `inline` here\n\n```\nfenced\n```\n');
  assert.deepEqual(spans, ['fenced\n', 'inline']);
});

test('toPosix normalises separators', () => {
  assert.equal(toPosix('a\\b/c'), 'a/b/c');
});

test('parseFrontMatter reads a normal block', () => {
  const parsed = parseFrontMatter('---\nname: greet\ndescription: Say hello.\n---\n\nBody\n');
  assert.equal(parsed.error, null);
  assert.equal(describeFrontMatter(parsed).state, 'ok');
});

test('parseFrontMatter rejects a description written as a list', () => {
  const inline = parseFrontMatter('---\ndescription: [one, two]\n---\n');
  assert.equal(describeFrontMatter(inline).state, 'list');
  const block = parseFrontMatter('---\ndescription:\n  - one\n  - two\n---\n');
  assert.equal(describeFrontMatter(block).state, 'list');
});

test('parseFrontMatter accepts a block scalar description', () => {
  const parsed = parseFrontMatter('---\ndescription: |\n  Two lines\n  of text.\n---\n');
  assert.equal(describeFrontMatter(parsed).state, 'ok');
});

test('parseFrontMatter accepts a description continued on the next line', () => {
  const parsed = parseFrontMatter('---\ndescription:\n  Text that starts on the next line.\n---\n');
  assert.equal(parseFrontMatter('---\ndescription:\n  Text that starts on the next line.\n---\n').data.description.value,
    'Text that starts on the next line.');
  assert.equal(describeFrontMatter(parsed).state, 'ok');
});

test('parseFrontMatter reports the line that breaks it', () => {
  assert.match(parseFrontMatter('---\nthis line has no colon\n---\n').error, /line 2/);
  assert.match(parseFrontMatter('---\nname: greet\n\tdescription: broken\n---\n').error, /tab/);
  assert.match(parseFrontMatter('---\ndescription: "unclosed\n---\n').error, /never closes/);
  assert.match(parseFrontMatter('---\ndescription: ok\n').error, /never closed/);
});

test('parseFrontMatter reports an absent block instead of guessing', () => {
  assert.equal(describeFrontMatter(parseFrontMatter('# Title\n')).state, 'absent');
  assert.equal(describeFrontMatter(parseFrontMatter('---\nname: greet\n---\n')).state, 'no-description');
});

test('isPinned accepts exact versions only', () => {
  assert.equal(isPinned('cowsay@1.2.3'), true);
  assert.equal(isPinned('@scope/tool@0.4.0-beta.1'), true);
  assert.equal(isPinned('ruff==0.5.1'), true);
  assert.equal(isPinned('cowsay'), false);
  assert.equal(isPinned('cowsay@latest'), false);
  assert.equal(isPinned('cowsay@^1.2.3'), false);
  assert.equal(isPinned('@scope/tool'), false);
  assert.equal(isPinned('ruff>=0.5'), false);
});

test('tokenize stops at a shell operator and respects quotes', () => {
  assert.deepEqual(tokenize(' pkg@1.0.0 --flag "two words" && rm'), ['pkg@1.0.0', '--flag', 'two words']);
});

test('findLaunchers reads the package a launcher runs', () => {
  const [unpinned] = findLaunchers('npx -y cowsay@latest hello');
  assert.equal(unpinned.launcher, 'npx');
  assert.equal(unpinned.spec, 'cowsay@latest');
  assert.equal(unpinned.pinned, false);

  const [pinned] = findLaunchers('npx cowsay@1.2.3 hello');
  assert.equal(pinned.pinned, true);

  const [byFlag] = findLaunchers('npx --package=@scope/tool@2.0.0 run-it');
  assert.equal(byFlag.spec, '@scope/tool@2.0.0');
  assert.equal(byFlag.pinned, true);

  const [uv] = findLaunchers('uvx ruff==0.5.1 check');
  assert.equal(uv.launcher, 'uvx');
  assert.equal(uv.pinned, true);
});

test('uv run needs --locked or --frozen', () => {
  const [unlocked] = findLaunchers('uv run python tool.py');
  assert.equal(unlocked.pinned, false);
  assert.match(unlocked.reason, /--locked or --frozen/);
  const [locked] = findLaunchers('uv run --locked python tool.py');
  assert.equal(locked.pinned, true);
});

test('findLaunchers finds several invocations in one file', () => {
  const found = findLaunchers('first: npx a@1.0.0\nsecond: bunx b\n');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((item) => item.launcher), ['npx', 'bunx']);
});

test('a launcher named in prose is not an invocation', () => {
  const prose = 'These block a submission: npx, bunx, pnpm dlx, yarn dlx, uvx, pipx run.';
  assert.deepEqual(findLaunchers(prose), []);
  assert.deepEqual(findLaunchers('npx'), []);
  // A launcher followed by a word that could be a package still reads as an invocation.
  // Markdown prose is not scanned at all: only the code spans in it are.
  assert.equal(findLaunchers('read about npx later').length, 1);
});

test('a launcher inside a Markdown code span is an invocation', () => {
  const found = findLaunchers('Run `npx prettier --check .` before you commit.');
  assert.equal(found.length, 1);
  assert.equal(found[0].spec, 'prettier');
});

test('looksLikePackageSpec separates a package from punctuation', () => {
  for (const token of ['cowsay', '@scope/tool@2.0.0', 'ruff==0.5.1', 'pkg@^1.2.3']) {
    assert.equal(looksLikePackageSpec(token), true, token);
  }
  for (const token of [',', '', '`uvx`,', '.', '--flag']) {
    assert.equal(looksLikePackageSpec(token), false, token);
  }
});

test('findInstalls recognises package installs', () => {
  assert.deepEqual(findInstalls('run npm install --omit=dev'), ['npm install']);
  assert.deepEqual(findInstalls('pip3 install requests'), ['pip3 install']);
  assert.deepEqual(findInstalls('nothing to see here'), []);
});

test('findCredentials recognises a credential shape', () => {
  const aws = ['AKIA', 'Q7ZL2M9XK', '4NPD8VT'].join('');
  const hits = findCredentials(`key = ${aws}`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].heuristic, false);
  assert.equal(hits[0].name, 'AWS access key ID');
});

test('findCredentials leaves the example keys from the documentation alone', () => {
  // AWS prints this key in its own documentation. Flagging it would teach the wrong thing.
  const example = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
  assert.deepEqual(findCredentials(`aws_access_key_id = ${example}`), []);
});

test('findCredentials recognises a private key block', () => {
  const header = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
  const hits = findCredentials(header + ' MIIE');
  assert.equal(hits.some((hit) => hit.name === 'private key block'), true);
});

test('findCredentials skips obvious placeholders', () => {
  for (const value of ['YOUR_API_KEY_HERE', 'changeme', '${user_config.token}', '<your-token>']) {
    assert.equal(findCredentials(`api_key: "${value}"`).length, 0, value);
  }
});

test('findCredentials flags a long assigned value as a heuristic', () => {
  const hits = findCredentials('client_secret: "' + '9f2a7c1e4b8d3f6a0c5e2b9d' + '"');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].heuristic, true);
});

test('findCredentials does not read an expression as a value', () => {
  for (const line of [
    'const TOKEN = process.env.DISCORD_BOT_TOKEN;',
    'token: os.environ["GITHUB_TOKEN"]',
    'api_key = getenv("SERVICE_KEY")',
  ]) {
    assert.deepEqual(findCredentials(line), [], line);
  }
});

test('findCredentials reports a short but real looking value', () => {
  const hits = findCredentials('api_key = "' + 'q8Zk2LmN4pXv7RtY' + '"');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].heuristic, true);
});

test('the environment credential check finds every variable, not every other one', () => {
  const line = 'echo $GITHUB_TOKEN and ${ANTHROPIC_API_KEY}';
  assert.deepEqual(findEnvCredential(line), '$GITHUB_TOKEN');
  assert.deepEqual(findEnvCredential(line.slice(line.indexOf('and'))), '${ANTHROPIC_API_KEY}');
  assert.equal(findEnvCredential('echo $CLAUDE_PLUGIN_OPTION_TOKEN'), null, 'the value Claude Code exports is the fix, not the problem');
  // A global regex carries lastIndex between calls, so a loop over lines skipped every
  // second match. Two identical calls have to give the same answer.
  assert.equal(ENV_CREDENTIAL_RE.global, false);
  for (let i = 0; i < 4; i += 1) assert.equal(findEnvCredential(line), '$GITHUB_TOKEN');
});

test('redact keeps a credential out of the report', () => {
  const value = ['AKIA', 'Q7ZL2M9XK', '4NPD8VT'].join('');
  const masked = redact(value);
  assert.equal(masked.includes(value), false);
  assert.equal(masked.startsWith('AKIA'), true);
});

test('parseGitAttributes reads patterns and attributes', () => {
  const records = parseGitAttributes('# comment\n*.txt text eol=lf\n*.bin filter=lfs diff=lfs\n\n[attr]x -text\n');
  assert.equal(records.length, 3);
  assert.deepEqual(records[1].attributes, ['filter=lfs', 'diff=lfs']);
  assert.equal(records[2].macro, true);
});

test('findEncodedBlob decodes a base64 run but ignores an integrity hash', () => {
  const readable = Buffer.from('A long and perfectly readable sentence that a scanner should decode. '.repeat(3)).toString('base64');
  assert.equal(findEncodedBlob(`const blob = "${readable}"`), readable.length);
  assert.equal(findEncodedBlob(`"integrity": "sha512-${readable}"`), null);
  assert.equal(findEncodedBlob('const x = "short";'), null);
});

test('findEncodedBlob spots a long escape run', () => {
  assert.notEqual(findEncodedBlob(`const s = "${'\\x41'.repeat(80)}";`), null);
});

test('the hook event list matches the hooks reference', () => {
  assert.equal(HOOK_EVENTS.length, 33);
  assert.equal(HOOK_EVENTS.includes('PreToolUse'), true);
  assert.equal(HOOK_EVENTS.includes('BeforeToolUse'), false);
  assert.equal(HOOK_TYPES.has('mcp_tool'), true);
  assert.equal(HOOK_TYPES.has('webhook'), false);
});

test('iterateHandlers walks a hooks object', () => {
  const data = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } };
  const found = iterateHandlers(data, 'hooks/hooks.json');
  assert.equal(found.length, 1);
  assert.equal(found[0].event, 'PreToolUse');
  assert.equal(found[0].handler.command, 'x');
});