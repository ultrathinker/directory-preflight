/**
 * Files in the plugin folder.
 * Mirrors the "Files in the plugin folder" table of the pre-submission checklist.
 */

import path from 'node:path';
import { defineRule } from '../lib/registry.mjs';
import { IMAGE_EXTENSIONS, FONT_EXTENSIONS } from '../lib/scan.mjs';
import { humanSize, looksBinary, markdownCodeSpans, oneLine } from '../lib/util.mjs';

const BUNDLE_EXTENSIONS = ['.mcpb', '.dxt'];

/**
 * Extensions the checklist names as binaries: "any other binary file, such as an .ico,
 * .pdf, or .zip file or a compiled executable". The extension is the signal that works on
 * a file too large to read, and the bytes are the signal that works on a file whose
 * extension lies.
 */
const BINARY_EXTENSIONS = new Set([
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.pdf', '.ico',
  '.exe', '.dll', '.so', '.dylib', '.dmg', '.msi', '.deb', '.rpm', '.class', '.pyc',
  '.wasm', '.node', '.o', '.a', '.lib', '.bin', '.img', '.iso',
]);
const UNINSPECTABLE_TITLE = 'Files or downloads the validator couldn’t inspect';

/** Files that hold a runnable component and are worth reading for embedded paths. */
const RUNNABLE_DIRS = ['commands/', 'skills/', 'agents/', 'hooks/', 'scripts/', 'bin/'];

function isImageOrFont(entry) {
  return entry.kind === 'image' || entry.kind === 'font';
}

export const filesRules = [
  defineRule({
    id: 'files/oversized',
    section: 'files',
    result: 'hold',
    title: UNINSPECTABLE_TITLE,
    what: 'A file that is not an image or a font is 256 KiB or larger.',
    fix: 'Shrink the file, generate it at run time, or move it into ${CLAUDE_PLUGIN_DATA} on first use.',
    limit: 10,
    run(scan) {
      return scan.pluginFiles
        .filter((entry) => !entry.missing && !isImageOrFont(entry) && entry.size >= scan.limits.maxFileSizeBytes)
        .map((entry) => ({ path: entry.repoRel, detail: `The file is ${humanSize(entry.size)}.` }));
    },
  }),

  defineRule({
    id: 'files/too-many',
    section: 'files',
    result: 'hold',
    title: UNINSPECTABLE_TITLE,
    what: 'The plugin folder holds more than 512 files.',
    fix: 'Remove generated files, or move data a user installs into ${CLAUDE_PLUGIN_DATA}.',
    limit: 1,
    run(scan) {
      if (scan.pluginFiles.length <= scan.limits.maxPluginFiles) return [];
      return [{ path: null, detail: `The plugin folder holds ${scan.pluginFiles.length} files.` }];
    },
  }),

  defineRule({
    id: 'files/binary',
    section: 'files',
    result: 'hold',
    title: UNINSPECTABLE_TITLE,
    what: 'A file in the plugin folder is a binary that is not a PNG, JPEG, GIF, WebP, SVG or font.',
    fix: 'Remove the binary, commit readable source instead, or download the tool at run time.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const entry of scan.pluginFiles) {
        if (entry.missing || entry.size === 0) continue;
        if (isImageOrFont(entry)) continue;
        if (entry.ext === '.mcpb' || entry.ext === '.dxt') continue;
        // The extension first, because that works however large the file is; then the
        // first bytes, whatever the size, for a binary whose extension says otherwise.
        if (BINARY_EXTENSIONS.has(entry.ext)) {
          hits.push({
            path: entry.repoRel,
            detail: `The checklist names ${entry.ext} files as binaries that are not images, fonts or text.`,
          });
          continue;
        }
        const head = scan.probeBytes(entry, 8192);
        if (head && looksBinary(head)) {
          hits.push({
            path: entry.repoRel,
            detail: `Binary content in a ${entry.ext || 'file with no extension'} file.`,
          });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'files/bundled-mcp-server',
    section: 'files',
    result: 'hold',
    title: 'Bundled MCP server not inspected',
    what: 'The plugin declares an MCP server as a .mcpb or .dxt bundle.',
    fix: 'Declare the server with "command" and "args", or with "url", instead of a bundle.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const entry of scan.pluginFiles) {
        if (BUNDLE_EXTENSIONS.includes(entry.ext)) {
          hits.push({ path: entry.repoRel, detail: 'A bundled MCP server is shipped in the plugin folder.' });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'files/bundled-mcp-server-url',
    section: 'files',
    result: 'block',
    title: 'Bundled MCP server not inspected',
    what: 'The plugin fetches an MCP server bundle from a URL.',
    fix: 'Declare the server with "command" and "args", or with "url", instead of a bundle.',
    limit: 10,
    run(scan) {
      const text = scan.textInPlugin('.claude-plugin/plugin.json') ?? scan.textAt('.claude-plugin/plugin.json');
      if (!text) return [];
      const hits = [];
      const re = new RegExp(`https?://[^"'\\s]+\\.(${BUNDLE_EXTENSIONS.map((e) => e.slice(1)).join('|')})`, 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        hits.push({ path: '.claude-plugin/plugin.json', detail: `The manifest fetches ${oneLine(match[0], 80)}.` });
      }
      return hits;
    },
  }),

  defineRule({
    id: 'files/image-referenced-from-code',
    section: 'files',
    result: 'hold',
    what: 'A bundled image or font is referred to from a command, a hook or a script, or written inside a code block or backticks.',
    fix: 'Show a bundled image with Markdown image syntax in the README, and keep its path out of anything that runs.',
    limit: 10,
    run(scan) {
      const assets = scan.pluginFiles.filter((entry) => isImageOrFont(entry) && entry.pluginRel);
      if (assets.length === 0) return [];
      const hits = [];
      const seen = new Set();
      const note = (entry, asset) => {
        const key = `${entry.repoRel}\u0000${asset.pluginRel}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({
          path: entry.repoRel,
          detail: `Refers to the bundled asset "${asset.pluginRel}".`,
        });
      };

      for (const entry of scan.pluginFiles) {
        if (entry.missing || entry.size > scan.limits.maxTextBytes) continue;
        const isReadme = path.basename(entry.pluginRel ?? '') === entry.name
          && /^readme(\.|$)/i.test(entry.name);
        const isRunnable = RUNNABLE_DIRS.some((dir) => (entry.pluginRel ?? '').startsWith(dir));
        if (!isReadme && !isRunnable) continue;
        const text = scan.readText(entry);
        if (text === null) continue;
        const haystack = isReadme ? markdownCodeSpans(text).join('\n') : text;
        if (haystack.trim() === '') continue;
        for (const asset of assets) {
          const base = path.posix.basename(asset.pluginRel);
          if (haystack.includes(asset.pluginRel) || haystack.includes(base)) note(entry, asset);
        }
      }
      return hits;
    },
  }),
];