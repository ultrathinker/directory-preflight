/**
 * Hooks, skills, commands, and agents.
 * Mirrors the "Hooks, skills, commands, and agents" table of the checklist.
 */

import path from 'node:path';
import { defineRule } from '../lib/registry.mjs';
import { readManifest } from './manifest.mjs';
import { collectHookSources, iterateHandlers, HOOK_EVENTS, HOOK_TYPES } from '../lib/hooks.mjs';
import { parseFrontMatter, describeFrontMatter } from '../lib/frontmatter.mjs';
import { oneLine, toPosix } from '../lib/util.mjs';

const EVENT_SET = new Set(HOOK_EVENTS);
/** Component folders, spelled the way Claude Code reads them. */
const COMPONENT_FOLDERS = ['skills', 'commands', 'agents', 'hooks', 'output-styles', 'workflows', 'monitors', 'themes'];
/** Files that carry front matter. */
const FRONT_MATTER_FOLDERS = ['skills', 'commands', 'agents'];

function isHookHttpUrl(url) {
  if (typeof url !== 'string') return 'has no url';
  try {
    return new URL(url).protocol === 'https:' ? null : 'its url is not https';
  } catch {
    return 'its url is not absolute';
  }
}

/** Every directory that holds a plugin file, relative to the plugin root. */
function pluginDirectories(scan) {
  const directories = new Set();
  for (const entry of scan.pluginFiles) {
    let dir = path.posix.dirname(entry.pluginRel);
    while (dir !== '.' && dir !== '/') {
      directories.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return directories;
}

export const componentRules = [
  defineRule({
    id: 'components/hooks-json-invalid',
    section: 'components',
    result: 'block',
    title: 'hooks.json is invalid',
    what: 'A hooks file does not parse, is missing its top-level "hooks" object, uses an unknown event or handler type, or sends an HTTP hook to a URL that is not https.',
    fix: 'Fix the file and compare it with the hooks reference; a malformed hooks file stops the plugin from loading.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const hits = [];
      for (const source of collectHookSources(scan, data)) {
        if (source.error) {
          hits.push({ path: source.rel, detail: `${source.origin}: ${oneLine(source.error)}` });
          continue;
        }
        const body = source.data?.hooks;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          hits.push({
            path: source.rel,
            detail: `${source.origin}: the file has no top-level "hooks" object, so none of it loads.`,
          });
          continue;
        }
        for (const event of Object.keys(body)) {
          if (!EVENT_SET.has(event)) {
            hits.push({ path: source.rel, detail: `${source.origin}: "${event}" is not a hook event.` });
          }
        }
        for (const { event, handler, handlerIndex } of iterateHandlers(source.data, source.rel)) {
          if (!handler || typeof handler !== 'object') {
            hits.push({ path: source.rel, detail: `${event} handler ${handlerIndex + 1} is not an object.` });
            continue;
          }
          if (typeof handler.type !== 'string' || !HOOK_TYPES.has(handler.type)) {
            hits.push({
              path: source.rel,
              detail: `${event} handler ${handlerIndex + 1}: type ${handler.type === undefined ? 'is missing' : `"${handler.type}" is not a handler type`}.`,
            });
            continue;
          }
          if (handler.type === 'http') {
            const problem = isHookHttpUrl(handler.url);
            if (problem) hits.push({ path: source.rel, detail: `${event} handler ${handlerIndex + 1} (http): ${problem}.` });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'components/hooks-json-declared',
    section: 'components',
    result: 'warning',
    what: 'The manifest lists hooks/hooks.json in its "hooks" field, which Claude Code already loads on its own.',
    fix: 'Remove hooks/hooks.json from the manifest "hooks" field.',
    limit: 1,
    run(scan) {
      const { data } = readManifest(scan);
      if (!data || data.hooks === undefined) return [];
      const declared = JSON.stringify(data.hooks);
      return declared.includes('hooks/hooks.json')
        ? [{ path: '.claude-plugin/plugin.json', detail: '"hooks" points at hooks/hooks.json, which is loaded automatically.' }]
        : [];
    },
  }),

  defineRule({
    id: 'components/frontmatter-broken',
    section: 'components',
    result: 'block',
    what: 'A skill, command or agent file has front matter that does not parse, or a description that is not a single text value.',
    fix: 'Write the front matter as "key: value" lines and keep description on one line as text.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const { entry, text, rel } of componentFiles(scan)) {
        const described = describeFrontMatter(parseFrontMatter(text));
        if (described.state === 'broken') {
          hits.push({ path: rel, detail: `The front matter does not parse: ${described.error}.` });
        } else if (described.state === 'list') {
          hits.push({ path: rel, detail: '"description" is a list; the directory requires a single text value.' });
        } else if (described.state === 'not-text') {
          hits.push({ path: rel, detail: `"description" has the value ${oneLine(described.value ?? 'a mapping', 40)}, which YAML reads as something other than text.` });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'components/frontmatter-missing',
    section: 'components',
    result: 'warning',
    what: 'A skill, command or agent file has no front matter, or no description in it.',
    fix: 'Add front matter with at least a "description" line.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const { text, rel } of componentFiles(scan)) {
        const described = describeFrontMatter(parseFrontMatter(text));
        if (described.state === 'absent') hits.push({ path: rel, detail: 'No YAML front matter.' });
        else if (described.state === 'no-description') hits.push({ path: rel, detail: 'No "description" in the front matter.' });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'components/folder-spelling',
    section: 'components',
    result: 'block',
    what: 'A component folder or file is spelled differently from what Claude Code expects, so the component never loads.',
    fix: 'Use skills/<name>/SKILL.md, commands/<name>.md, agents/<name>.md and hooks/hooks.json exactly.',
    limit: 10,
    run(scan) {
      const hits = [];
      const directories = pluginDirectories(scan);
      const misspelled = new Set();
      for (const dir of directories) {
        const first = dir.split('/')[0];
        if (misspelled.has(first)) continue;
        const wanted = COMPONENT_FOLDERS.find((folder) => folder === first.toLowerCase())
          ?? (first.toLowerCase() === '.claude-plugin' ? '.claude-plugin' : null);
        if (wanted && first !== wanted) {
          misspelled.add(first);
          hits.push({ path: `${first}/`, detail: `"${first}" should be spelled "${wanted}".` });
        }
      }
      for (const entry of scan.pluginFiles) {
        const rel = entry.pluginRel ?? '';
        const parts = rel.split('/');
        if (parts[0] === 'skills') {
          if (parts.length === 2 && entry.ext === '.md' && parts[1].toLowerCase() === 'skill.md') {
            hits.push({ path: rel, detail: 'A skill is a folder with SKILL.md inside it, not a file directly under skills/.' });
          } else if (parts.length === 3 && parts[2].toLowerCase() === 'skill.md' && parts[2] !== 'SKILL.md') {
            hits.push({ path: rel, detail: `"${parts[2]}" should be spelled "SKILL.md".` });
          }
        }
      }
      return hits;
    },
  }),

  // A folder under skills/ with no SKILL.md is not a spelling problem and the checklist
  // does not list it: Claude Code simply does not load it as a skill. A note, not a block.
  defineRule({
    id: 'components/folder-is-not-a-skill',
    section: 'components',
    result: 'note',
    what: 'A folder under skills/ has no SKILL.md, so Claude Code does not load it as a skill.',
    fix: 'Add a SKILL.md to the folder, or move the folder out of skills/.',
    limit: 5,
    run(scan) {
      return [...pluginDirectories(scan)]
        .filter((dir) => {
          const parts = dir.split('/');
          return parts.length === 2 && parts[0] === 'skills'
            && !scan.pluginFiles.some((entry) => entry.pluginRel === `${dir}/SKILL.md`);
        })
        .map((dir) => ({ path: `${dir}/`, detail: 'No SKILL.md in this folder.' }));
    },
  }),

  ];

/**
 * The files Claude Code loads as a skill, a command or an agent:
 * `skills/<name>/SKILL.md`, anything under `commands/`, anything under `agents/`.
 *
 * Reference material a skill keeps beside its SKILL.md is not a component, and neither is
 * a template or an example. Checking front matter on those produced a wall of warnings on
 * plugins that are perfectly valid.
 */
export function isComponentFile(pluginRel) {
  const parts = toPosix(pluginRel).split('/');
  if (parts[0] === 'skills') return parts.length === 3 && parts[2] === 'SKILL.md';
  if (parts[0] === 'commands' || parts[0] === 'agents') {
    return parts.length >= 2 && parts[parts.length - 1].endsWith('.md');
  }
  return false;
}

/** Skill, command and agent Markdown files, with their text. */
function componentFiles(scan) {
  const found = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.ext !== '.md' || entry.size > scan.limits.maxTextBytes) continue;
    const rel = toPosix(entry.pluginRel ?? '');
    if (!isComponentFile(rel)) continue;
    const text = scan.readText(entry);
    if (text === null) continue;
    found.push({ entry, rel, text });
  }
  return found;
}