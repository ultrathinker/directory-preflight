/**
 * Pure helpers shared by the rules. Nothing in this file touches the disk, so every
 * function here is unit-testable on its own.
 */

/** Windows refuses to create these names, with or without an extension. */
const WINDOWS_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const WINDOWS_ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Code points that render as nothing, or that reorder the text around them. One list for
 * every check that needs it: the name rules and the security heuristics read the same
 * ranges, so a character cannot be invisible to one of them and visible to the other.
 */
export const INVISIBLE_RANGES = [
  [0x00ad, 0x00ad, 'soft hyphen'],
  [0x180e, 0x180e, 'Mongolian vowel separator'],
  [0x200b, 0x200f, 'zero-width or direction mark'],
  [0x202a, 0x202e, 'bidirectional embedding or override'],
  [0x2060, 0x2064, 'invisible operator'],
  [0x2066, 0x2069, 'bidirectional isolate'],
  [0xfeff, 0xfeff, 'zero-width no-break space'],
  [0xfff9, 0xfffb, 'interlinear annotation'],
  // The Unicode tag block: the usual way to hide a whole sentence inside a file, because
  // nothing renders it.
  [0xe0000, 0xe007f, 'Unicode tag character'],
];

const SCRIPT_RES = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Han', /\p{Script=Han}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
];

/** Characters that look like a Latin letter but are not one. */
const CONFUSABLE_RE = /[\u0400-\u04ff\u0370-\u03ff\uff21-\uff3a\uff41-\uff5a\u2160-\u217f]/;

/**
 * Count the words in a piece of Markdown, ignoring fenced code blocks.
 * The directory counts README words the same way: words inside code blocks do not count.
 */
export function countWords(markdown) {
  const matches = stripFencedCode(markdown).match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019_-]*/gu);
  return matches ? matches.length : 0;
}

/** Remove fenced code blocks (``` or ~~~), keeping the line structure around them. */
export function stripFencedCode(markdown) {
  const kept = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Why a file or folder name would not survive a checkout on Windows or macOS,
 * or null when the name is fine. Mirrors the directory's "valid on both Windows and macOS" rule.
 */
export function windowsNameProblem(name) {
  if (!name) return 'the name is empty';
  if (WINDOWS_ILLEGAL_CHARS.test(name)) {
    return 'the name contains a character Windows does not allow (: " < > | ? * or a control character)';
  }
  if (/[. ]$/.test(name)) return 'the name ends with a dot or a space';
  const stem = name.split('.')[0].toLowerCase();
  if (WINDOWS_DEVICE_NAMES.has(stem)) {
    return `"${stem}" is a reserved device name on Windows, even with an extension`;
  }
  return null;
}

/** The key two names collide on when a file system is case-insensitive. */
export function caseKey(name) {
  return name.toLowerCase();
}

/** True when the string contains a character outside ASCII. */
export function hasNonAscii(value) {
  return /[^\u0000-\u007f]/.test(value);
}


/**
 * Invisible or direction-changing characters and mixed writing systems in one string.
 * Used for the rule that a name must be written in one writing system with no look-alike letters.
 */
export function nameHazards(value) {
  const hazards = [];
  let index = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    const range = INVISIBLE_RANGES.find(([from, to]) => code >= from && code <= to);
    if (range) {
      hazards.push({
        kind: 'invisible',
        char,
        code,
        index,
        label: range[2],
      });
    }
    index += 1;
  }
  const scripts = SCRIPT_RES.filter(([, re]) => re.test(value)).map(([name]) => name);
  if (scripts.length > 1) {
    hazards.push({ kind: 'mixed-script', label: scripts.join(' and ') });
  }
  if (CONFUSABLE_RE.test(value) && /\p{Script=Latin}/u.test(value)) {
    hazards.push({ kind: 'look-alike', label: 'letters that resemble Latin letters' });
  }
  return hazards;
}

/** Human-readable byte size. */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** A NUL byte in the first block is the cheapest reliable binary signal. */
export function looksBinary(buffer) {
  const end = Math.min(buffer.length, 8192);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Collapse whitespace and cut a string to a length that fits in one report line. */
export function oneLine(value, max = 160) {
  const flat = String(value).replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}\u2026`;
}

/** Join a path for display with forward slashes on every platform. */
export function toPosix(value) {
  return value.split('\\').join('/');
}

/** Every fenced or inline snippet in a Markdown file. */
export function markdownCodeSpans(markdown) {
  const spans = [];
  const fenceRe = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[^\n]*$/gm;
  let match;
  while ((match = fenceRe.exec(markdown)) !== null) spans.push(match[2]);
  const inlineRe = /`([^`\n]+)`/g;
  while ((match = inlineRe.exec(markdown)) !== null) spans.push(match[1]);
  return spans;
}