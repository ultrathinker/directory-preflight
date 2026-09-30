/**
 * A small YAML front matter reader for skill, command and agent files.
 *
 * The directory only cares that the block parses and that `description` is a single text
 * value rather than a list, so this reader understands exactly the subset those files use:
 * top-level `key: value` pairs, block scalars, inline lists and indented list items.
 */

const KEY_RE = /^([A-Za-z0-9_.-]+):(?:[ \t](.*))?$/;
/** Scalar shapes YAML gives a type other than a string: a number, a boolean, a null. */
const NON_STRING_SCALARS = new Set(['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off']);
/** A plain scalar that YAML rejects: a colon or a comment marker inside it. */
const PLAIN_SCALAR_HAZARD = /:[ \t]|[ \t]#/;

/** Read the front matter of a Markdown file into `{ present, error, data }`. */
export function parseFrontMatter(text) {
  // A byte order mark before the first --- would hide the block from a strict reader.
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { present: false, error: null, data: {} };

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === '---' || line === '...') {
      end = index;
      break;
    }
  }
  if (end === -1) return { present: true, error: 'the front matter block is never closed with "---"', data: {} };

  const data = {};
  let currentKey = null;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (/^\t/.test(line) || /^[ ]*\t/.test(line)) {
      return { present: true, error: `line ${index + 1} is indented with a tab`, data };
    }
    if (/^\s/.test(line)) {
      if (currentKey === null) {
        return { present: true, error: `line ${index + 1} is indented but follows no key`, data };
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed === '-') {
        data[currentKey].items.push(trimmed.slice(2).trim());
      } else if (data[currentKey].kind === 'unknown') {
        // A plain scalar continued on the next line, which YAML allows.
        data[currentKey].value = `${data[currentKey].value} ${trimmed}`.trim();
      }
      continue;
    }

    const match = KEY_RE.exec(line);
    if (!match) return { present: true, error: `line ${index + 1} is not a "key: value" pair`, data };
    const [, key, rawValue = ''] = match;
    const value = rawValue.trim();
    currentKey = key;
    if (value === '') {
      data[key] = { kind: 'unknown', value: '', items: [] };
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) return { present: true, error: `line ${index + 1} opens a list that never closes`, data };
      data[key] = { kind: 'list', value, items: value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean) };
    } else if (value === '|' || value === '>' || /^[|>][-+]?\d*$/.test(value)) {
      data[key] = { kind: 'scalar', value: '', items: [], block: true };
    } else if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (!value.endsWith(quote) || value.length < 2) {
        return { present: true, error: `line ${index + 1} opens a quoted value that never closes`, data };
      }
      data[key] = { kind: 'scalar', value: value.slice(1, -1), items: [] };
    } else if (NON_STRING_SCALARS.has(value.toLowerCase()) || /^-?\d+(?:\.\d+)?$/.test(value)) {
      // YAML reads these as a boolean, a null or a number, not as text.
      data[key] = { kind: 'non-string', value, items: [] };
    } else if (value.startsWith('{') || value.endsWith('}')) {
      if (!(value.startsWith('{') && value.endsWith('}'))) {
        return { present: true, error: `line ${index + 1} opens a mapping that never closes`, data };
      }
      data[key] = { kind: 'mapping', value, items: [] };
    } else if (PLAIN_SCALAR_HAZARD.test(value)) {
      // "Use this: it rebuilds the index" is a YAML error in a plain scalar, and it is a
      // sentence a description is very likely to contain.
      return {
        present: true,
        error: `line ${index + 1} has ": " or " #" inside an unquoted value, which YAML reads as a mapping or a comment; quote the value`,
        data,
      };
    } else {
      data[key] = { kind: 'scalar', value, items: [] };
    }
  }

  for (const [key, entry] of Object.entries(data)) {
    if (entry.kind === 'unknown') {
      entry.kind = entry.items.length > 0 ? 'list' : 'scalar';
    }
    if (key in data && entry.kind === 'scalar' && entry.items.length > 0) entry.kind = 'list';
  }

  return { present: true, error: null, data };
}

/** Does this front matter carry a single-string description? */
export function describeFrontMatter(parsed) {
  if (!parsed.present) return { state: 'absent' };
  if (parsed.error) return { state: 'broken', error: parsed.error };
  const description = parsed.data.description;
  if (!description) return { state: 'no-description' };
  if (description.kind === 'list') return { state: 'list' };
  if (description.kind === 'non-string' || description.kind === 'mapping') {
    return { state: 'not-text', value: description.value };
  }
  if (description.kind === 'scalar' && description.value.trim() === '' && !description.block) {
    return { state: 'no-description' };
  }
  return { state: 'ok' };
}