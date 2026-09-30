/**
 * Hook configuration: the events and handler types Claude Code knows, and a reader for
 * every place a plugin can declare hooks (hooks/hooks.json and the manifest's `hooks` key).
 */

export const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated',
  'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange',
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'Elicitation',
  'ElicitationResult', 'SessionEnd',
];

export const HOOK_TYPES = new Set(['command', 'http', 'mcp_tool', 'prompt', 'agent']);

/**
 * Read every hook source: `hooks/hooks.json`, plus each `.json` path and inline object the
 * manifest's `hooks` key declares.
 */
export function collectHookSources(scan, manifest) {
  const sources = [];
  const fromFile = scan.textInPlugin('hooks/hooks.json');
  if (fromFile !== null) {
    sources.push({ rel: 'hooks/hooks.json', text: fromFile, origin: 'hooks/hooks.json' });
  }
  const declared = manifest?.hooks;
  const add = (value) => {
    if (typeof value === 'string') {
      const rel = value.replace(/^\.\//, '');
      const text = scan.textInPlugin(rel);
      if (text !== null) sources.push({ rel, text, origin: `plugin.json hooks: ${value}` });
    } else if (Array.isArray(value)) {
      for (const item of value) add(item);
    } else if (value && typeof value === 'object') {
      // An inline value in the manifest is the events themselves, with no "hooks" wrapper.
      sources.push({
        rel: '.claude-plugin/plugin.json',
        text: null,
        data: { hooks: value },
        origin: 'plugin.json hooks (inline)',
        inline: true,
      });
    }
  };
  if (declared !== undefined) add(declared);

  // A manifest that points at hooks/hooks.json would otherwise be read twice.
  const seen = new Set();
  const unique = sources.filter((source) => {
    if (source.text === null) return true;
    if (seen.has(source.rel)) return false;
    seen.add(source.rel);
    return true;
  });

  return unique.map((source) => {
    if (source.data) return { ...source, data: source.data, error: null };
    try {
      const data = JSON.parse(source.text);
      return { ...source, data, error: null };
    } catch (error) {
      return { ...source, data: null, error: error.message };
    }
  });
}

/**
 * Walk a hooks document as `{ event, group, handler, where }` for every handler. The
 * document must carry the top-level "hooks" object; a file that writes the events at the
 * top level is invalid, and silently reading it would hide that.
 */
export function iterateHandlers(data, where) {
  const found = [];
  const hooks = data && typeof data === 'object' ? data.hooks : null;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return found;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      const handlers = group && typeof group === 'object' && Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((handler, handlerIndex) => {
        found.push({ event, groupIndex, handlerIndex, group, handler, where });
      });
    });
  }
  return found;
}