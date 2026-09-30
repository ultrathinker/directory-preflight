/**
 * What the plugin runs and connects to.
 * Mirrors the "Review what the plugin runs and connects to" table of the checklist.
 */

import path from 'node:path';
import { defineRule } from '../lib/registry.mjs';
// One definition of "a file Claude Code loads as a component", shared with the front
// matter rules, so a skill's reference material is never treated as a component.
import { isComponentFile } from './components.mjs';
import { readManifest, declaredServers } from './manifest.mjs';
import { collectHookSources, iterateHandlers } from '../lib/hooks.mjs';
import { findLaunchers, findInstalls } from '../lib/launchers.mjs';
import { findCredentials, ENV_CREDENTIAL_RE, findEnvCredential, redact } from '../lib/secrets.mjs';
import { markdownCodeSpans, oneLine } from '../lib/util.mjs';

const PACKAGE_MANAGER_FILES = [
  '.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', 'uv.toml', 'pip.conf', 'pip.ini',
  'poetry.toml', 'nuget.config', '.pypirc', '.gemrc', 'condarc', '.condarc',
];
const PACKAGE_SOURCE_RE = /\b(registry|index-url|index_url|extra-index-url|proxy|mirror|source|sources|channel)\b/i;
/**
 * The lockfiles Claude Code installs from. Exactly the list the checklist gives: a yarn.lock
 * or a pnpm-lock.yaml beside a package.json is not an install, and Claude Code skips it.
 */
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'];

/** Directories whose files can run something. */
/** A command that reaches the network: the same line has to both read a value and use it. */
const NETWORK_USE_RE = /\b(?:https?:\/\/|curl|wget|Invoke-WebRequest|Invoke-RestMethod|fetch\s*\(|requests\.|axios|urlopen|net\.connect)\b/i;

const RUNNABLE_PREFIXES = ['commands/', 'skills/', 'agents/', 'hooks/', 'scripts/', 'bin/', 'monitors/', 'workflows/'];
const RUNNABLE_EXTENSIONS = ['.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.js', '.mjs', '.cjs', '.py', '.rb'];
const SINGLE_FILES = ['.mcp.json', 'hooks/hooks.json', 'settings.json', '.lsp.json', '.claude-plugin/plugin.json'];

/** Files whose text is worth reading for the rules in this section. */
export function executableSurfaces(scan) {
  const surfaces = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
    const rel = entry.pluginRel ?? '';
    const interesting = SINGLE_FILES.includes(rel)
      || RUNNABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))
      || RUNNABLE_EXTENSIONS.includes(entry.ext)
      || entry.ext === '.md';
    if (!interesting) continue;
    const text = scan.readText(entry);
    if (text === null) continue;
    surfaces.push({ entry, rel, text });
  }
  return surfaces;
}

/** Every command string a hook or an MCP server would run. */
export function collectCommands(scan, manifest) {
  const commands = [];
  for (const source of collectHookSources(scan, manifest)) {
    if (source.error || !source.data) continue;
    for (const { event, group, handler, where, handlerIndex } of iterateHandlers(source.data, source.rel)) {
      if (!handler || typeof handler !== 'object') continue;
      const matcher = group && typeof group.matcher === 'string' && group.matcher !== '' ? ` (matcher ${group.matcher})` : '';
      if (handler.type === 'command' && typeof handler.command === 'string') {
        commands.push({
          kind: 'hook',
          label: `${source.origin ?? source.rel} ${event}${matcher} handler ${handlerIndex + 1}`,
          path: source.rel,
          command: handler.command,
          args: Array.isArray(handler.args) ? handler.args : [],
          shell: handler.shell,
          where,
        });
      }
      if (handler.type === 'http' && typeof handler.url === 'string') {
        commands.push({ kind: 'http-hook', label: `${source.rel} ${event}`, path: source.rel, command: handler.url, args: [] });
      }
    }
  }
  for (const [name, { config, origin }] of declaredServers(manifest, scan)) {
    if (config && typeof config.command === 'string') {
      commands.push({
        kind: 'mcp',
        label: `MCP server "${name}"`,
        path: origin,
        command: config.command,
        args: Array.isArray(config.args) ? config.args : [],
      });
    }
  }
  return commands;
}

/** A shell token that reaches into the plugin folder. */
function pluginPathTokens(text) {
  const tokens = text.match(/\$\{CLAUDE_PLUGIN_ROOT\}[^\s"'`;|&)]*|[A-Za-z0-9_./-]*\/[A-Za-z0-9_./-]+/g) ?? [];
  return tokens.filter((token) => token.length > 2);
}

/**
 * The places where `${user_config.KEY}` is substituted: MCP and hook configuration,
 * and the content of a skill, a command or an agent. Text elsewhere is not a reference.
 */
export function componentContent(scan) {
  const found = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
    const rel = entry.pluginRel ?? '';
    const isConfig = SINGLE_FILES.includes(rel) || rel === '.claude-plugin/plugin.json';
    // Content is a component file: `${user_config.KEY}` is substituted in what Claude Code
    // loads, not in the reference material a skill keeps beside it.
    const isContent = entry.ext === '.md' && isComponentFile(rel);
    if (!isConfig && !isContent) continue;
    const text = scan.readText(entry);
    if (text !== null) found.push({ entry, rel: entry.repoRel, text, kind: isConfig ? 'config' : 'content' });
  }
  for (const source of collectHookSources(scan, readManifest(scan).data)) {
    if (source.data && !source.inline) {
      found.push({ entry: null, rel: source.rel, text: JSON.stringify(source.data), kind: 'config' });
    }
  }
  return found;
}

/** Files in the plugin that a hook or an MCP server command reaches for. */
export function referencedPluginFiles(scan, manifest) {
  const found = new Map();
  for (const command of collectCommands(scan, manifest)) {
    for (const token of pluginPathTokens(`${command.command} ${command.args.join(' ')}`)) {
      const rel = token.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\/?/, '').replace(/^\.\//, '');
      if (rel === '' || found.has(rel)) continue;
      const entry = scan.pluginFiles.find((candidate) => candidate.pluginRel === rel);
      if (entry && entry.ext !== '.md') found.set(rel, { entry, command });
    }
  }
  return [...found.values()];
}

const SHELL_EXTENSIONS = ['.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat'];

/**
 * Where a package launcher could really run: the commands a plugin declares, the shell
 * scripts it ships, the code blocks in what it tells Claude to do, the scripts its hooks
 * reach for, and package.json scripts. Prose is not a command.
 */
export function launcherSurfaces(scan, manifest) {
  /** Keyed by the file a finding points at, so one file is reported once. */
  const byRel = new Map();
  const surfaces = byRel;
  const add = (rel, text, label, key = rel, instructions = false) => {
    const existing = byRel.get(key);
    if (existing) {
      if (!existing.label && label) existing.label = label;
      // A file that both runs something and explains it counts as running it.
      if (!instructions) existing.instructions = false;
      return;
    }
    byRel.set(key, { rel, text, label, instructions });
  };
  for (const command of collectCommands(scan, manifest)) {
    if (command.kind === 'http-hook') continue;
    add(command.path, `${command.command} ${command.args.join(' ')}`, command.label);
  }
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
    const rel = entry.pluginRel ?? '';
    const isShell = SHELL_EXTENSIONS.includes(entry.ext);
    // A component file is what the plugin tells Claude to do, not something the plugin
    // runs: a code block in a SKILL.md, a command or an agent reads like the thing it
    // describes, so its findings are heuristics. A README is documentation and is not read
    // at all, and neither is the reference material a skill keeps beside its SKILL.md —
    // `skills/<name>/references/*.md` explained MCP servers and npm commands, and blocking
    // a plugin for its own documentation is a false positive.
    const isInstruction = isComponentFile(rel);
    if (!isShell && !isInstruction) continue;
    const text = scan.readText(entry);
    if (text === null) continue;
    const body = isShell ? text : markdownCodeSpans(text).join('\n');
    if (body.trim() === '') continue;
    add(entry.repoRel, body, null, entry.repoRel, isInstruction);
  }
  for (const { entry, command } of referencedPluginFiles(scan, manifest)) {
    const text = scan.readText(entry);
    if (text !== null) add(entry.repoRel, text, command.label);
  }
  const packageJson = scan.textInPlugin('package.json');
  if (packageJson) {
    try {
      const scripts = JSON.parse(packageJson).scripts;
      if (scripts && typeof scripts === 'object') {
        for (const [name, value] of Object.entries(scripts)) {
          if (typeof value === 'string') add('package.json', value, `package.json script "${name}"`, `package.json#${name}`);
        }
      }
    } catch {
      /* a package.json that does not parse is not this rule's business */
    }
  }
  return [...byRel.values()];
}

/** `${user_config.KEY}` references in a string. */
export function userConfigReferences(text) {
  return [...String(text).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)].map((match) => match[1]);
}

function absoluteUrlProblem(value) {
  if (value === '') return null;
  if (value.startsWith('${user_config.')) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'it is not an absolute URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
    return `it uses ${parsed.protocol.replace(':', '')}, not https or wss`;
  }
  return null;
}

const INLINE_PROGRAMS = new Set(['node', 'python', 'python3', 'py', 'ruby', 'perl', 'php', 'deno', 'bun']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
/** Programs whose next non-flag word is the script they run, so it is a path. */
const SCRIPT_RUNNERS = new Set([...INLINE_PROGRAMS, ...SHELLS]);
/** Short flags that make a program run its argument as code rather than as a file. */
const PROGRAM_INLINE_FLAGS = new Set(['-e', '-c', '--eval', '--exec', '-p', '--print', '--command']);
const SHELL_INLINE_FLAGS = new Set(['-c', '--command', '-command', '/c', '/k']);
/** Variables the documentation gives for exactly these fields. */
const DOCUMENTED_VARIABLES = ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_PROJECT_DIR'];
const DOCUMENTED_ROOT_RE = new RegExp(
  `^\\$(?:\\{)?(?:${DOCUMENTED_VARIABLES.join('|')}|user_config\\.[A-Za-z0-9_]+|CLAUDE_PLUGIN_OPTION_[A-Za-z0-9_]+)\\}(?=/|$)`,
);
/** A word written like a script file: what an interpreter is pointed at. */
const SCRIPT_FILE_RE = /\.(?:sh|bash|zsh|ps1|cmd|bat|js|mjs|cjs|ts|mts|cts|py|rb|pl|php)$/i;
/** An assignment in front of the program: `FOO=1 python3 -c …`. */
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A command as a shell reads it: split at its operators, with the words of each segment
 * and the quoting that produced them. Redirection targets are dropped, because `2>/dev/null`
 * is not a path the plugin loads, and a word that came out of a quoted string containing a
 * space is marked as prose, because `echo "run lint/format first"` is a message.
 *
 * This exists because reading a command as a list of words with slashes in them is what
 * produced a confirmed Block for every Docker image, MIME type and sentence in the corpus.
 */
export function readCommand(text) {
  const segments = [];
  let words = [];
  let current = '';
  let prose = false;
  let quote = null;
  let quotedSpace = false;
  const flush = () => {
    if (current !== '') words.push({ word: current.replace(/\\/g, '/'), prose });
    current = '';
    prose = false;
  };
  const endSegment = () => {
    flush();
    if (words.length > 0) segments.push({ words });
    words = [];
  };
  let inQuote = (char) => char === '"' || char === "'";
  const chars = String(text);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        if (quotedSpace) prose = true;
        continue;
      }
      if (/\s/.test(char)) quotedSpace = true;
      current += char;
      continue;
    }
    if (inQuote(char)) {
      quote = char;
      quotedSpace = false;
      continue;
    }
    // A redirection and its target: `2>/dev/null`, `>/dev/null 2>&1`, `> log.txt`, `< in`.
    if (char === '>' || char === '<') {
      if (/^\d*$/.test(current)) current = '';
      while (index + 1 < chars.length && (chars[index + 1] === '>' || chars[index + 1] === '<')) index += 1;
      if (chars[index + 1] === '&') {
        index += 1;
        while (index + 1 < chars.length && /[\d-]/.test(chars[index + 1])) index += 1;
        continue;
      }
      while (index + 1 < chars.length && /\s/.test(chars[index + 1])) index += 1;
      if (inQuote(chars[index + 1])) {
        const closer = chars[index + 1];
        index += 1;
        while (index + 1 < chars.length && chars[index + 1] !== closer) index += 1;
        index += 1;
      } else {
        while (index + 1 < chars.length && !/[\s;|&#]/.test(chars[index + 1])) index += 1;
      }
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (char === ';' || char === '|' || char === '&' || char === '#' || char === '\n') {
      endSegment();
      continue;
    }
    current += char;
  }
  endSegment();
  return segments;
}

/**
 * The words of a command, segment by segment. A hook writes its command as one string and
 * an MCP server writes it as a program plus an argument array; both are one command line,
 * so the parts are joined before they are read. An argument that holds a space is one
 * argument, so it is quoted when it is joined: `["--note", "reads /var/log if present"]`
 * is a sentence, not a path.
 */
function commandSegments(command, args = []) {
  const quoted = args
    .filter((arg) => typeof arg === 'string')
    .map((arg) => {
      if (!/\s/.test(arg)) return arg;
      if (!arg.includes('"')) return `"${arg}"`;
      return arg.includes("'") ? arg : `'${arg}'`;
    });
  const parts = [command, ...quoted].filter((part) => typeof part === 'string');
  if (parts.length === 0) return [];
  return readCommand(parts.join(' '));
}

/**
 * The inline program in a command, whichever segment it is in. `a.sh && python3 -c "…"` is
 * as much an inline program as `python3 -c "…"` on its own.
 */
function inlineProgramProblem(command, args = []) {
  for (const segment of commandSegments(command, args)) {
    const words = segment.words.filter((entry) => !entry.prose).map((entry) => entry.word);
    const problem = inlineProgramIn(words);
    if (problem) return problem;
  }
  return null;
}

function programOf(words) {
  let index = 0;
  while (index < words.length && (ASSIGNMENT_RE.test(words[index]) || words[index] === 'env')) index += 1;
  if (index >= words.length) return null;
  return {
    binary: path.posix.basename(words[index]).replace(/\.exe$/, ''),
    rest: words.slice(index + 1),
  };
}

/** Is this word a flag that makes the program run its argument as code? */
function isInlineFlag(word, flags, combined) {
  const flag = word.toLowerCase();
  if (flags.has(flag)) return true;
  // A combined short flag whose last letter is one of them: `bash -lc`, `sh -ec`, `node -pe`.
  return combined.test(flag);
}

/** Options that take the next word as their value, so that word is not where the options end. */
const VALUE_OPTIONS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '--max-old-space-size',
  '--stack-size', '--env-file', '-W', '-X', '-executionpolicy', '-windowstyle',
]);

/**
 * Is there a flag among the program's own options that makes it run its argument as code?
 * Only the options before the script count: `node server.js -p 3000` passes -p to the
 * script, `python3 tool.py -c config.yaml` passes -c to it, and `bash -e run.sh` is a shell
 * running a file with errexit on. The options end at the first word that is not an option
 * or an option's value.
 */
function hasInlineFlag(rest, flags, combined) {
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    if (isInlineFlag(word, flags, combined)) return true;
    if (VALUE_OPTIONS.has(word) || VALUE_OPTIONS.has(word.toLowerCase())) {
      index += 1;
      continue;
    }
    if (word.startsWith('-') || /^\/[a-z]$/i.test(word)) continue;
    return false;
  }
  return false;
}

/**
 * Does this segment run its program from the command line rather than from a file?
 *
 * The kind matters as much as the reason: an inline program is one of the shapes the
 * `${CLAUDE_PLUGIN_ROOT}` path row blocks on, while a package-manager script is the
 * "MCP server command wasn't read" row, which is only held.
 */
function inlineProgramIn(words) {
  const program = programOf(words);
  if (!program) return null;
  const { binary, rest } = program;
  if (INLINE_PROGRAMS.has(binary) && hasInlineFlag(rest, PROGRAM_INLINE_FLAGS, /^-[a-z]*[cep]$/)) {
    return { kind: 'inline', reason: `runs an inline program with ${binary}` };
  }
  if (SHELLS.has(binary) && hasInlineFlag(rest, SHELL_INLINE_FLAGS, /^-[a-z]*c$/)) {
    return { kind: 'shell', reason: `starts a shell (${binary}) that runs the rest of the command` };
  }
  if (PACKAGE_MANAGERS.has(binary) && rest[0] === 'run') {
    return { kind: 'package-manager', reason: 'runs a package-manager script' };
  }
  return null;
}

/**
 * The devices and null sinks, which are paths to nothing the plugin loads. `2>/dev/null` is
 * handled as a redirection; this covers the same word written as an argument.
 */
const DEVICE_PATHS = new Set([
  '/dev/null', '/dev/zero', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/random',
  '/dev/urandom', '/dev/tty', 'nul', 'NUL',
]);

/**
 * Does this word name a file the plugin ships, by its full path inside the plugin? The
 * strongest sign that it is a path. A bare file name is not enough: `git add README.md`,
 * `cat LICENSE` and `jq .name package.json` name files in the user's project, and every
 * plugin ships a README and a LICENSE. Only the script an interpreter runs may be bare,
 * because there the word is the program's own argument (`node server.js`).
 */
function namesAPluginFile(scan, word, { bareOk = false } = {}) {
  const cleaned = word
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
  if (cleaned === '' || cleaned.includes('*') || cleaned.includes('$')) return false;
  if (!bareOk && !cleaned.includes('/')) return false;
  return scan.pluginFiles.some((entry) => entry.pluginRel === cleaned);
}

/**
 * What is wrong with one word, or null.
 *
 * The row says "write each path in full from ${CLAUDE_PLUGIN_ROOT}", so the whole question
 * is which words are paths. The answer is narrow: a word rooted at a place a shell would
 * look (`/opt/x.sh`, `./x.sh`, `../x.sh`, `~/x`, `C:\x`), a word that names a file the
 * plugin ships, the script argument of an interpreter, or a variable that is not one of the
 * documented ones at the root of such a word. Everything else a command is made of — an
 * option, a container image, a package spec, a sentence in quotes, a redirection, an
 * environment assignment — is not a path, and reporting it as one put a confirmed Block on
 * GitHub's own documented docker command and on `echo "run lint/format"`.
 */
function pathProblem(scan, word, scriptWord) {
  if (word === '' || word.startsWith('-') || DEVICE_PATHS.has(word)) return null;
  const stripped = word.replace(/\$\{[^}]*\}/g, '');
  const rooted = /^(?:\.\.?\/|\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(word);
  const variableRooted = /^\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:\})?\//.test(word);
  // The interpreter's script argument counts only when it is written as a path. A bare word
  // after an interpreter is not one: `php artisan boost:mcp` runs the artisan script in the
  // user's own project, which the plugin neither ships nor points at.
  const interpreterScript = word === scriptWord && word.includes('/');
  if (!rooted && !variableRooted && !interpreterScript
    && !namesAPluginFile(scan, word, { bareOk: word === scriptWord })) return null;
  const shown = oneLine(word, 40);
  if (/[*?]/.test(stripped)) return `a wildcard in the path "${shown}"`;
  if (stripped.includes('$(') || word.includes('`')) return `a command substitution in the path "${shown}"`;
  if (DOCUMENTED_ROOT_RE.test(word)) return null;
  return `the path "${shown}" is not written from \${CLAUDE_PLUGIN_ROOT}`;
}

/** The word a script runner is pointed at: `bash scripts/hello.sh` names `scripts/hello.sh`. */
function scriptArgument(words) {
  const program = programOf(words);
  if (!program || !SCRIPT_RUNNERS.has(program.binary)) return null;
  // An inline invocation runs code, not a file: `python3 -c "import x"` has no script.
  if (inlineProgramIn(words)) return null;
  // `bun run lint` names a package.json script, not a file. The table gives that shape its
  // own row under MCP servers, where it is held.
  if (PACKAGE_MANAGERS.has(program.binary) && (program.rest[0] === 'run' || program.rest[0] === 'x')) return null;
  // The first word that is written like a script. An option's value is not one, even when it
  // has a slash in it: `node -r dotenv/config server.js` runs server.js, and `dotenv/config`
  // is a module for Node to preload.
  for (const word of program.rest) {
    const flag = word.toLowerCase();
    if (word.startsWith('-') && word !== '-') continue;
    if (PROGRAM_INLINE_FLAGS.has(flag) || SHELL_INLINE_FLAGS.has(flag) || flag === '/c' || flag === '/k') continue;
    if (SCRIPT_FILE_RE.test(word)) return word;
  }
  return null;
}

export const runtimeRules = [
  defineRule({
    id: 'runtime/mcp-json-invalid',
    section: 'runtime',
    result: 'block',
    title: '.mcp.json can’t be parsed',
    what: '.mcp.json is not valid JSON, so none of its servers load.',
    fix: 'Fix the JSON, then run "claude plugin validate ." against the plugin folder.',
    limit: 1,
    run(scan) {
      const text = scan.textInPlugin('.mcp.json');
      if (text === null) return [];
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        return [{ path: '.mcp.json', detail: oneLine(error.message) }];
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return [{ path: '.mcp.json', detail: 'The file must hold a JSON object.' }];
      }
      // Both shapes are read: `{ "mcpServers": { ... } }` and the flat one where the server
      // names sit at the top level, which is what the official plugins ship and what
      // `claude plugin validate` accepts. Only a "mcpServers" that is not a server map is a
      // problem, because then nothing in the file matches the schema.
      const wrapper = data.mcpServers;
      if (wrapper !== undefined && (wrapper === null || typeof wrapper !== 'object' || Array.isArray(wrapper))) {
        return [{ path: '.mcp.json', detail: '"mcpServers" must be an object keyed by server name.' }];
      }
      return [];
    },
  }),

  defineRule({
    id: 'runtime/mcp-server-shape',
    section: 'runtime',
    result: 'block',
    title: 'MCP server URL is not https',
    what: 'An MCP server entry does not match the schema: a remote server needs a type and an absolute https or wss URL.',
    fix: 'Give each remote server "type": "http", "sse" or "ws" and an https:// or wss:// url, and each local server "command" with "args".',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const [name, { config, origin }] of declaredServers(data, scan)) {
        if (!config || typeof config !== 'object') {
          hits.push({ path: origin, detail: `Server "${name}" is not an object.` });
          continue;
        }
        if (typeof config.command === 'string') continue;
        if (typeof config.url !== 'string') {
          hits.push({
            path: origin,
            detail: `Server "${name}" has neither "command" nor "url"; the plugin fails to load.`,
          });
          continue;
        }
        if (!['http', 'sse', 'ws'].includes(config.type)) {
          hits.push({
            path: origin,
            detail: `Remote server "${name}" needs "type": "http", "sse" or "ws"; it has ${config.type === undefined ? 'none' : `"${config.type}"`}.`,
          });
        }
        const problem = absoluteUrlProblem(config.url);
        if (problem) hits.push({ path: origin, detail: `Server "${name}": ${problem} ("${oneLine(config.url, 60)}").` });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/mcp-server-command',
    section: 'runtime',
    result: 'hold',
    title: 'MCP server command wasn’t read',
    what: 'A local MCP server starts through a shell, an inline program or a package-manager script instead of running a file.',
    fix: 'Start the server by running a file in the plugin with plain arguments, such as node ${CLAUDE_PLUGIN_ROOT}/server.js.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const [name, { config, origin }] of declaredServers(data, scan)) {
        if (!config || typeof config.command !== 'string') continue;
        const args = Array.isArray(config.args) ? config.args : [];
        const problem = inlineProgramProblem(config.command, args);
        if (problem) {
          hits.push({ path: origin, detail: `Server "${name}" ${problem.reason}.` });
          continue;
        }
        const root = (config.command + ' ' + args.join(' ')).includes('${CLAUDE_PLUGIN_ROOT}');
        if (!root) {
          hits.push({
            path: origin,
            detail: `Server "${name}" does not run a file through \${CLAUDE_PLUGIN_ROOT}, so a reviewer cannot follow it.`,
          });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/user-config-undeclared',
    source: 'validate',
    section: 'runtime',
    result: 'block',
    what: 'A ${user_config.KEY} reference in an MCP, LSP or hook config names an option the manifest does not declare.',
    fix: 'Declare the key under userConfig in plugin.json, or remove the reference.',
    limit: 10,
    when: (scan) => componentContent(scan).some(({ kind }) => kind === 'config'),
    run(scan) {
      const { data } = readManifest(scan);
      const declared = new Set(data && data.userConfig ? Object.keys(data.userConfig) : []);
      const hits = [];
      const seen = new Set();
      for (const { rel, text, kind } of componentContent(scan)) {
        if (kind !== 'config') continue;
        for (const key of userConfigReferences(text)) {
          if (declared.has(key) || seen.has(key)) continue;
          seen.add(key);
          hits.push({ path: rel, detail: `\${user_config.${key}} is not declared in plugin.json.` });
        }
      }
      return hits;
    },
  }),

  // In skill, command and agent content a reference is substituted and a missing key
  // simply expands to nothing; only configuration fields make the plugin fail. A note,
  // because a skill that teaches how to write a userConfig reference is doing its job.
  defineRule({
    id: 'runtime/user-config-in-content',
    section: 'runtime',
    result: 'note',
    source: 'tool',
    what: 'Content in a skill, command or agent names a ${user_config.KEY} the manifest does not declare, so nothing is substituted there.',
    fix: 'Declare the key under userConfig, or make the reference an example rather than a live one.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const declared = new Set(data && data.userConfig ? Object.keys(data.userConfig) : []);
      const hits = [];
      const seen = new Set();
      for (const { rel, text, kind } of componentContent(scan)) {
        if (kind !== 'content') continue;
        for (const key of userConfigReferences(text)) {
          if (declared.has(key) || seen.has(key)) continue;
          seen.add(key);
          hits.push({ path: rel, detail: `\${user_config.${key}} is not declared in plugin.json.` });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/user-config-in-shell-field',
    source: 'manifest-reference',
    section: 'runtime',
    result: 'block',
    what: 'A shell-form hook command or a monitor command interpolates ${user_config.KEY}, which the field rejects.',
    fix: 'Use a hook in exec form with "args", read CLAUDE_PLUGIN_OPTION_<KEY> in the hook, or let the monitor fetch the value itself.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const command of collectCommands(scan, data)) {
        // Exec form is a hook that carries an "args" array, not a "shell" value.
        const execForm = Array.isArray(command.args) && command.args.length > 0;
        if (command.kind !== 'hook' || execForm) continue;
        if (userConfigReferences(command.command).length > 0) {
          hits.push({ path: command.path, detail: `${command.label}: \${user_config.…} in a shell-form command stops the hook from running.` });
        }
      }
      const monitors = data?.experimental?.monitors;
      if (Array.isArray(monitors)) {
        for (const monitor of monitors) {
          if (monitor && typeof monitor.command === 'string' && userConfigReferences(monitor.command).length > 0) {
            hits.push({ path: '.claude-plugin/plugin.json', detail: `Monitor "${monitor.name}" cannot read \${user_config.…}.` });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/launcher-unpinned',
    section: 'runtime',
    result: 'block',
    title: 'Unpinned npx launcher',
    what: 'A package launcher runs a package that is not pinned to an exact version.',
    fix: 'Pin the version (npx pkg@1.2.3, uvx pkg==1.2.3) or bundle the code into the plugin.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const { rel, text, label, instructions } of launcherSurfaces(scan, data)) {
        for (const launcher of findLaunchers(text)) {
          if (launcher.pinned) continue;
          hits.push({
            path: rel,
            // The table names one title for the npm launchers and one for the Python ones.
            title: /^(?:uvx|uv run|pipx run)$/.test(launcher.launcher) ? 'Unpinned uvx launcher' : undefined,
            detail: `${label ? `${label}: ` : ''}"${launcher.launcher}${launcher.spec ? ` ${launcher.spec}` : ''}" — ${launcher.reason}.`
              + (instructions ? ' This one is in a code block: it is what the file tells Claude to run, not something the plugin runs, so it is a guess rather than a checklist result.' : ''),
            heuristic: instructions,
          });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/launcher-pinned',
    section: 'runtime',
    result: 'hold',
    title: 'Runs a pinned npx or uvx package',
    what: 'A launcher runs a registry package pinned to an exact version; a reviewer always reads this.',
    fix: 'Nothing to fix. Expect a hold, or bundle the package into the plugin to avoid it.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const { rel, text, label, instructions } of launcherSurfaces(scan, data)) {
        for (const launcher of findLaunchers(text)) {
          if (!launcher.pinned) continue;
          hits.push({
            path: rel,
            detail: `${label ? `${label}: ` : ''}"${launcher.launcher} ${launcher.spec}" is pinned, so the package still resolves its own dependencies at install time.`,
            heuristic: instructions,
          });
        }
      }
      return hits;
    },
  }),

  // The checklist gives this two results: a package-manager configuration file blocks a
// submission when the plugin also uses a launcher, and is only held when it merely runs a
// package install. Two rules, because one rule cannot carry two results.
  defineRule({
    id: 'runtime/package-manager-config-launcher',
    section: 'runtime',
    result: 'block',
    title: 'Install may use a custom registry or package source',
    what: 'The plugin ships a package-manager configuration file and runs a package launcher.',
    fix: 'Remove the configuration file; a plugin that uses a launcher may not point a package manager at its own registry or proxy.',
    limit: 10,
    when: (scan) => packageManagerUse(scan).launcher,
    run(scan) {
      return packageManagerConfigs(scan);
    },
  }),

  defineRule({
    id: 'runtime/package-manager-config-install',
    section: 'runtime',
    result: 'hold',
    title: 'Install may use a custom registry or package source',
    what: 'The plugin ships a package-manager configuration file and runs a package install.',
    fix: 'Remove the configuration file, or expect a reviewer to read it.',
    limit: 10,
    when: (scan) => !packageManagerUse(scan).launcher && packageManagerUse(scan).install,
    run(scan) {
      return packageManagerConfigs(scan);
    },
  }),

  defineRule({
    id: 'runtime/lockfile-install',
    section: 'runtime',
    result: 'hold',
    title: 'Dependencies install from a lockfile',
    what: 'A package.json sits beside a lockfile in the root of the plugin folder, so Claude Code installs those packages when a user installs the plugin.',
    fix: 'Nothing to fix. Expect a hold, or commit the code instead of a lockfile.',
    limit: 1,
    run(scan) {
      const names = new Set(scan.pluginFiles.map((entry) => entry.pluginRel));
      if (!names.has('package.json')) return [];
      const lock = LOCKFILES.find((candidate) => names.has(candidate));
      if (!lock) return [];
      return [{ path: lock, detail: `Claude Code installs the packages in ${lock} on every user's machine.` }];
    },
  }),

  defineRule({
    id: 'runtime/credential-literal',
    section: 'runtime',
    result: 'block',
    what: 'A file holds what looks like a real credential.',
    fix: 'Remove the value, rotate it, and ask for it through a userConfig entry with "sensitive": true, referenced as ${user_config.KEY}.',
    limit: 10,
    run(scan) {
      return credentialHits(scan, false);
    },
  }),

  defineRule({
    id: 'runtime/credential-looks-real',
    section: 'runtime',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'A file assigns a long literal value to something named like a secret.',
    fix: 'If it is a real credential, remove it and use a userConfig entry with "sensitive": true. If it is an example, make that obvious.',
    limit: 10,
    run(scan) {
      return credentialHits(scan, true);
    },
  }),

  defineRule({
    id: 'runtime/env-credential-exfiltration',
    section: 'runtime',
    result: 'hold',
    title: 'Uses a credential from the user’s machine',
    what: 'Something reads a credential out of the user’s environment and sends it to a server.',
    fix: 'Ask for the value through a userConfig entry with "sensitive": true instead.',
    limit: 10,
    run(scan) {
      const hits = [];
      const { data } = readManifest(scan);
      // Only a command that both reads the variable and makes the request counts. A file
      // that mentions a token and, elsewhere, a URL is not sending anything anywhere.
      const sends = (text) => text.split(/\r?\n/).filter((line) =>
        ENV_CREDENTIAL_RE.test(line) && NETWORK_USE_RE.test(line));
      for (const { rel, text } of executableSurfaces(scan)) {
        const lines = [...new Set(sends(text))];
        if (lines.length === 0) continue;
        const variable = findEnvCredential(lines[0]) ?? 'a credential';
        hits.push({
          path: rel,
          detail: `The same command reads ${variable} and makes a request: ${oneLine(lines[0].trim(), 90)}`,
        });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/env-credential-http-hook',
    section: 'runtime',
    result: 'block',
    title: 'Uses a credential from the user’s machine',
    what: 'An HTTP hook sends a credential the user already has in their environment.',
    fix: 'Ask for the value through a userConfig entry with "sensitive": true instead.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const command of collectCommands(scan, data)) {
        if (command.kind !== 'http-hook') continue;
        const credential = findEnvCredential(command.command);
        if (credential) {
          hits.push({
            path: command.path,
            detail: `${command.label} posts to a URL that carries ${credential}; an HTTP hook that sends a credential from the user's environment is blocked.`,
          });
        }
      }
      // The headers of the same handler, one handler at a time. Searching the whole file
      // for a credential and the word "http" reported a credential in one handler and an
      // unrelated HTTP hook in another as if they were the same thing.
      for (const source of collectHookSources(scan, data)) {
        if (!source.data) continue;
        for (const { event, handler, handlerIndex } of iterateHandlers(source.data, source.rel)) {
          if (!handler || typeof handler !== 'object' || handler.type !== 'http') continue;
          // Not `handler.url`: the loop above already reads the URL of every HTTP hook, one
          // handler at a time, and reading it twice reported the same hook twice.
          const strings = [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])]
            .filter((value) => typeof value === 'string');
          if (handler.headers && typeof handler.headers === 'object') {
            for (const value of Object.values(handler.headers)) {
              if (typeof value === 'string') strings.push(value);
            }
          }
          const credential = strings.map(findEnvCredential).find((found) => found !== null);
          if (credential) {
            hits.push({
              path: source.rel,
              detail: `${source.rel} ${event} handler ${handlerIndex + 1} sends ${credential}, which the user already has in their environment.`,
            });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'runtime/plugin-root-path',
    section: 'runtime',
    result: 'block',
    what: 'A hook or MCP server command names a path the plugin loads — a file inside the plugin, an absolute or relative path, or the script an interpreter runs — without writing it from ${CLAUDE_PLUGIN_ROOT}.',
    fix: 'Write each path from the plugin root: "${CLAUDE_PLUGIN_ROOT}/scripts/file.sh", with no command substitution and no wildcard. ${CLAUDE_PLUGIN_DATA}, ${CLAUDE_PROJECT_DIR} and ${user_config.KEY} are the other variables these fields take.',
    limit: 10,
    when: (scan) => scan.pluginRel !== '',
    run(scan) {
      return pluginRootPathHits(scan);
    },
  }),

  defineRule({
    id: 'runtime/plugin-root-path-at-root',
    section: 'runtime',
    result: 'note',
    what: 'A hook or MCP server command names a path the plugin loads without writing it from ${CLAUDE_PLUGIN_ROOT}; the same shape blocks a submission when the plugin folder is a subfolder of the repository.',
    fix: 'Write every path as "${CLAUDE_PLUGIN_ROOT}/scripts/file.sh".',
    limit: 10,
    when: (scan) => scan.pluginRel === '',
    run(scan) {
      return pluginRootPathHits(scan);
    },
  }),

  defineRule({
    id: 'runtime/script-follow',
    section: 'runtime',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#review-what-the-plugin-runs-and-connects-to',
    result: 'hold',
    title: 'Scripts the validator couldn’t follow',
    heuristic: true,
    what: 'A script that a hook or an MCP server runs holds something the directory validator cannot follow.',
    fix: 'Keep the logic in a plain shell script that names each path as ${CLAUDE_PLUGIN_ROOT}/<file>, or move the plugin to the root of its own repository.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const { entry, command } of referencedPluginFiles(scan, data)) {
        const detail = scriptProblem(scan, entry);
        if (detail) hits.push({ path: entry.repoRel, detail: `${command.label}: ${detail}` });
      }
      return hits;
    },
  }),
];

/**
 * Which package-manager behaviour the plugin has: a launcher, an install, or neither. This
 * decides a block — a package-manager configuration file beside a launcher — so it counts
 * only what the plugin runs, not a launcher its instructions mention.
 */
function packageManagerUse(scan) {
  const { data } = readManifest(scan);
  let launcher = false;
  let install = false;
  for (const { text, instructions } of launcherSurfaces(scan, data)) {
    if (instructions) continue;
    if (findLaunchers(text).length > 0) launcher = true;
    if (findInstalls(text).length > 0) install = true;
  }
  return { launcher, install };
}

/** The package-manager configuration files, named with what they set. */
function packageManagerConfigs(scan) {
  return scan.pluginFiles
    .filter((entry) => PACKAGE_MANAGER_FILES.includes(entry.name))
    .map((entry) => {
      const text = scan.readText(entry, 64 * 1024) ?? '';
      const names = PACKAGE_SOURCE_RE.test(text) ? ' It names a registry, index, proxy or source.' : '';
      return { path: entry.repoRel, detail: `This file sits beside a package manager at work.${names}` };
    });
}

/** Credential-shaped strings in every file the plugin ships. */
function credentialHits(scan, heuristic) {
  const hits = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
    if (entry.kind === 'image' || entry.kind === 'font') continue;
    const text = scan.readText(entry);
    if (text === null) continue;
    for (const hit of findCredentials(text)) {
      if (hit.heuristic !== heuristic) continue;
      const inHeader = /headers/i.test(text.slice(Math.max(0, hit.index - 400), hit.index));
      hits.push({
        path: entry.repoRel,
        detail: `${hit.name}: ${redact(hit.value)}` + (inHeader ? ' (in an MCP server header block)' : ''),
      });
      if (hits.length >= 10) return hits;
    }
  }
  return hits;
}

function pluginRootPathHits(scan) {
  const { data } = readManifest(scan);
  const hits = [];
  for (const command of collectCommands(scan, data)) {
    // An HTTP hook has a URL, not a path. Reading it as one produced a finding about a
    // perfectly valid hook.
    if (command.kind === 'http-hook') continue;
    const problems = new Map();
    const add = (key, problem) => {
      if (!problems.has(key)) problems.set(key, problem);
    };
    for (const segment of commandSegments(command.command, command.args)) {
      const words = segment.words.filter((entry) => !entry.prose).map((entry) => entry.word);
      // An inline program belongs to this row ("no ... inline program such as python3 -c").
      // A package-manager script does not: the table gives that shape its own row, and there
      // it is only held. Reporting it here too turned a hold into a block.
      const inline = inlineProgramIn(words);
      if (inline && inline.kind !== 'package-manager') add('@inline', inline.reason);
      const script = scriptArgument(words);
      for (const word of words) {
        const problem = pathProblem(scan, word, script);
        if (problem) add(word, problem);
      }
    }
    // One line per problem, and one problem per word: a token is reported once, not as a
    // variable and again as a path.
    for (const problem of [...problems.values()].slice(0, 4)) {
      hits.push({ path: command.path, detail: `${command.label}: ${problem}.` });
    }
  }
  return hits;
}

/** What a validator that only follows plain shell scripts would choke on. */
function scriptProblem(scan, entry) {
  const text = scan.readText(entry);
  if (text === null) return null;
  const problems = [];
  const launchers = findLaunchers(text);
  if (launchers.length > 0) problems.push(`runs the launcher "${launchers[0].launcher}"`);
  const installs = findInstalls(text);
  if (installs.length > 0) problems.push(`runs a package install ("${installs[0]}")`);
  const isShell = ['.sh', '.bash', '.zsh'].includes(entry.ext);
  // The table gives this hold "when the plugin folder is a subfolder of the repository":
  // at the root of its own repository the validator follows the plugin's own files, so a
  // non-shell script is read like anything else. Checking it at the root too reported a
  // hold the table does not give.
  if (!isShell) {
    if (scan.pluginRel === '') return null;
    problems.push(`is not a shell script (${entry.ext || 'no extension'}), so the validator cannot read through it`);
    return problems.join('; ') + '.';
  }
  if (scan.pluginRel !== '') {
    const otherVariables = [...text.matchAll(/\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'CLAUDE_PLUGIN_ROOT');
    if (otherVariables.length > 0) problems.push(`reads the shell variable ${[...new Set(otherVariables)].slice(0, 3).join(', ')}`);
    if (/\$\(|`/.test(text)) problems.push('uses a command substitution');
    const calls = (text.match(/[A-Za-z0-9_./-]+\/[A-Za-z0-9_.-]+/g) ?? [])
      .map((token) => token.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\/?/, ''))
      .filter((token) => token !== entry.pluginRel)
      .filter((token) => scan.pluginFiles.some((candidate) => candidate.pluginRel === token));
    if (calls.length > 0) problems.push(`runs another file in the plugin (${calls[0]})`);
  }
  return problems.length > 0 ? `${problems.join('; ')}.` : null;
}