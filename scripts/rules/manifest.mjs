/**
 * Manifest and plugin name.
 * Mirrors the "Manifest and plugin name" table of the pre-submission checklist, plus the
 * manifest shape rules from the plugin manifest reference.
 */

import path from 'node:path';
import { defineRule } from '../lib/registry.mjs';
import { hasNonAscii, nameHazards, oneLine } from '../lib/util.mjs';

const MANIFEST_REL = '.claude-plugin/plugin.json';
const ICON_REL = '.claude-plugin/icon.svg';

/** Names the directory refuses outright. */
const RESERVED_NAMES = new Set(['claude', 'anthropic', 'official', 'plugin', 'mcp', 'test']);
/** Brand words that make a longer name look official. */
const BRAND_PREFIXES = ['claude', 'anthropic', 'official'];
/** Words that carry no product identity on their own. */
const GENERIC_WORDS = new Set([
  'a', 'ai', 'agent', 'agents', 'app', 'apps', 'bar', 'baz', 'cli', 'code', 'demo', 'dev',
  'devtool', 'devtools', 'example', 'foo', 'helper', 'helpers', 'kit', 'mcp', 'my', 'new',
  'plugin', 'plugins', 'sample', 'server', 'skill', 'skills', 'temp', 'test', 'tests', 'the',
  'tool', 'tools', 'util', 'utils',
]);

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEBAB_SHAPE_RE = /^[a-z0-9-]+$/;
/** Characters that stop Claude Code from loading the plugin at all. */
function nameHasBreakingCharacter(name) {
  for (const char of name) {
    const code = char.codePointAt(0);
    if (code <= 0x20) return true;
    if (code === 0x40 || code === 0x3a || code === 0x2f || code === 0x5c) return true;
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
  }
  return false;
}

const KNOWN_TOP_LEVEL = new Set([
  '$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository',
  'license', 'keywords', 'metadata', 'defaultEnabled', 'dependencies', 'settings', 'userConfig',
  'channels', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles',
  'workflows', 'experimental',
]);

/**
 * The keys that declare components at the top level of plugin.json. `themes`, `monitors` and
 * `evals` are not here: the manifest reference puts exactly those inside `experimental`, so
 * they belong there and are not misplaced.
 */
const COMPONENT_KEYS = [
  'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows',
];

/** Which default folder a manifest key replaces, and what that folder holds. */
const DEFAULT_FOLDERS = {
  commands: { dir: 'commands', kind: 'directory' },
  agents: { dir: 'agents', kind: 'directory' },
  outputStyles: { dir: 'output-styles', kind: 'directory' },
  workflows: { dir: 'workflows', kind: 'directory' },
};

/** Read and parse the manifest. Returns `{ text, data, error, entry }`. */
export function readManifest(scan) {
  const entry = scan.fileInPlugin(MANIFEST_REL) ?? null;
  const text = entry ? scan.readText(entry) : null;
  if (text === null) return { entry: null, text: null, data: null, error: 'missing' };
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { entry, text, data: null, error: 'not-an-object' };
    }
    return { entry, text, data, error: null };
  } catch (error) {
    return { entry, text, data: null, error: error.message };
  }
}

/**
 * Every path the manifest points at, as `{ key, value, shape }` where shape is
 * 'path', 'bundle-url', or 'inline'.
 */
export function componentPaths(manifest) {
  const found = [];
  const push = (key, value, kind) => {
    if (typeof value === 'string') {
      found.push({ key, value, kind, shape: kind === 'bundle' && /^https?:\/\//.test(value) ? 'bundle-url' : 'path' });
    } else if (Array.isArray(value)) {
      for (const item of value) push(key, item, kind);
    } else if (value && typeof value === 'object') {
      if (kind === 'commands-map') {
        for (const [name, spec] of Object.entries(value)) {
          if (spec && typeof spec === 'object' && typeof spec.source === 'string') {
            found.push({ key: `commands.${name}`, value: spec.source, kind: 'file', shape: 'path' });
          }
        }
      } else {
        found.push({ key, value, kind, shape: 'inline' });
      }
    }
  };
  if (!manifest || typeof manifest !== 'object') return found;

  if (manifest.skills !== undefined) push('skills', manifest.skills, 'directory');
  if (manifest.commands !== undefined) push('commands', manifest.commands, 'commands-map');
  if (manifest.agents !== undefined) push('agents', manifest.agents, 'file');
  if (manifest.hooks !== undefined) push('hooks', manifest.hooks, 'file');
  if (manifest.mcpServers !== undefined) push('mcpServers', manifest.mcpServers, 'bundle');
  if (manifest.lspServers !== undefined) push('lspServers', manifest.lspServers, 'file');
  if (manifest.outputStyles !== undefined) push('outputStyles', manifest.outputStyles, 'any');
  if (manifest.workflows !== undefined) push('workflows', manifest.workflows, 'any');
  const experimental = manifest.experimental;
  if (experimental && typeof experimental === 'object') {
    if (experimental.themes !== undefined) push('experimental.themes', experimental.themes, 'any');
    if (experimental.monitors !== undefined) push('experimental.monitors', experimental.monitors, 'file');
    if (experimental.evals !== undefined) push('experimental.evals', experimental.evals, 'any');
  }
  return found;
}

/**
 * Every MCP server the plugin declares, as a Map of name to `{ config, origin }` where
 * origin is the file the declaration lives in, so a finding points at the right file.
 */
export function declaredServers(manifest, scan) {
  const servers = new Map();
  const add = (name, config, origin) => {
    if (config && typeof config === 'object') servers.set(name, { config, origin });
  };
  const absorb = (value, origin) => {
    if (typeof value === 'string') {
      const rel = value.replace(/^\.\//, '');
      const text = scan.textInPlugin(rel);
      if (text) {
        try {
          const parsed = JSON.parse(text);
          for (const [name, config] of Object.entries(parsed.mcpServers ?? parsed)) add(name, config, rel);
        } catch {
          /* the parse failure is reported by the .mcp.json rule */
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) absorb(item, origin);
    } else if (value && typeof value === 'object') {
      for (const [name, config] of Object.entries(value)) add(name, config, origin);
    }
  };
  const mcpText = scan.textInPlugin('.mcp.json');
  if (mcpText) {
    try {
      const parsed = JSON.parse(mcpText);
      // `parsed.mcpServers ?? parsed`, not `?? {}`: a flat file is a server map too.
      const map = parsed.mcpServers ?? parsed;
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        for (const [name, config] of Object.entries(map)) add(name, config, '.mcp.json');
      }
    } catch {
      /* reported by the .mcp.json rule */
    }
  }
  if (manifest && manifest.mcpServers !== undefined) absorb(manifest.mcpServers, MANIFEST_REL);
  return servers;
}

/**
 * A folder with no manifest anywhere but at least one skills/<name>/SKILL.md is still a
 * plugin: the directory accepts it with a note and lists it for Claude Code only.
 */
export function isSkillsOnly(scan) {
  if (scan.fileInPlugin(MANIFEST_REL)) return false;
  return scan.pluginFiles.some((entry) =>
    entry.pluginRel === 'SKILL.md' || /^skills\/[^/]+\/SKILL\.md$/.test(entry.pluginRel ?? ''));
}

export const manifestRules = [
  defineRule({
    id: 'manifest/skills-only',
    section: 'manifest',
    result: 'note',
    what: 'The folder has no manifest, only skills. The directory accepts this and lists the plugin for Claude Code only.',
    fix: 'Add .claude-plugin/plugin.json if the plugin should also appear in chat and Cowork, and to declare a version.',
    limit: 1,
    when: (scan) => isSkillsOnly(scan),
    run(scan) {
      return [{ path: null, detail: `Found ${scan.pluginFiles.filter((entry) => (entry.pluginRel ?? '').endsWith('SKILL.md')).length} skill file(s) and no plugin.json.` }];
    },
  }),

  defineRule({
    id: 'manifest/missing',
    section: 'manifest',
    result: 'block',
    what: 'The plugin folder has no .claude-plugin/plugin.json.',
    fix: `Add ${MANIFEST_REL} with at least a name, a version and a description.`,
    limit: 1,
    when: (scan) => !isSkillsOnly(scan) && !scan.noCommittedPluginFiles,
    run(scan) {
      if (scan.fileInPlugin(MANIFEST_REL)) return [];
      // From the view's own file list, not from the working tree: the report describes the
      // commit, and the sentence has to describe the same thing.
      const hasDirectory = scan.pluginFiles.some((entry) =>
        (entry.pluginRel ?? '').startsWith('.claude-plugin/'));
      return [{
        path: MANIFEST_REL,
        detail: hasDirectory
          ? 'The .claude-plugin folder exists but it holds no plugin.json.'
          : 'The portal reads the plugin folder that contains .claude-plugin/plugin.json; this folder has none.',
      }];
    },
  }),

  defineRule({
    id: 'manifest/unreadable',
    source: 'validate',
    section: 'manifest',
    result: 'block',
    what: 'plugin.json is not valid JSON, so nothing else in the manifest can be checked.',
    fix: 'Fix the JSON syntax, then run "claude plugin validate ." to confirm it loads.',
    limit: 1,
    run(scan) {
      const { text, error } = readManifest(scan);
      if (error === null || error === 'missing') return [];
      if (typeof text === 'string' && text.charCodeAt(0) === 0xfeff) {
        return [{ path: MANIFEST_REL, detail: 'The file starts with a byte order mark, which JSON does not allow.' }];
      }
      return [{ path: MANIFEST_REL, detail: error === 'not-an-object' ? 'The file must hold a JSON object.' : oneLine(error) }];
    },
  }),

  // The manifest reference: `homepage` has to parse as a URL or the plugin fails to load.
  defineRule({
    id: 'manifest/homepage-not-a-url',
    section: 'manifest',
    source: 'manifest-reference',
    result: 'block',
    what: 'The homepage field does not parse as a URL, and a plugin whose homepage does not parse fails to load.',
    fix: 'Write an absolute URL, such as https://example.com/docs.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.homepage !== 'string' || data.homepage === '') return [];
      try {
        new URL(data.homepage);
        return [];
      } catch {
        return [{ path: MANIFEST_REL, detail: `"homepage": "${oneLine(data.homepage, 60)}" is not a URL.` }];
      }
    },
  }),

  defineRule({
    id: 'manifest/name-missing',
    source: 'validate',
    section: 'manifest',
    result: 'block',
    what: 'The manifest has no name, and every component is namespaced under it.',
    fix: 'Set "name" to your kebab-case plugin identifier.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data) return [];
      if (typeof data.name === 'string' && data.name.trim() !== '') return [];
      return [{ path: MANIFEST_REL, detail: data.name === undefined ? 'No "name" key.' : 'The name is not a non-empty string.' }];
    },
  }),

  defineRule({
    id: 'manifest/name-non-ascii',
    section: 'manifest',
    result: 'block',
    title: 'Non-ASCII identifier',
    what: 'The plugin name uses characters outside ASCII.',
    fix: 'Rename the plugin with lowercase ASCII letters, digits and hyphens.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.name !== 'string') return [];
      if (!hasNonAscii(data.name)) return [];
      return [{ path: MANIFEST_REL, detail: `The name "${oneLine(data.name, 60)}" is not ASCII.` }];
    },
  }),

  defineRule({
    id: 'manifest/name-unloadable',
    source: 'validate',
    section: 'manifest',
    result: 'block',
    what: 'The plugin name uses characters that stop Claude Code from loading the plugin.',
    fix: 'Use lowercase letters, digits and hyphens, with no spaces, colons, @ signs or path separators.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.name !== 'string' || data.name === '') return [];
      if (!nameHasBreakingCharacter(data.name)) return [];
      return [{ path: MANIFEST_REL, detail: `The name "${oneLine(data.name, 60)}" holds a space, a separator or a control character.` }];
    },
  }),

  defineRule({
    id: 'manifest/name-pattern',
    section: 'manifest',
    result: 'warning',
    what: 'The plugin name is not kebab-case: lowercase letters, digits and hyphens, up to 64 characters, starting and ending with a letter or digit.',
    fix: 'Rename the plugin, for example "deploy-tools" instead of "Deploy_Tools".',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.name !== 'string' || data.name === '') return [];
      const problems = [];
      // The length limit applies on its own: a 70-character kebab-case name breaks the
      // rule even though every other part of the pattern holds.
      if (data.name.length > 64) problems.push(`it is ${data.name.length} characters long, and the limit is 64`);
      if (problems.length === 0 && KEBAB_RE.test(data.name)) return [];
      if (!KEBAB_SHAPE_RE.test(data.name)) problems.push('it uses characters other than lowercase letters, digits and hyphens');
      if (!/^[a-z0-9]/.test(data.name)) problems.push('it does not start with a letter or a digit');
      if (!/[a-z0-9]$/.test(data.name)) problems.push('it does not end with a letter or a digit');
      return [{ path: MANIFEST_REL, detail: `"${oneLine(data.name, 60)}": ${problems.join('; ')}.` }];
    },
  }),

  defineRule({
    id: 'manifest/name-reserved',
    section: 'manifest',
    result: 'block',
    title: 'Name is taken',
    what: 'The plugin name is a word the directory reserves: claude, anthropic, official, plugin, mcp or test.',
    fix: 'Build the name around your own product or project name.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.name !== 'string') return [];
      if (!RESERVED_NAMES.has(data.name.toLowerCase())) return [];
      return [{ path: MANIFEST_REL, detail: `"${oneLine(data.name, 60)}" is reserved.` }];
    },
  }),


  defineRule({
    id: 'manifest/name-generic',
    section: 'manifest',
    result: 'hold',
    title: 'Name may be confused with an existing listing',
    what: 'The plugin name is built only from generic words.',
    fix: 'Add your own distinctive product or project name to the plugin name.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || typeof data.name !== 'string') return [];
      // A reserved word is already reported as a block, and saying it twice helps nobody.
      if (RESERVED_NAMES.has(data.name.toLowerCase())) return [];
      const words = data.name.toLowerCase().split(/[-_]+/).filter(Boolean);
      if (words.length === 0 || !words.every((word) => GENERIC_WORDS.has(word))) return [];
      return [{
        path: MANIFEST_REL,
        detail: `"${oneLine(data.name, 60)}" is made only of generic words (${words.join(', ')}).`,
      }];
    },
  }),

  defineRule({
    id: 'manifest/identity-hazards',
    section: 'manifest',
    result: 'block',
    what: 'displayName or author.name mixes writing systems, hides invisible characters, or uses look-alike letters.',
    fix: 'Write each name in one writing system with plain characters.',
    limit: 5,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data) return [];
      const fields = [
        ['displayName', typeof data.displayName === 'string' ? data.displayName : null],
        ['author.name', data.author && typeof data.author === 'object' && typeof data.author.name === 'string' ? data.author.name : null],
      ];
      const hits = [];
      for (const [label, value] of fields) {
        if (!value) continue;
        const hazards = nameHazards(value);
        if (hazards.length === 0) continue;
        hits.push({
          path: MANIFEST_REL,
          detail: `"${label}" = "${oneLine(value, 50)}": ${hazards.map((h) => h.label).join('; ')}.`,
        });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'manifest/component-key-misspelled',
    section: 'manifest',
    result: 'block',
    what: 'A key that declares a component is spelled differently from the reference, so the component never loads.',
    fix: 'Spell the key exactly as the manifest reference does.',
    limit: 5,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data) return [];
      const hits = [];
      for (const key of Object.keys(data)) {
        if (KNOWN_TOP_LEVEL.has(key)) continue;
        const folded = key.toLowerCase().replace(/[_-]/g, '');
        const near = [...KNOWN_TOP_LEVEL].find(
          (known) => known.toLowerCase().replace(/[_-]/g, '') === folded,
        );
        if (near) {
          hits.push({ path: MANIFEST_REL, detail: `"${key}" should be "${near}".` });
        }
      }
      return hits;
    },
  }),


  defineRule({
    id: 'manifest/component-in-experimental',
    section: 'manifest',
    result: 'block',
    what: 'A component key sits inside "experimental", where Claude Code does not look for it.',
    fix: 'Move the key to the top level of plugin.json.',
    limit: 5,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || !data.experimental || typeof data.experimental !== 'object') return [];
      return COMPONENT_KEYS.filter((key) => key in data.experimental)
        .map((key) => ({ path: MANIFEST_REL, detail: `"experimental.${key}" is not read.` }));
    },
  }),

  // The table has one row about component paths: "point every component path in plugin.json
  // inside it | Blocks for a plugin.json path that points outside the plugin folder". That
  // is the rule below. Whether the path exists, whether it is a file or a folder and
  // whether it starts with "./" are schema checks that `claude plugin validate` reports,
  // and reading them here meant reading the working tree instead of the commit.
  defineRule({
    id: 'manifest/component-path-outside',
    section: 'manifest',
    result: 'block',
    what: 'A component path points outside the plugin folder.',
    fix: 'Keep every file the plugin loads inside the plugin folder and write the path relative to it.',
    limit: 10,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data) return [];
      const hits = [];
      for (const { key, value, shape } of componentPaths(data)) {
        if (shape === 'inline' || shape === 'bundle-url') continue;
        const path = String(value);
        const escapes = path.split(/[/\\]/).includes('..')
          || /^[A-Za-z]:/.test(path)
          || path.startsWith('/')
          || path.startsWith('~');
        if (escapes) {
          hits.push({ path: MANIFEST_REL, detail: `"${key}" = "${oneLine(value, 60)}" points outside the plugin folder.` });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'manifest/author-shape',
    source: 'manifest-reference',
    section: 'manifest',
    result: 'warning',
    what: 'author is not an object with a name.',
    fix: 'Write "author": { "name": "Your name or team" }.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data || data.author === undefined) return [];
      const author = data.author;
      if (author && typeof author === 'object' && !Array.isArray(author) && typeof author.name === 'string' && author.name.trim()) {
        return [];
      }
      return [{ path: MANIFEST_REL, detail: `author is ${Array.isArray(author) ? 'an array' : typeof author}.` }];
    },
  }),

  defineRule({
    id: 'manifest/missing-metadata',
    section: 'manifest',
    result: 'warning',
    what: 'The manifest leaves out description, author or version.',
    fix: 'Set all three; the directory shows the description in your listing and uses the version to detect releases.',
    limit: 1,
    run(scan) {
      const { data, error } = readManifest(scan);
      if (error || !data) return [];
      const missing = ['description', 'author', 'version'].filter((key) => data[key] === undefined || data[key] === '');
      if (missing.length === 0) return [];
      return [{ path: MANIFEST_REL, detail: `Missing: ${missing.join(', ')}.` }];
    },
  }),

  // Not in the checklist: the directory's validator reports a missing icon as a warning.
  defineRule({
    id: 'manifest/icon-missing',
    section: 'manifest',
    source: 'validator',
    result: 'warning',
    what: 'The plugin has no icon: there is no .claude-plugin/icon.svg and plugin.json sets no icon.',
    fix: 'Add .claude-plugin/icon.svg (square, at least 128 px) or set icon in plugin.json; without it the publisher\'s avatar is used.',
    limit: 1,
    when: (scan) => !isSkillsOnly(scan) && !scan.noCommittedPluginFiles,
    run(scan) {
      const { data, error } = readManifest(scan);
      // Without a readable manifest there is nothing to set an icon in, and the manifest rules
      // already say what is wrong.
      if (error || !data) return [];
      if (scan.fileInPlugin(ICON_REL)) return [];
      if (typeof data.icon === 'string' && data.icon.trim() !== '') return [];
      return [{ path: ICON_REL, detail: 'No .claude-plugin/icon.svg, and plugin.json has no icon.' }];
    },
  }),
];