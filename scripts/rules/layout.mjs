/**
 * Repository and folder layout.
 * Mirrors the "Repository and folder layout" table of the pre-submission checklist.
 */

import path from 'node:path';
import zlib from 'node:zlib';
import { defineRule } from '../lib/registry.mjs';
import { countRepositoryEntries } from '../lib/scan.mjs';
import { humanSize, windowsNameProblem, caseKey, toPosix } from '../lib/util.mjs';

const OS_JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '__macosx']);
const PLUGIN_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
/** Folders whose contents are components: a file hidden in one of them never ships. */
const COMPONENT_DIRECTORIES = new Set([
  'skills', 'commands', 'agents', 'hooks', '.claude-plugin', 'scripts', 'bin', 'output-styles', 'workflows',
]);
const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1';

/** Path segments of a repository-relative path, including the file name. */
function segments(relPath) {
  return relPath.split('/').filter(Boolean);
}

function junkSegment(relPath) {
  return segments(relPath).find((segment) => OS_JUNK.has(segment.toLowerCase())) ?? null;
}

/**
 * System files in the plugin folder, split by whether Git tracks them. Without Git there
 * is no second view, so everything on disk counts as submitted: that is what the
 * directory would read from an uploaded folder.
 */
function junkEntries(scan, wantTracked) {
  const source = wantTracked ? scan.pluginFiles : scan.pluginWorkingFiles;
  return source
    .filter((entry) => wantTracked || !scan.isTracked(entry.repoRel))
    .map((entry) => ({ entry, segment: junkSegment(entry.pluginRel ?? entry.repoRel) }))
    .filter(({ segment }) => segment !== null);
}

/**
 * Every symbolic link the view holds, once each, with the reason. The checklist blocks a
 * link where the plugin loads the entry and only warns elsewhere, so a link at the plugin
 * root or under a folder the plugin loads from is the blocking kind.
 */
function symlinkHits(scan) {
  const seen = new Map();
  for (const entry of scan.files) {
    if (entry.link) seen.set(entry.repoRel, entry);
  }
  for (const entry of scan.diskPluginFiles) {
    if (entry.link && !seen.has(entry.repoRel)) seen.set(entry.repoRel, entry);
  }
  return [...seen.values()].map((entry) => ({ entry, loaded: loadsEntry(entry.pluginRel) }));
}

/**
 * A cache or a build leftover. Hiding one of these from Git is what a repository should
 * do, so it is not a component the plugin lost: warning about `__pycache__` buried the
 * files that really were components.
 */
const CACHE_SEGMENTS = new Set([
  '__pycache__', 'node_modules', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.tox', '.eggs', '.nyc_output', '.parcel-cache', '.turbo',
]);
const CACHE_EXTENSIONS = ['.pyc', '.pyo', '.pyd', '.class', '.o', '.obj', '.swp', '.swo', '.tmp', '.log', '.bak'];

function isCachePath(relPath) {
  const parts = segments(relPath);
  if (parts.some((part) => CACHE_SEGMENTS.has(part.toLowerCase()))) return true;
  if (parts.some((part) => OS_JUNK.has(part.toLowerCase()))) return true;
  const name = parts[parts.length - 1].toLowerCase();
  return name.endsWith('~') || CACHE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Git submodules in the view, with whether the plugin loads an entry through them. */
function submoduleHits(scan) {
  return scan.files
    .filter((entry) => entry.submodule)
    .map((entry) => ({ entry, loaded: loadsEntry(entry.pluginRel) }));
}

/** Files the view holds that are Git LFS pointers, with whether the plugin loads them. */
function lfsHits(scan) {
  const hits = [];
  for (const entry of scan.pluginFiles) {
    if (entry.missing || entry.size > 4096 || entry.size === 0) continue;
    const text = scan.readText(entry, 4096);
    if (text && text.startsWith(LFS_POINTER)) hits.push({ entry, loaded: loadsEntry(entry.pluginRel) });
  }
  return hits;
}

/**
 * Is this a path the plugin loads an entry from? The checklist gives the same split to
 * symbolic links, Git submodules and Git LFS pointers: a block where the plugin loads the
 * entry, a warning elsewhere. The plugin root counts, and so does any folder Claude Code
 * loads a component from.
 */
function loadsEntry(pluginRel) {
  if (pluginRel === null || pluginRel === undefined) return false;
  if (!pluginRel.includes('/')) return true;
  return COMPONENT_DIRECTORIES.has(pluginRel.split('/')[0]);
}

/** Parse a .gitattributes file into `{ pattern, attributes }` records. */
export function parseGitAttributes(text) {
  const records = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      records.push({ pattern: line, attributes: [], macro: true });
      continue;
    }
    const [pattern, ...attributes] = line.split(/\s+/);
    records.push({ pattern, attributes, macro: false });
  }
  return records;
}

function hasAttribute(records, attribute) {
  return records.some((record) =>
    record.attributes.some((token) => token === attribute || token.startsWith(`${attribute}=`)),
  );
}

/** Files whose name or content marks them as something the directory cannot carry. */
export const layoutRules = [
  defineRule({
    id: 'layout/os-junk-file',
    section: 'layout',
    result: 'block',
    title: 'macOS or Windows system file',
    what: 'The plugin folder contains a .DS_Store, Thumbs.db, desktop.ini or __MACOSX entry.',
    fix: 'Remove the file from the repository (git rm --cached then delete it) and add it to .gitignore.',
    limit: 10,
    run(scan) {
      return junkEntries(scan, true).map(({ entry, segment }) => ({
        path: entry.repoRel,
        detail: `"${segment}" is committed to the repository.`,
      }));
    },
  }),

  defineRule({
    id: 'layout/os-junk-file-untracked',
    source: 'tool',
    section: 'layout',
    result: 'note',
    what: 'A system file sits in the plugin folder without being committed.',
    fix: 'Add it to .gitignore so a later commit cannot pick it up.',
    limit: 10,
    run(scan) {
      return junkEntries(scan, false).map(({ entry, segment }) => ({
        path: entry.repoRel,
        detail: `"${segment}" is in the working tree but not tracked by Git, so it is not in the commit the directory would read.`,
      }));
    },
  }),

  defineRule({
    id: 'layout/symlink',
    section: 'layout',
    result: 'block',
    what: 'A symbolic link is where the plugin loads its files from.',
    fix: 'Replace the link with the real file or folder, and commit that instead.',
    limit: 10,
    run(scan) {
      return symlinkHits(scan)
        .filter(({ loaded }) => loaded)
        .map(({ entry }) => ({ path: entry.repoRel, detail: 'The plugin loads this entry through a symbolic link.' }));
    },
  }),

  // The checklist splits this: a link blocks where the plugin loads the entry, and is only
  // a warning elsewhere. A link in a sibling folder is not where the plugin loads anything.
  defineRule({
    id: 'layout/symlink-elsewhere',
    section: 'layout',
    result: 'warning',
    what: 'A symbolic link sits somewhere the plugin does not load an entry from.',
    fix: 'Only a link where the plugin loads a component blocks a submission, but replace it with the real file while you are there.',
    limit: 10,
    run(scan) {
      return symlinkHits(scan)
        .filter(({ loaded }) => !loaded)
        .map(({ entry }) => ({
          path: entry.repoRel,
          detail: entry.pluginRel === null
            ? 'A symbolic link outside the plugin folder.'
            : 'A symbolic link inside the plugin folder, away from the folders the plugin loads from.',
        }));
    },
  }),

  defineRule({
    id: 'layout/submodule',
    section: 'layout',
    result: 'block',
    what: 'A Git submodule stands where the plugin loads its files from.',
    fix: 'Commit the files themselves instead of a submodule reference.',
    limit: 10,
    run(scan) {
      return submoduleHits(scan)
        .filter(({ loaded }) => loaded)
        .map(({ entry }) => ({ path: entry.repoRel, detail: 'The plugin loads an entry through a Git submodule.' }));
    },
  }),

  defineRule({
    id: 'layout/submodule-elsewhere',
    section: 'layout',
    result: 'warning',
    what: 'A Git submodule sits somewhere the plugin does not load an entry from.',
    fix: 'Only a submodule where the plugin loads a component blocks a submission, but commit the files themselves while you are there.',
    limit: 10,
    run(scan) {
      return submoduleHits(scan)
        .filter(({ loaded }) => !loaded)
        .map(({ entry }) => ({
          path: entry.repoRel,
          detail: entry.pluginRel !== null
            ? 'A Git submodule inside the plugin folder, away from the folders the plugin loads from.'
            : 'A Git submodule in the repository, outside the plugin folder.',
        }));
    },
  }),

  defineRule({
    id: 'layout/lfs-pointer',
    section: 'layout',
    result: 'block',
    what: 'A file the plugin loads is a Git LFS pointer, not the file itself.',
    fix: 'Commit the real file, or stop tracking it with Git LFS.',
    limit: 10,
    run(scan) {
      return lfsHits(scan)
        .filter(({ loaded }) => loaded)
        .map(({ entry }) => ({ path: entry.repoRel, detail: 'The plugin loads an entry that is a Git LFS pointer, not the file itself.' }));
    },
  }),

  defineRule({
    id: 'layout/lfs-pointer-elsewhere',
    section: 'layout',
    result: 'warning',
    what: 'A Git LFS pointer sits somewhere the plugin does not load an entry from.',
    fix: 'Only a pointer where the plugin loads a component blocks a submission, but commit the real file while you are there.',
    limit: 10,
    run(scan) {
      return lfsHits(scan)
        .filter(({ loaded }) => !loaded)
        .map(({ entry }) => ({
          path: entry.repoRel,
          detail: entry.pluginRel !== null
            ? 'A Git LFS pointer inside the plugin folder, away from the folders the plugin loads from.'
            : 'A Git LFS pointer in the repository, outside the plugin folder.',
        }));
    },
  }),

  defineRule({
    id: 'layout/invalid-name',
    section: 'layout',
    result: 'stop',
    title: 'Couldn’t validate that repository',
    what: 'A file or folder name is not valid on both Windows and macOS.',
    fix: 'Rename the entry so it works on both systems, then commit the rename.',
    limit: 10,
    run(scan) {
      const hits = [];
      const seen = new Set();
      const check = (relPath) => {
        for (const segment of segments(relPath)) {
          const problem = windowsNameProblem(segment);
          if (!problem) continue;
          const key = `${relPath}\u0000${segment}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ path: relPath, detail: `"${segment}": ${problem}.` });
          return;
        }
      };
      for (const entry of scan.files) check(entry.repoRel);
      for (const entry of scan.diskPluginFiles) check(entry.repoRel);
      return hits;
    },
  }),

  defineRule({
    id: 'layout/case-conflict',
    section: 'layout',
    result: 'stop',
    title: 'Couldn’t validate that repository',
    what: 'Two names in the same folder differ only by capitalization.',
    fix: 'Rename one of them; macOS and Windows cannot check both out side by side.',
    limit: 10,
    run(scan) {
      const directories = new Map();
      const add = (relPath) => {
        const dir = path.posix.dirname(relPath);
        const name = path.posix.basename(relPath);
        const key = dir === '.' ? '' : dir;
        if (!directories.has(key)) directories.set(key, new Map());
        const bucket = directories.get(key);
        const folded = caseKey(name);
        if (!bucket.has(folded)) bucket.set(folded, new Set());
        bucket.get(folded).add(name);
      };
      for (const entry of scan.files) add(entry.repoRel);
      for (const entry of scan.diskPluginFiles) add(entry.repoRel);

      const hits = [];
      for (const [dir, bucket] of directories) {
        for (const names of bucket.values()) {
          if (names.size < 2) continue;
          hits.push({
            path: dir === '' ? names.values().next().value : `${dir}/`,
            detail: `These names differ only by capitalization: ${[...names].sort().join(', ')}.`,
          });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'layout/plugin-path-name',
    section: 'layout',
    result: 'stop',
    title: 'Couldn’t validate that repository',
    what: 'A folder on the path from the repository root to the plugin uses characters the portal does not accept.',
    fix: 'Rename the folder to letters, digits, dots, hyphens and underscores only.',
    limit: 5,
    run(scan) {
      if (scan.pluginRel === '') return [];
      const hits = [];
      for (const segment of segments(scan.pluginRel)) {
        if (!PLUGIN_PATH_SEGMENT.test(segment)) {
          hits.push({
            path: scan.pluginRel,
            detail: `The folder name "${segment}" uses characters outside letters, digits, dots, hyphens and underscores.`,
          });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'layout/plugin-path-case',
    section: 'layout',
    result: 'note',
    what: 'The plugin path has to be typed with the same capitalization as the repository.',
    fix: 'Copy the folder name from the repository when you fill in the Plugin path field.',
    limit: 3,
    run(scan) {
      if (scan.pluginRel === '') return [];
      return scan.pluginRel === scan.pluginRel.toLowerCase()
        ? []
        : [{ path: scan.pluginRel, detail: `Enter it exactly as "${scan.pluginRel}".` }];
    },
  }),

  defineRule({
    id: 'layout/gitattributes-export',
    section: 'layout',
    result: 'stop',
    title: 'Couldn’t validate that repository',
    what: 'A .gitattributes file uses export-ignore or export-subst.',
    fix: 'Remove those attributes; they change which files the portal sees.',
    limit: 10,
    run(scan) {
      const hits = [];
      for (const entry of scan.files) {
        if (entry.name !== '.gitattributes') continue;
        const text = scan.readText(entry);
        if (text === null) continue;
        const records = parseGitAttributes(text);
        for (const attribute of ['export-ignore', 'export-subst']) {
          if (hasAttribute(records, attribute)) {
            hits.push({ path: entry.repoRel, detail: `Uses "${attribute}".` });
          }
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'layout/gitattributes-filter',
    section: 'layout',
    result: 'stop',
    title: 'Couldn’t validate that repository',
    what: 'A .gitattributes file at the repository root, above the plugin folder or inside it rewrites file contents.',
    fix: 'Remove the filter attributes, Git LFS included, from that file.',
    limit: 10,
    run(scan) {
      const inScope = (repoRel) => {
        if (scan.pluginRel === '') return true;
        const dir = repoRel.includes('/') ? repoRel.slice(0, repoRel.lastIndexOf('/')) : '';
        return dir === '' || dir === scan.pluginRel || dir.startsWith(`${scan.pluginRel}/`);
      };
      const hits = [];
      for (const entry of scan.files) {
        if (entry.name !== '.gitattributes' || !inScope(entry.repoRel)) continue;
        const text = scan.readText(entry);
        if (text === null) continue;
        if (hasAttribute(parseGitAttributes(text), 'filter')) {
          hits.push({
            path: entry.repoRel,
            detail: 'Sets a filter attribute, which rewrites file contents on checkout.',
          });
        }
      }
      return hits;
    },
  }),

  // The checklist says to keep "filter, Git LFS included, and other attributes that rewrite
// file contents" out of .gitattributes, and stops validation when you do not. `filter` is
// unambiguous; `text`, `eol`, `ident` and `working-tree-encoding` also rewrite a checkout,
// but a repository needs them to keep line endings stable, and every plugin that sets them
// is not obviously broken. That reading is a guess, so it is a note.
  defineRule({
    id: 'layout/gitattributes-rewrites-content',
    section: 'layout',
    result: 'note',
    source: 'tool',
    what: 'A .gitattributes file in scope sets an attribute that can rewrite file contents on checkout: text, eol, ident or working-tree-encoding.',
    fix: 'If the portal reads "other attributes that rewrite file contents" as anything beyond filter, these stop validation. Keeping only line endings you need, or dropping the file, avoids the question.',
    limit: 5,
    run(scan) {
      const inScope = (repoRel) => {
        if (scan.pluginRel === '') return true;
        const dir = repoRel.includes('/') ? repoRel.slice(0, repoRel.lastIndexOf('/')) : '';
        return dir === '' || dir === scan.pluginRel || dir.startsWith(`${scan.pluginRel}/`);
      };
      const hits = [];
      for (const entry of scan.files) {
        if (entry.name !== '.gitattributes' || !inScope(entry.repoRel)) continue;
        const text = scan.readText(entry);
        if (text === null) continue;
        const records = parseGitAttributes(text);
        const found = ['text', 'eol', 'ident', 'working-tree-encoding']
          .filter((attribute) => hasAttribute(records, attribute));
        if (found.length > 0) {
          hits.push({ path: entry.repoRel, detail: `Sets ${found.join(', ')}.` });
        }
      }
      return hits;
    },
  }),

  defineRule({
    id: 'layout/plugin-entry-too-large',
    section: 'layout',
    result: 'stop',
    title: 'Repository too large to validate',
    what: 'A file in the plugin folder is 5 MiB or larger.',
    fix: 'Keep every file in the plugin folder below 5 MiB.',
    limit: 10,
    run(scan) {
      return scan.pluginFiles
        .filter((entry) => !entry.missing && entry.size >= scan.limits.maxFileSizeHardBytes)
        .map((entry) => ({
          path: entry.repoRel,
          detail: `The file is ${humanSize(entry.size)}.`,
        }));
    },
  }),

  defineRule({
    id: 'layout/repository-unpacked-size',
    section: 'layout',
    result: 'stop',
    title: 'Repository too large to validate',
    what: 'The repository is 256 MiB or larger unpacked.',
    fix: 'Move large files out of the repository, or split the plugin into its own repository.',
    limit: 1,
    run(scan) {
      if (scan.totalBytes < scan.limits.maxRepoUnpackedBytes) return [];
      return [{
        path: null,
        detail: `The files the directory would read add up to ${humanSize(scan.totalBytes)}.`,
      }];
    },
  }),

  defineRule({
    id: 'layout/repository-archive-size',
    section: 'layout',
    result: 'stop',
    title: 'Repository too large to validate',
    what: 'The repository is 50 MiB or larger as GitHub archives it.',
    fix: 'Move large files out of the repository, or split the plugin into its own repository.',
    limit: 1,
    run(scan) {
      const estimate = estimateArchiveBytes(scan);
      if (estimate === null || estimate.bytes < scan.limits.maxRepoArchiveBytes) return [];
      return [{
        path: null,
        detail: `Deflating the tracked files in this process gives ${humanSize(estimate.bytes)}, over the limit. ` +
          `(An estimate: the portal measures GitHub's own archive, which this checker cannot fetch.)` +
          (estimate.skipped > 0 ? ` ${estimate.skipped} file(s) were too large to include in the estimate.` : ''),
      }];
    },
  }),

  defineRule({
    id: 'layout/repository-entries',
    section: 'layout',
    result: 'stop',
    title: 'Repository too large to validate',
    what: 'The repository holds 10,000 files and folders or more.',
    fix: 'Split the plugin into its own repository.',
    limit: 1,
    run(scan) {
      const entries = countRepositoryEntries(scan);
      if (entries < scan.limits.maxRepoEntries) return [];
      return [{ path: null, detail: `The repository holds ${entries} files and folders.` }];
    },
  }),

  defineRule({
    id: 'layout/plugin-not-committed',
    source: 'tool',
    section: 'layout',
    result: 'block',
    what: 'The plugin folder exists on disk, but the commit the directory would read holds none of its files.',
    fix: 'Commit the plugin folder and push it, then validate again — or run the checker with --worktree to check what is on disk in the meantime. Until it is committed there is nothing to submit.',
    limit: 1,
    when: (scan) => scan.noCommittedPluginFiles,
    run(scan) {
      const hidden = scan.ignoredPluginFiles;
      const why = hidden.length > 0 && hidden[0].ignore
        ? ` An ignore rule hides them: "${hidden[0].ignore.pattern}" in ${hidden[0].ignore.source}, line ${hidden[0].ignore.line}.`
        : '';
      return [{
        path: null,
        detail: `The plugin folder holds ${scan.pluginWorkingFiles.length} file(s) on disk, and the last commit does not include any of them.${why}`,
      }];
    },
  }),

  defineRule({
    id: 'layout/ignored-component-file',
    source: 'tool',
    section: 'layout',
    result: 'warning',
    what: 'A file inside the plugin folder is hidden by a .gitignore rule, so it is not in the commit and will not ship.',
    fix: 'Change the ignore rule that hides it, or rename the file, so the component is committed.',
    limit: 10,
    when: (scan) => !scan.noCommittedPluginFiles,
    run(scan) {
      return scan.ignoredPluginFiles
        .filter(({ path: repoPath }) => {
          const pluginRel = scan.pluginRel === '' ? repoPath : repoPath.slice(scan.pluginRel.length + 1);
          return loadsEntry(pluginRel) && !isCachePath(pluginRel);
        })
        .map(({ path: repoPath, ignore }) => ({
          path: repoPath,
          detail: ignore
            ? `Hidden by "${ignore.pattern}" in ${ignore.source}, line ${ignore.line}.`
            : 'Hidden by an ignore rule.',
        }));
    },
  }),

  defineRule({
    id: 'layout/repository-not-readable',
    source: 'tool',
    section: 'layout',
    result: 'note',
    what: 'A .git was found above the plugin folder, but Git would not read it, so the report covers the plugin folder on its own.',
    fix: 'Point --repo at the repository root if the plugin belongs to one.',
    limit: 1,
    when: (scan) => scan.gitReadable === false,
    run(scan) {
      return [{
        path: null,
        detail: `The plugin folder was read as ${toPosix(scan.repoRoot)}, with every file on disk, because Git would not read the repository above it.`,
      }];
    },
  }),

  defineRule({
    id: 'layout/uncommitted-files',
    source: 'tool',
    section: 'layout',
    result: 'warning',
    what: 'Files in the plugin folder are untracked, so the commit the directory reads does not hold them.',
    fix: 'Commit them before you validate, or run the checker with --worktree to check what is on disk instead.',
    limit: 1,
    when: (scan) => scan.untrackedPluginFiles.length > 0,
    run(scan) {
      const shown = scan.untrackedPluginFiles.slice(0, 5).join(', ');
      const more = scan.untrackedPluginFiles.length > 5 ? `, and ${scan.untrackedPluginFiles.length - 5} more` : '';
      return [{
        path: null,
        detail: `${scan.untrackedPluginFiles.length} untracked file(s): ${shown}${more}.`,
      }];
    },
  }),

  defineRule({
    id: 'layout/several-plugins',
    section: 'layout',
    result: 'note',
    title: 'Pick one plugin first',
    // A note rather than the block the table gives "Pick one plugin first": the portal
    // raises that when a submission covers several folders, and this run covers one.
    what: 'The repository holds more than one plugin folder. The table blocks a submission that covers several at once; this report is about one of them.',
    fix: 'Validate and submit each plugin folder on its own; a submission covers one folder.',
    limit: 10,
    run(scan) {
      const others = siblingPlugins(scan);
      if (others.length === 0) return [];
      return [{
        path: null,
        detail: `This repository also holds ${others.map((p) => `"${p}"`).join(', ')}. ` +
          'Run the checker on each folder separately.',
      }];
    },
  }),
];

/**
 * Plugin folders beside the one under inspection, named by their path in the repository.
 * A plugin nested deeper than the one being checked is not a sibling a submission would
 * confuse it with, so only the enclosing folder is read.
 */
export function siblingPlugins(scan) {
  const enclosing = scan.pluginRel === '' ? '' : path.posix.dirname(scan.pluginRel);
  const prefix = enclosing === '' || enclosing === '.' ? '' : `${enclosing}/`;
  // From the view's file list, not from the disk: in the default view this report is about
  // the commit, and a folder that only exists in the working tree is not part of it.
  const found = new Set();
  for (const entry of scan.files) {
    const repoRel = toPosix(entry.repoRel ?? '');
    if (!repoRel.startsWith(prefix)) continue;
    const parts = repoRel.slice(prefix.length).split('/');
    if (parts.length !== 3 || parts[1] !== '.claude-plugin' || parts[2] !== 'plugin.json') continue;
    if (`${prefix}${parts[0]}` !== scan.pluginRel) found.add(`${prefix}${parts[0]}`);
  }
  return [...found];
}

/**
 * Approximate the zip GitHub serves. Deflating every tracked file in this process is close
 * enough to decide the 50 MiB rule, and it is skipped when the tree is far too small to reach it.
 */
export function estimateArchiveBytes(scan, { workLimit = 400 * 1024 * 1024, floor = 40 * 1024 * 1024 } = {}) {
  if (scan.totalBytes < floor) return { bytes: scan.totalBytes, skipped: 0 };
  if (scan.totalBytes > workLimit) return null;
  let bytes = 0;
  let skipped = 0;
  for (const entry of scan.files) {
    if (entry.missing || entry.submodule) continue;
    if (entry.size > 32 * 1024 * 1024) {
      bytes += entry.size;
      skipped += 1;
      continue;
    }
    const buffer = scan.readBytes(entry, 32 * 1024 * 1024);
    if (!buffer) {
      bytes += entry.size;
      skipped += 1;
      continue;
    }
    try {
      bytes += zlib.deflateRawSync(buffer, { level: 6 }).length + 100;
    } catch {
      bytes += entry.size;
    }
  }
  return { bytes, skipped };
}