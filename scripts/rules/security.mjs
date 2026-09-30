/**
 * Security scan readiness.
 *
 * The directory runs a security scan after you submit, and it is not public. Everything in
 * this file is a heuristic that looks for the categories the documentation names: data sent
 * to an undisclosed destination, hidden or encoded instructions, changes to Claude's
 * permission settings, and code no reader can follow. A clean result here is not a pass.
 */

import { defineRule } from '../lib/registry.mjs';
import { readManifest, declaredServers } from './manifest.mjs';
import { markdownCodeSpans, oneLine, INVISIBLE_RANGES } from '../lib/util.mjs';

const RUNNABLE_EXTENSIONS = ['.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.js', '.mjs', '.cjs', '.py', '.rb', '.ts'];
const CONFIG_FILES = ['.mcp.json', 'hooks/hooks.json', '.lsp.json', 'settings.json'];
/** Hosts that cannot be a real destination. */
const DOC_HOSTS = new Set([
  'example.com', 'example.org', 'example.net', 'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'www.w3.org', 'w3.org', 'json-schema.org', 'schema.org', 'spdx.org', 'opensource.org',
  'creativecommons.org', 'gnu.org', 'docs.python.org', 'nodejs.org', 'developer.mozilla.org',
]);
const NETWORK_CALL_RE = /\b(?:fetch|axios|got|request|urlopen|urlretrieve|https?\.get|https?\.request|net\.connect|Invoke-WebRequest|Invoke-RestMethod|curl|wget|nc|netcat)\b[^\n;|&]*/g;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'`()<>\[\]{}|]+/gi;

/** Text that can run: whole files for code, only code spans inside Markdown. */
function behaviorSurfaces(scan) {
  const surfaces = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
    if (entry.kind === 'image' || entry.kind === 'font') continue;
    const rel = entry.pluginRel ?? '';
    const text = scan.readText(entry);
    if (text === null) continue;
    const runnable = RUNNABLE_EXTENSIONS.includes(entry.ext) || CONFIG_FILES.includes(rel);
    if (!runnable && entry.ext !== '.md') continue;
    surfaces.push({
      rel,
      entry,
      raw: text,
      behavior: runnable ? text : markdownCodeSpans(text).join('\n'),
    });
  }
  return surfaces;
}

/** The host of a URL, or null. */
function hostOf(url) {
  try {
    return new URL(url.replace(/[.,;:)]+$/, '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDocumentationHost(host) {
  if (DOC_HOSTS.has(host)) return true;
  return /(^|\.)example\.(com|org|net)$/.test(host)
    || host.endsWith('.example') || host.endsWith('.invalid')
    || host.endsWith('.test') || host.endsWith('.local');
}

/** Everything the plugin says about itself, where a destination could be disclosed. */
function disclosureText(scan, manifest) {
  const parts = [];
  for (const entry of scan.pluginFiles) {
    if (entry.ext !== '.md') continue;
    if (!/^readme(\.|$)/i.test(entry.name)) continue;
    const text = scan.readText(entry);
    if (text) parts.push(text);
  }
  if (manifest) {
    parts.push(typeof manifest.description === 'string' ? manifest.description : '');
    parts.push(JSON.stringify(manifest.metadata ?? {}));
  }
  return parts.join('\n').toLowerCase();
}

export const securityRules = [
  defineRule({
    id: 'security/undisclosed-destination',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'Something in the plugin sends data to a host that neither the README nor the manifest mentions.',
    fix: 'Name every destination in the README, or stop sending to it. A plugin that sends data somewhere it does not disclose fails the security scan.',
    limit: 10,
    run(scan) {
      const { data } = readManifest(scan);
      const disclosures = disclosureText(scan, data);
      const hits = [];
      const seen = new Set();
      const report = (rel, url) => {
        const host = hostOf(url);
        if (!host || isDocumentationHost(host) || seen.has(host)) return;
        if (disclosures.includes(host) || disclosures.includes(host.replace(/^www\./, ''))) return;
        seen.add(host);
        hits.push({ path: rel, detail: `Sends data to ${host}, which the README does not mention.` });
      };

      for (const { rel, behavior } of behaviorSurfaces(scan)) {
        if (behavior.trim() === '') continue;
        NETWORK_CALL_RE.lastIndex = 0;
        for (const call of behavior.matchAll(NETWORK_CALL_RE)) {
          URL_RE.lastIndex = 0;
          for (const url of call[0].matchAll(URL_RE)) report(rel, url[0]);
        }
      }
      for (const [name, { config, origin }] of declaredServers(data, scan)) {
        if (config && typeof config.url === 'string') {
          report(origin, config.url.replace(/\$\{user_config\.[A-Za-z0-9_]+\}/g, ''));
          if (config.url.includes('${user_config.')) {
            hits.push({
              path: origin,
              detail: `Server "${name}" points at an endpoint the user configures; say so in the README.`,
            });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'security/hidden-characters',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'A file holds invisible or direction-changing characters, which can hide instructions from a reader.',
    fix: 'Remove the characters. If they are not yours, treat the file as untrusted.',
    limit: 10,
    run(scan) {
      const hits = [];
      // Every file, not only the ones that can run: a hidden instruction in a manifest or a
      // README is exactly as hidden.
      for (const entry of scan.pluginFiles) {
        if (entry.missing || entry.kind === 'image' || entry.kind === 'font') continue;
        const text = scan.readText(entry);
        if (text === null) continue;
        const found = invisibleCharacters(text);
        if (found.length > 0) {
          hits.push({ path: entry.repoRel, detail: `Contains ${found.join(', ')}.` });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'security/encoded-blob',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'A file holds a long encoded block that decodes to readable text.',
    fix: 'Commit readable source, or explain in the README what the block is and why it is encoded.',
    limit: 10,
    run(scan) {
      const hits = [];
      // The whole file, not just its code: an encoded block in the prose of a skill is
      // exactly the case this looks for.
      for (const { rel, raw } of behaviorSurfaces(scan)) {
        if (raw.trim() === '') continue;
        const blob = findEncodedBlob(raw);
        if (blob) hits.push({ path: rel, detail: `${blob} characters of encoded text that decode to readable content.` });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'security/hidden-instruction-comment',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'An HTML comment inside a skill, command or agent file carries instruction-shaped text.',
    fix: 'Delete the comment. Comments are invisible in the rendered file, so a reader never sees them.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const { rel, raw, entry } of behaviorSurfaces(scan)) {
        if (entry.ext !== '.md') continue;
        for (const comment of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
          if (/\b(ignore|do not|don't|must|always|never|instead|override|system|instruction|secretly|without telling)\b/i.test(comment[1])) {
            hits.push({ path: rel, detail: `Comment reads: "${oneLine(comment[1].trim(), 80)}"` });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'security/permission-change',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'Something in the plugin changes Claude Code permission settings or turns permission checks off.',
    fix: 'Remove it. A plugin that changes permissions without saying so fails the security scan.',
    limit: 10,
    run(scan) {
      const hits = [];
      const patterns = [
        [new RegExp(`--dangerously-${'skip'}-permissions\\b`), `passes --dangerously-${'skip'}-permissions`],
        [new RegExp(`\\benable${'All'}ProjectMcpServers\\b`), `sets enable${'All'}ProjectMcpServers`],
        [new RegExp(`\\bbypass${'Permissions'}\\b`), `sets the bypass${'Permissions'} mode`],
        [/["']?permissions["']?\s*:\s*\{[^}]*["']?allow["']?/s, 'writes a permissions allow list'],
      ];
      for (const { rel, behavior } of behaviorSurfaces(scan)) {
        if (behavior.trim() === '') continue;
        for (const [re, description] of patterns) {
          const match = re.exec(behavior);
          if (!match) continue;
          const writesSettings = /settings\.json/.test(behavior) || /permissions/.test(rel) || rel.endsWith('.json');
          if (description.startsWith('writes a permissions allow list') && !writesSettings) continue;
          hits.push({ path: rel, detail: `The file ${description}.` });
          break;
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'security/unreadable-code',
    section: 'security',
    source: 'tool',
    doc: 'https://claude.com/docs/plugins/pre-submission-checklist#prepare-for-the-security-scan',
    result: 'block',
    heuristic: true,
    what: 'A file holds code no reader can follow: one very long line, or a generated bundle.',
    fix: 'Commit readable source. Code the security scan cannot read is held for a reviewer.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const { rel, entry, behavior } of behaviorSurfaces(scan)) {
        if (!RUNNABLE_EXTENSIONS.includes(entry.ext)) continue;
        if (/\.min\./.test(rel)) {
          hits.push({ path: rel, detail: 'A minified file.' });
          continue;
        }
        const lines = behavior.split(/\r?\n/);
        const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
        const average = behavior.length / Math.max(1, lines.length);
        if (longest > 1000 || (average > 300 && behavior.length > 8192)) {
          hits.push({
            path: rel,
            detail: `Longest line ${longest} characters, average ${Math.round(average)}; this looks generated or packed.`,
          });
        }
      }
      return hits;
    },
  }),
];

/**
 * The invisible and direction-changing characters in a string, as readable labels.
 *
 * One list, shared with the name checks. Two exceptions that are not hiding anything: a
 * byte order mark at the very start of a file, and a zero-width joiner or a variation
 * selector inside an emoji, which is how every multi-part emoji is written.
 */
export function invisibleCharacters(text) {
  // Work in code points, not code units: an emoji is two units, so arithmetic on string
  // offsets lands in the middle of one and reads a surrogate half instead of the character.
  const points = [...text];
  const codeAt = (index) => (points[index] === undefined ? NaN : points[index].codePointAt(0));
  const found = [];
  points.forEach((char, index) => {
    const code = char.codePointAt(0);
    const range = INVISIBLE_RANGES.find(([from, to]) => code >= from && code <= to);
    if (!range) return;
    const joinsAnEmoji = (code === 0x200d || code === 0xfe0f)
      && isEmoji(codeAt(index - 1)) && isEmoji(codeAt(index + 1));
    const isLeadingBom = code === 0xfeff && index === 0;
    if (!joinsAnEmoji && !isLeadingBom) {
      found.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')} (${range[2]})`);
    }
  });
  return [...new Set(found)];
}

/** Rough emoji test, enough to tell a joined emoji from a hidden joiner. */
function isEmoji(codePoint) {
  if (!Number.isFinite(codePoint)) return false;
  return (codePoint >= 0x1f000 && codePoint <= 0x1faff)
    || (codePoint >= 0x2600 && codePoint <= 0x27bf)
    || (codePoint >= 0x2190 && codePoint <= 0x21ff)
    || codePoint === 0x2764 || codePoint === 0xfe0f;
}

/** A long base64 or hex run that decodes to mostly readable text. */
export function findEncodedBlob(text) {
  for (const match of text.matchAll(/[A-Za-z0-9+/]{160,}={0,2}/g)) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (/sha(?:256|384|512)-|integrity/i.test(before)) continue;
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf8');
      const printable = [...decoded].filter((char) => char === '\n' || char === '\t' || (char >= ' ' && char <= '~')).length;
      if (decoded.length > 80 && printable / decoded.length > 0.9) return match[0].length;
    } catch {
      /* not base64 after all */
    }
  }
  for (const match of text.matchAll(/\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){60,}/g)) {
    return match[0].length;
  }
  return null;
}