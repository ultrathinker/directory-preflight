/**
 * The `${CLAUDE_PLUGIN_ROOT}` path row, as a table.
 *
 * A confirmed Block on a valid command is the worst thing this rule can do, and it came
 * from reading a command one reproduction at a time: a Docker image, a redirection, a
 * sentence inside quotes, the variables the manifest reference documents, a README the
 * project and the plugin both have, and an option's value were each read as a path. The
 * table below is the whole family at once — the command shapes that are not paths, and the
 * ones that are — so a change to the rule has to answer to all of them rather than to the
 * last reproduction someone happened to try.
 *
 * Every case runs in a plugin that sits in a repository subfolder, where the row Blocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  checkGeneratedDir, writeGeneratedFixture, minimalPlugin, gitIndexFixture, generatedRoot,
} from './helpers.mjs';

const NESTED = 'plugins/demo';

/** A hook command, written the way a plugin writes one. */
const hook = (command, extra = {}) => JSON.stringify({
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command, ...extra }] }] },
}, null, 2);

/** An MCP server, local or remote. */
const server = (command, args) => JSON.stringify({ mcpServers: { local: { command, args } } }, null, 2);

/** One plugin per case, under a subfolder, and the findings the path rule gives it. */
function pathFindings(name, files) {
  const withPrefix = (extra) => Object.fromEntries(
    Object.entries({ ...minimalPlugin(), ...extra })
      .map(([rel, content]) => [path.posix.join(NESTED, rel), content]),
  );
  writeGeneratedFixture(name, withPrefix(files));
  gitIndexFixture(name);
  const { json, status } = checkGeneratedDir(path.join(generatedRoot, name, ...NESTED.split('/')));
  return {
    status,
    confirmed: json.findings.filter((finding) => finding.rule === 'runtime/plugin-root-path'),
    atRoot: json.findings.filter((finding) => finding.rule === 'runtime/plugin-root-path-at-root'),
    inlineHold: json.findings.filter((finding) => finding.rule === 'runtime/mcp-server-command'),
  };
}

// --------------------------------------------------------------- not paths: no Block

const NOT_PATHS = [
  // A container image is not a path. GitHub documents exactly this command.
  ['a docker image', { '.mcp.json': server('docker', ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server']) }],
  ['a docker image with a registry port', { '.mcp.json': server('docker', ['run', 'registry.example.com:5000/team/tool']) }],
  ['a docker image with a tag', { '.mcp.json': server('docker', ['run', 'acme/server:1.0']) }],
  ['a docker image, unqualified', { '.mcp.json': server('docker', ['run', 'hashicorp/terraform-mcp-server']) }],
  // Redirections, in the forms a hook writes them.
  ['a redirect to the null device', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh 2>/dev/null || true') }],
  ['stderr folded into stdout', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh >/dev/null 2>&1') }],
  ['a redirect written with a space', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh > /dev/null') }],
  ['a redirect to a log file', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh >> logs/run.txt') }],
  // The target is rooted, so only the redirection handling keeps it out of the report.
  ['a redirect to a relative path', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh > ./logs/out.txt') }],
  ['an input redirect from a relative path', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js < ./data/in.json') }],
  // Prose, in the two shapes that produced Blocks.
  ['a message in quotes', { 'hooks/hooks.json': hook('echo "Remember: run lint/format before you commit"') }],
  ['a quoted flag value', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh --title "Build/Test finished"') }],
  ['a quoted message with a slash and no space', { 'hooks/hooks.json': hook('echo "Build/Test"') }],
  // A message that names a path: prose is dropped before any word in it is judged, so this
  // is the case the prose rule itself carries.
  ['a quoted message naming an absolute path', { 'hooks/hooks.json': hook('echo "Run /opt/tools/hello.sh if the build fails"') }],
  ['a quoted message starting with a path', { 'hooks/hooks.json': hook('echo "/opt/tools/hello.sh is the old way"') }],
  ['a quoted message naming a file the plugin ships', {
    'scripts/setup.sh': '#!/bin/sh\necho setup\n',
    'hooks/hooks.json': hook('echo "Install with ./scripts/setup.sh first"'),
  }],
  ['a quoted message naming a relative path', { 'hooks/hooks.json': hook('echo "See ./docs/setup.md before you start"') }],
  ['a ratio', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh --ratio 1/2') }],
  // Options and their values.
  ['an option with a slash in its value', { 'hooks/hooks.json': hook('curl --header "Content-Type: application/json" https://x.example.com') }],
  ['a URL argument', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js --url https://api.acme-notes.dev/x') }],
  // An option's value is part of the option. The rule reads words, not option grammars, so
  // this is a miss by choice: an option is not a path the plugin loads.
  ['an option whose value is a path in the plugin', {
    'scripts/helper.sh': '#!/bin/sh\necho helper\n',
    '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', '--config=scripts/helper.sh']),
  }],
  ['an option whose value is a relative path the plugin ships', {
    'config.json': '{ "port": 1 }\n',
    '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', '--config=./config.json']),
  }],
  // The variables the manifest reference documents for these fields.
  ['a declared userConfig value', {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'generated-tools', version: '1.0.0', description: 'd', author: { name: 'A' }, license: 'MIT',
      userConfig: { api_key: { type: 'string', title: 'Key', description: 'Your key', sensitive: true } },
    }, null, 2),
    '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', '--api-key', '${user_config.api_key}']),
  }],
  ['a userConfig value in an exec-form hook', {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'generated-tools', version: '1.0.0', description: 'd', author: { name: 'A' }, license: 'MIT',
      userConfig: { api_key: { type: 'string', title: 'Key', description: 'Your key', sensitive: true } },
    }, null, 2),
    'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/hook.js', { args: ['--key', '${user_config.api_key}'] }),
  }],
  ['the value Claude Code exports to a hook', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh "$CLAUDE_PLUGIN_OPTION_API_KEY"') }],
  ['the plugin data directory', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js --data "${CLAUDE_PLUGIN_DATA}"') }],
  ['a path under the plugin data directory', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js --db "${CLAUDE_PLUGIN_DATA}/db.sqlite"') }],
  ['the project directory', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js "$CLAUDE_PROJECT_DIR"') }],
  // An environment assignment, which is what the corpus instance was.
  ['an environment pass-through', { '.mcp.json': server('docker', ['run', '-i', '--rm', '-e', 'TFE_TOKEN=${TFE_TOKEN}', 'hashicorp/terraform-mcp-server:0.4.0']) }],
  ['an environment assignment as a prefix', { 'hooks/hooks.json': hook('TFE_TOKEN=$TFE_TOKEN node ${CLAUDE_PLUGIN_ROOT}/server.js') }],
  // A package-manager script: its own row, held, never this one.
  ['a package-manager script', { '.mcp.json': server('bun', ['run', '--cwd', '${CLAUDE_PLUGIN_ROOT}', '--shell=bun', '--silent', 'start']) }],
  // A bare file name is the user's file, not the plugin's, even when the plugin ships one of
  // the same name: every plugin ships a README and a LICENSE, and a hook that works on the
  // project's own files must not become a Block for that.
  ['a project README the plugin also has', { 'hooks/hooks.json': hook('git add README.md') }],
  ['a project LICENSE the plugin also has', { 'hooks/hooks.json': hook('cat LICENSE') }],
  ['a project package.json the plugin also has', {
    'package.json': '{ "name": "acme", "version": "1.0.0" }\n',
    'hooks/hooks.json': hook('jq -r .name package.json'),
  }],
  ['an option value that matches a file deeper in the plugin', {
    'server/index.js': 'console.log("server");\n',
    'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh --entry index.js'),
  }],
  // A bare word with no path in it at all.
  ['a bare command', { '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js']) }],
  // A module Node preloads is an option's value, not the script it runs.
  ['a preloaded module', { 'hooks/hooks.json': hook('node -r dotenv/config ${CLAUDE_PLUGIN_ROOT}/server.js') }],
  ['an imported loader', { 'hooks/hooks.json': hook('node --import tsx/esm ${CLAUDE_PLUGIN_ROOT}/server.js') }],
  // A flag that is spelled like an inline flag but comes after the script belongs to the
  // script, and `bash -e` is a shell running a file with errexit on.
  ['a port flag after the script', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js -p 3000') }],
  ['a config flag after the script', { 'hooks/hooks.json': hook('python3 ${CLAUDE_PLUGIN_ROOT}/scripts/tool.py -c config.yaml') }],
  ['an eval-looking flag after the script', { 'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/server.js -e production') }],
  ['a shell with errexit running a file', { 'hooks/hooks.json': hook('bash -e ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh') }],
  ['a shell flag after the script', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh -c foo') }],
  ['a module run with its own flags', { 'hooks/hooks.json': hook('python3 -m pytest -c pytest.ini') }],
  ['an MCP server given a port', { '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', '-p', '3000']) }],
  // An argument in an array is one argument, whatever is in it.
  ['an MCP argument that is a sentence naming a path', {
    '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', '--note', 'reads /var/log if it is there']),
  }],
  ['an exec-form hook argument that is a sentence', {
    'hooks/hooks.json': hook('node ${CLAUDE_PLUGIN_ROOT}/hook.js', { args: ['--message', 'run lint/format first'] }),
  }],
  // A script with an extension, in the user's project and not shipped by the plugin.
  ['a project script the plugin does not ship', { 'hooks/hooks.json': hook('python3 manage.py check') }],
  // The interpreter's own script, which lives in the user's project: laravel-boost in the
  // official marketplace runs `php artisan boost:mcp` and ships no such file.
  ['a script the plugin does not ship', { '.mcp.json': server('php', ['artisan', 'boost:mcp']) }],
  ['a bare program name', { '.mcp.json': server('clangd', ['--background-index']) }],
];

for (const [label, files] of NOT_PATHS) {
  test(`not a path: ${label}`, () => {
    const name = `path-ok-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const { confirmed, atRoot, status } = pathFindings(name, files);
    const all = [...confirmed, ...atRoot];
    assert.deepEqual(all.map((finding) => finding.detail), [],
      `${label}: ${JSON.stringify(all, null, 2)}`);
    assert.equal(status, 0, `${label}: nothing here blocks a submission`);
  });
}

// ------------------------------------------------------------------- paths: a Block

const PATHS = [
  ['an absolute path', { 'hooks/hooks.json': hook('bash /opt/tools/hello.sh') }, '/opt/tools/hello.sh'],
  ['a relative path through an interpreter', { 'hooks/hooks.json': hook('bash scripts/hello.sh') }, 'scripts/hello.sh'],
  ['a relative path after a preloaded module', { 'hooks/hooks.json': hook('node -r dotenv/config scripts/run.js') }, 'scripts/run.js'],
  ['a relative path run directly', { 'hooks/hooks.json': hook('./scripts/x.sh') }, './scripts/x.sh'],
  ['a path out of the plugin folder', { 'hooks/hooks.json': hook('bash ../shared/run.sh') }, '../shared/run.sh'],
  ['a home-relative path', { 'hooks/hooks.json': hook('bash $HOME/x') }, '$HOME/x'],
  ['a path under the user profile', { 'hooks/hooks.json': hook('bash ~/tools/run.sh') }, '~/tools/run.sh'],
  ['a Windows path', { 'hooks/hooks.json': hook('node C:\\tools\\run.js') }, 'C:/tools/run.js'],
  ['a script the plugin ships, named to an interpreter without a path', {
    'server.js': 'console.log("server");\n',
    '.mcp.json': server('node', ['server.js']),
  }, 'server.js'],
  ['a file the plugin ships, as an argument', {
    'hooks/hooks.json': hook('echo done'),
    'scripts/helper.sh': '#!/bin/sh\necho helper\n',
    '.mcp.json': server('node', ['${CLAUDE_PLUGIN_ROOT}/server.js', 'scripts/helper.sh']),
  }, 'scripts/helper.sh'],
  ['a command substitution in a path', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/$(whoami).sh') }, 'a command substitution'],
  ['a wildcard in a path', { 'hooks/hooks.json': hook('bash ${CLAUDE_PLUGIN_ROOT}/scripts/*.sh') }, 'a wildcard'],
  ['a wildcard in a relative path', { 'hooks/hooks.json': hook('bash scripts/*.sh') }, 'a wildcard'],
];

for (const [label, files, expected] of PATHS) {
  test(`a path: ${label}`, () => {
    const name = `path-no-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const { confirmed, status } = pathFindings(name, files);
    assert.equal(confirmed.length >= 1, true, `${label}: ${JSON.stringify(confirmed, null, 2)}`);
    assert.equal(
      confirmed.some((finding) => finding.detail.includes(expected)),
      true,
      `${label}: expected "${expected}" in ${JSON.stringify(confirmed.map((finding) => finding.detail), null, 2)}`,
    );
    assert.equal(status, 1, `${label} blocks a submission in a subfolder`);
  });
}

// ------------------------------------------------- inline programs, wherever they sit

const INLINE = [
  ['an inline program on its own', 'python3 -c "print(1)"'],
  ['an inline program after &&', 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh && python3 -c "print(1)"'],
  ['an inline program after ;', 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh; python3 -c "print(1)"'],
  ['an inline program after ||', 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh || python3 -c "print(1)"'],
  ['an inline program after a pipe', 'echo start | python3 -c "print(1)"'],
  ['a shell running a string', 'bash -c "echo hi"'],
  ['a shell with combined flags', 'bash -lc "echo hi"'],
  ['a shell with two short flags', 'sh -ec "echo hi"'],
  ['an inline program after a preloaded module', 'node -r dotenv/config -e "1 + 1"'],
  ['powershell after an option that takes a value', 'powershell -ExecutionPolicy Bypass -Command "Get-Date"'],
  ['cmd with a switch before /c', 'cmd /d /c "dir"'],
  ['node printing', 'node -p "1 + 1"'],
  ['node evaluating', 'node --eval "1 + 1"'],
  ['python with a flag before -c', 'python3 -u -c "print(1)"'],
  ['an assignment in front of it', 'FOO=1 python3 -c "print(1)"'],
  ['env in front of it', 'env python3 -c "print(1)"'],
  ['powershell', 'powershell -NoProfile -Command "Get-ChildItem"'],
  ['cmd', 'cmd /c "dir"'],
  ['perl', 'perl -e "print 1"'],
  ['ruby', 'ruby -e "puts 1"'],
];

for (const [label, command] of INLINE) {
  test(`an inline program: ${label}`, () => {
    const name = `inline-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const { confirmed, status } = pathFindings(name, { 'hooks/hooks.json': hook(command) });
    assert.equal(confirmed.length >= 1, true, `${label}: ${JSON.stringify(confirmed, null, 2)}`);
    assert.equal(confirmed.some((finding) => /inline program|starts a shell/.test(finding.detail)), true,
      `${label}: ${JSON.stringify(confirmed.map((finding) => finding.detail), null, 2)}`);
    assert.equal(status, 1, `${label} blocks a submission in a subfolder`);
  });
}

test('an MCP server that runs a script with a -p or -c flag of its own is not an inline program', () => {
  const { confirmed, inlineHold } = pathFindings('inline-mcp-script-flags', {
    '.mcp.json': server('python3', ['${CLAUDE_PLUGIN_ROOT}/server.py', '-c', 'config.yaml', '-p', '3000']),
  });
  assert.deepEqual(confirmed.map((finding) => finding.detail), []);
  assert.deepEqual(inlineHold.map((finding) => finding.detail), []);
});

test('an MCP server that runs an inline program is held, and the path row says so too', () => {
  const { confirmed, inlineHold } = pathFindings('inline-mcp-shape', {
    '.mcp.json': server('python3', ['-c', 'import server; server.run()']),
  });
  assert.equal(inlineHold.length, 1, JSON.stringify(inlineHold, null, 2));
  assert.equal(inlineHold[0].result, 'hold');
  assert.equal(confirmed.length, 1, JSON.stringify(confirmed, null, 2));
  assert.match(confirmed[0].detail, /inline program/);
});

// ----------------------------------------------------- at the root: a note, not a block

test('the same commands at the root are a note, not a block', () => {
  writeGeneratedFixture('path-at-root', {
    ...minimalPlugin(),
    'hooks/hooks.json': hook('bash scripts/hello.sh && python3 -c "print(1)"'),
  });
  gitIndexFixture('path-at-root');
  const { json, status } = checkGeneratedDir(path.join(generatedRoot, 'path-at-root'));
  assert.equal(json.findings.filter((finding) => finding.rule === 'runtime/plugin-root-path').length, 0,
    JSON.stringify(json.findings, null, 2));
  assert.equal(json.findings.filter((finding) => finding.rule === 'runtime/plugin-root-path-at-root').length >= 1, true);
  assert.equal(status, 0);
});