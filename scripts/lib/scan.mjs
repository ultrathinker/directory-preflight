/**
 * Read the target into the shape the rules work with.
 *
 * The directory reads a repository as GitHub serves it: the files of a commit. So the default
 * view takes both the file list and the file contents from the commit at HEAD, through
 * `git ls-tree` and `git cat-file`. `--worktree` swaps both for the working tree, so the two
 * never disagree: whichever view is in use, the list and the contents come from the same place.
 *
 * Nothing here writes, moves or deletes anything, and every Git command runs with
 * --no-optional-locks so that even the index is left alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toPosix } from './util.mjs';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
export const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.eot']);

/** Thresholds straight from the checklist. A run can override any of them with --limit name=value. */
export const DEFAULT_LIMITS = {
  /** Held: a file that is not an image or a font at or above this size. */
  maxFileSizeBytes: 256 * 1024,
  /** Validation stops: every file in the plugin folder must stay below this. */
  maxFileSizeHardBytes: 5 * 1024 * 1024,
  /** Held: more files than this in the plugin folder. */
  maxPluginFiles: 512,
  /** Validation stops: files and folders in the repository. */
  maxRepoEntries: 10000,
  /** Validation stops: the repository, as GitHub archives it. */
  maxRepoArchiveBytes: 50 * 1024 * 1024,
  /** Validation stops: the repository unpacked. */
  maxRepoUnpackedBytes: 256 * 1024 * 1024,
  minReadmeWords: 40,
  maxFindingsPerRule: 20,
  /** Files larger than this are not read for text rules. */
  maxTextBytes: 2 * 1024 * 1024,
  /** Total bytes of committed blobs to hold in memory before the rest are left unread. */
  maxObjectBytes: 128 * 1024 * 1024,
  /** Stop walking a folder that is not a Git repository past this many entries. */
  maxWalkEntries: 20000,
};

/** The limits for this run: the defaults, overridden by the `overrides` the caller passes. */
export function resolveLimits(overrides = {}) {
  return { ...DEFAULT_LIMITS, ...overrides };
}

/** The nearest directory at or above `start` that holds a `.git` entry, or null. */
export function findGitRoot(start) {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function runGit(repoRoot, args, input) {
  return execFileSync('git', ['--no-optional-locks', '-C', repoRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The files of a commit with their mode, blob and size, as `{ path, mode, type, sha, size }`
 * with POSIX paths relative to the repository root. Returns null when Git is unavailable or
 * the revision cannot be read.
 *
 * Reading the tree rather than the working tree is what makes the default view honest: the
 * sizes and the contents come from the same commit, and a file that is edited but not
 * committed cannot change the report.
 */
export function gitCommitFiles(repoRoot, rev = 'HEAD') {
  let output;
  try {
    output = runGit(repoRoot, ['ls-tree', '-r', '-z', '--long', rev]);
  } catch {
    return null;
  }
  const entries = [];
  for (const record of output.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, sha, size] = record.slice(0, tab).split(/\s+/);
    entries.push({
      path: record.slice(tab + 1),
      mode,
      type,
      sha,
      // A submodule is a commit, not a blob, and `ls-tree --long` prints "-" for its size.
      size: Number.isFinite(Number(size)) ? Number(size) : 0,
    });
  }
  return entries;
}

/** The blob of each object id, read in one Git process. Missing objects are left out. */
export function gitBlobs(repoRoot, shas) {
  const wanted = [...new Set(shas)].filter(Boolean);
  const blobs = new Map();
  if (wanted.length === 0) return blobs;
  let output;
  try {
    output = execFileSync('git', ['--no-optional-locks', '-C', repoRoot, 'cat-file', '--batch'], {
      input: `${wanted.join('\n')}\n`,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 1024,
    });
  } catch {
    return blobs;
  }
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = output.toString('utf8', offset, newline);
    const [sha, type, sizeText] = header.split(' ');
    const size = Number(sizeText);
    if (!sha || !Number.isFinite(size)) break;
    const start = newline + 1;
    const end = start + size;
    if (end > output.length) break;
    if (type === 'blob') blobs.set(sha, output.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}

/** `-- <path>` when there is a path to limit the question to. */
function pathspec(pluginRel) {
  return pluginRel === '' ? [] : ['--', pluginRel];
}

/**
 * Tracked files with their Git mode, as a list of `{ path, mode }` with POSIX paths
 * relative to the repository root. Returns null when Git is unavailable or the
 * directory is not a working tree.
 */
export function gitTrackedFiles(repoRoot) {
  let output;
  try {
    output = runGit(repoRoot, ['ls-files', '-s', '-z']);
  } catch {
    return null;
  }
  const entries = [];
  for (const record of output.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode, sha] = record.slice(0, tab).split(' ');
    entries.push({ mode, sha, path: record.slice(tab + 1) });
  }
  return entries;
}

/** True when the repository has a commit to read. A fresh `git init` has none. */
export function gitHasCommit(repoRoot) {
  try {
    runGit(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** The size of each blob, without reading a byte of its content. */
export function gitBlobSizes(repoRoot, shas) {
  const sizes = new Map();
  const wanted = [...new Set(shas)].filter(Boolean);
  if (wanted.length === 0) return sizes;
  let output;
  try {
    output = runGit(repoRoot, ['cat-file', '--batch-check'], `${wanted.join('\n')}\n`);
  } catch {
    return sizes;
  }
  for (const line of output.split('\n')) {
    const [sha, type, size] = line.split(' ');
    if (sha && type === 'blob' && Number.isFinite(Number(size))) sizes.set(sha, Number(size));
  }
  return sizes;
}

/**
 * True when the plugin's own files have changes Git has not staged or committed.
 * The question is limited to the plugin folder on purpose: the repository can be far
 * larger than the plugin, and a path outside it cannot change the answer.
 */
function hasUncommittedChanges(repoRoot, pluginRel) {
  try {
    return runGit(repoRoot, ['status', '--porcelain', '--untracked-files=no', ...pathspec(pluginRel)]).trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Files in the plugin folder that an ignore rule keeps out of the commit, with the rule
 * that hides each one. This is the check that would have caught a component file hidden by
 * a stray ignore pattern.
 */
export function gitIgnoredFiles(repoRoot, pluginRel) {
  let listed;
  try {
    listed = runGit(repoRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', ...pathspec(pluginRel)])
      .split('\0').filter(Boolean);
  } catch {
    return [];
  }
  if (listed.length === 0) return [];
  let verbose = '';
  try {
    verbose = runGit(repoRoot, ['check-ignore', '-v', '--stdin'], `${listed.join('\n')}\n`);
  } catch {
    /* check-ignore exits non-zero when a path is not ignored after all */
  }
  const rules = new Map();
  for (const line of verbose.split('\n')) {
    const first = line.indexOf(':');
    const second = line.indexOf(':', first + 1);
    const tab = line.indexOf('\t');
    if (first === -1 || second === -1 || tab === -1) continue;
    rules.set(toPosix(line.slice(tab + 1)), {
      source: line.slice(0, first),
      line: line.slice(first + 1, second),
      pattern: line.slice(second + 1, tab),
    });
  }
  return listed.map((repoPath) => ({ path: toPosix(repoPath), ignore: rules.get(toPosix(repoPath)) ?? null }));
}

/** Files in the plugin folder that Git would not include in a commit. */
function gitUntrackedFiles(repoRoot, pluginRel) {
  try {
    return runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z', ...pathspec(pluginRel)])
      .split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

/** Every file under `dir`, following nothing: symbolic links are reported, not entered. */
export function walkFiles(dir, { maxEntries = 200000 } = {}) {
  const found = [];
  const queue = [{ abs: dir, rel: '' }];
  while (queue.length > 0) {
    const current = queue.shift();
    let dirents;
    try {
      dirents = fs.readdirSync(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (current.rel === '' && dirent.name === '.git') continue;
      const abs = path.join(current.abs, dirent.name);
      const rel = current.rel === '' ? dirent.name : `${current.rel}/${dirent.name}`;
      let link = false;
      try {
        link = fs.lstatSync(abs).isSymbolicLink();
      } catch {
        continue;
      }
      if (dirent.isDirectory() && !link) {
        queue.push({ abs, rel });
      } else {
        found.push({ abs, rel, link });
        if (found.length >= maxEntries) return found;
      }
    }
  }
  return found;
}

function kindOf(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (FONT_EXTENSIONS.has(ext)) return 'font';
  return 'other';
}

function makeEntry({ abs, repoRel, pluginRel, mode, link, size: committedSize, sha }) {
  let size = committedSize ?? 0;
  let missing = false;
  let stat = null;
  if (committedSize === undefined) {
    try {
      stat = fs.lstatSync(abs);
      size = stat.size;
    } catch {
      missing = true;
    }
  }
  return {
    abs,
    repoRel: toPosix(repoRel),
    pluginRel: pluginRel === null || pluginRel === undefined ? null : toPosix(pluginRel),
    mode: mode ?? null,
    link: Boolean(link) || (mode ?? '').startsWith('12'),
    submodule: (mode ?? '') === '160000' || (stat ? stat.isDirectory() : false),
    sha: sha ?? null,
    size,
    missing,
    kind: kindOf(repoRel),
    ext: path.extname(repoRel).toLowerCase(),
    name: path.basename(repoRel),
  };
}

/** Up to `maxBytes` from the start of a file on disk, whatever its size. */
function readPrefix(abs, maxBytes) {
  let fd = null;
  try {
    fd = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing left to do about it */
      }
    }
  }
}

function relativeTo(from, to) {
  const rel = path.relative(from, to);
  return rel === '' ? '' : toPosix(rel);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Build the scan context. `target` is the plugin folder (the folder that holds
 * `.claude-plugin/plugin.json`); `repoRoot` overrides where the repository starts.
 */
export function createScan({
  target,
  repoRoot: repoRootOverride = null,
  limits: limitOverrides = {},
  worktree = false,
}) {
  const targetAbs = path.resolve(target);
  const limits = resolveLimits(limitOverrides);
  const discovered = repoRootOverride === null ? findGitRoot(targetAbs) : null;
  let repoRoot = path.resolve(repoRootOverride ?? discovered ?? targetAbs);
  let repoRootSource = repoRootOverride !== null ? 'given' : discovered !== null ? 'git' : 'self';
  let pluginRel = relativeTo(repoRoot, targetAbs);
  let isGit = findGitRoot(repoRoot) !== null;
  let gitReadable = true;
  let tracked = null;
  let committed = null;
  let indexView = false;

  if (isGit) {
    tracked = gitTrackedFiles(repoRoot);
    if (tracked && !worktree) {
      // The commit the directory would read. A repository that has staged files but no
      // commit yet is read from the index instead, and the report says which it was.
      committed = gitHasCommit(repoRoot) ? gitCommitFiles(repoRoot) : null;
      if (!committed) {
        const sizes = gitBlobSizes(repoRoot, tracked.map((entry) => entry.sha));
        committed = tracked.map(({ mode, sha, path: repoPath }) => ({
          mode, sha, path: repoPath, size: sizes.get(sha) ?? 0,
        }));
        indexView = true;
      }
    }
    if (!tracked || (!worktree && !committed)) {
      // A `.git` somewhere above the plugin that Git will not read, most often a broken
      // or unrelated repository such as a home directory. Walking it could mean walking
      // everything the user owns, so the plugin folder becomes the repository instead.
      // A root the caller named is kept: that was an instruction, not a guess.
      gitReadable = false;
      isGit = false;
      if (repoRootOverride === null) {
        repoRoot = targetAbs;
        pluginRel = '';
        repoRootSource = 'self';
      }
    }
  }

  const workingEntries = walkFiles(targetAbs).map(({ abs, rel, link }) =>
    makeEntry({ abs, repoRel: pluginRel === '' ? rel : `${pluginRel}/${rel}`, pluginRel: rel, link }),
  );

  let files;
  let source;
  let stale = false;
  let untracked = [];
  let repositoryTruncated = false;
  let ignoredPaths = [];
  if (isGit) {
    const untrackedPaths = gitUntrackedFiles(repoRoot, pluginRel);
    ignoredPaths = gitIgnoredFiles(repoRoot, pluginRel);
    const toEntry = (repoPath, mode, link, size, sha) => makeEntry({
      abs: path.join(repoRoot, repoPath),
      repoRel: repoPath,
      pluginRel: isInside(targetAbs, path.join(repoRoot, repoPath)) ? relativeTo(targetAbs, path.join(repoRoot, repoPath)) : null,
      mode,
      link,
      size,
      sha,
    });
    if (worktree) {
      source = 'worktree';
      files = [
        ...tracked.map(({ mode, path: repoPath }) => toEntry(repoPath, mode, false)),
        ...untrackedPaths.map((repoPath) => toEntry(repoPath, null, false)),
      ];
    } else {
      source = indexView ? 'index' : 'commit';
      stale = hasUncommittedChanges(repoRoot, pluginRel);
      untracked = untrackedPaths.filter((repoPath) => isInside(targetAbs, path.join(repoRoot, repoPath)));
      files = committed.map(({ mode, path: repoPath, sha, size }) => toEntry(repoPath, mode, false, size, sha));
    }
  }
  if (!files) {
    source = 'directory';
    if (repoRoot === targetAbs) {
      files = workingEntries;
    } else {
      const walked = walkFiles(repoRoot, { maxEntries: limits.maxWalkEntries + 1 });
      repositoryTruncated = walked.length > limits.maxWalkEntries;
      files = repositoryTruncated ? workingEntries : walked.map(({ abs, rel, link }) => {
        const inside = isInside(targetAbs, abs);
        return makeEntry({
          abs,
          repoRel: rel,
          pluginRel: inside ? relativeTo(targetAbs, abs) : null,
          link,
        });
      });
    }
  }

  const byRepoRel = new Map(files.map((entry) => [entry.repoRel, entry]));
  const textCache = new Map();

  // In the commit view the contents come from the blobs, read in one Git process. The
  // plugin folder goes first, so a huge repository cannot crowd it out of the budget.
  const unread = new Map();
  if (source === 'commit' || source === 'index') {
    const rank = (entry) => (entry.pluginRel !== null ? 0 : entry.name === '.gitattributes' ? 1 : 2);
    const candidates = files
      .filter((entry) => entry.sha && !entry.missing && entry.size <= limits.maxTextBytes)
      .sort((left, right) => rank(left) - rank(right));
    const chosen = [];
    let budget = 0;
    for (const entry of candidates) {
      if (budget + entry.size > limits.maxObjectBytes) {
        unread.set(entry.repoRel, entry);
        continue;
      }
      budget += entry.size;
      chosen.push(entry);
    }
    const blobs = gitBlobs(repoRoot, chosen.map((entry) => entry.sha));
    for (const entry of chosen) {
      const blob = blobs.get(entry.sha);
      if (blob) entry.blob = blob;
      else unread.set(entry.repoRel, entry);
    }
  }
  for (const entry of files) {
    if (entry.submodule || entry.kind === 'image' || entry.kind === 'font') continue;
    if (entry.size > limits.maxTextBytes) unread.set(entry.repoRel, entry);
  }

  const scan = {
    target: targetAbs,
    repoRoot,
    pluginDir: targetAbs,
    pluginRel,
    pluginName: pluginRel === '' ? path.basename(repoRoot) : path.basename(pluginRel),
    isGit,
    source,
    /** False when a `.git` was found above the plugin but Git would not read it. */
    gitReadable,
    /** Where the repository root came from: 'given', 'git' or 'self'. */
    repoRootSource,
    stale: Boolean(stale),
    /** True when a folder outside Git was too large to walk, so the plugin folder was read instead. */
    repositoryTruncated,
    /** Files in the plugin folder that Git would leave out of a commit. */
    untrackedPluginFiles: untracked.map((repoPath) => toPosix(repoPath)),
    /**
     * Files whose contents were too large to read for the text checks. The count that goes
     * in the report covers the plugin folder: the same note about a repository file the
     * plugin does not contain was a sentence about something else entirely.
     */
    unreadFiles: [...unread.values()]
      .filter((entry) => entry.pluginRel !== null && entry.pluginRel !== undefined)
      .map((entry) => ({ repoRel: entry.repoRel, size: entry.size })),
    /** Files inside the plugin folder that an ignore rule keeps out of the commit. */
    ignoredPluginFiles: ignoredPaths,
    /**
     * True when the plugin folder exists on disk but the view holds none of its files:
     * the folder is not committed at all, and reporting its files one by one would be
     * both wrong and confusing.
     */
    noCommittedPluginFiles: (source === 'commit' || source === 'index')
      && workingEntries.length > 0
      && !files.some((entry) => entry.pluginRel !== null),
    limits,
    files,
    workingFiles: workingEntries,
    /** The working tree, but only when this view counts it. */
    diskPluginFiles: source === 'worktree' || source === 'directory' ? workingEntries : [],
    byRepoRel,
    pluginFiles: files.filter((entry) => entry.pluginRel !== null),
    pluginWorkingFiles: workingEntries,
    /** Total size of the files the directory would read. */
    totalBytes: files.reduce((sum, entry) => sum + (entry.missing ? 0 : entry.size), 0),
    isTracked(repoRel) {
      return byRepoRel.has(toPosix(repoRel));
    },
    /** A file by its path in the repository. */
    fileAt(repoRel) {
      return byRepoRel.get(toPosix(repoRel)) ?? null;
    },
    /** A file by its path inside the plugin folder, wherever the plugin sits. */
    fileInPlugin(pluginRelPath) {
      const wanted = toPosix(pluginRelPath);
      return files.find((entry) => entry.pluginRel === wanted) ?? null;
    },
    /** The bytes of a file, or null when it is missing, oversized or unreadable. */
    readBytes(entry, maxBytes = limits.maxTextBytes) {
      if (!entry || entry.missing || entry.size > maxBytes) return null;
      // A symbolic link's committed content is the path it points at, not the file. Reading
      // it as text made every content rule describe a file that is not there — a link at
      // agents/helper.md was reported as missing its front matter. The link itself is
      // reported by the layout rules, which is the finding that matters.
      if (entry.link) return null;
      if (entry.blob !== undefined) return entry.blob;
      if (textCache.has(entry.abs)) return textCache.get(entry.abs);
      let buffer = null;
      try {
        buffer = fs.readFileSync(entry.abs);
      } catch {
        buffer = null;
      }
      textCache.set(entry.abs, buffer);
      return buffer;
    },
    /**
     * Up to `maxBytes` from the start of a file, whatever its size. Committed content that
     * was too large to hold in memory cannot be probed, so a caller that needs it has to
     * fall back to another signal.
     */
    probeBytes(entry, maxBytes = 8192) {
      if (!entry || entry.missing || entry.size === 0) return null;
      // The target path is not the file, here either: see readBytes.
      if (entry.link) return null;
      if (entry.blob !== undefined) return entry.blob.subarray(0, maxBytes);
      if (entry.sha !== undefined && entry.sha !== null) return null;
      return readPrefix(entry.abs, Math.min(maxBytes, entry.size));
    },
    /** The text of a file, or null when it is missing, oversized, binary or unreadable. */
    readText(entry, maxBytes = limits.maxTextBytes) {
      const buffer = scan.readBytes(entry, maxBytes);
      if (!buffer) return null;
      return buffer.toString('utf8');
    },
    /** Read a file by repository-relative path. */
    textAt(repoRel, maxBytes) {
      return scan.readText(scan.fileAt(repoRel), maxBytes);
    },
    /** Read a file by path relative to the plugin folder. */
    textInPlugin(pluginRelPath, maxBytes) {
      return scan.readText(scan.fileInPlugin(pluginRelPath), maxBytes);
    },
    /** Total size of the plugin folder, counted over the directory the directory reads. */
    pluginBytes: files
      .filter((entry) => entry.pluginRel !== null)
      .reduce((sum, entry) => sum + (entry.missing ? 0 : entry.size), 0),
  };

  return scan;
}

/** Count the files and folders a repository holds, the way the portal counts entries. */
export function countRepositoryEntries(scan) {
  const seen = new Set();
  for (const entry of scan.files) {
    seen.add(entry.repoRel);
    let dir = path.posix.dirname(entry.repoRel);
    while (dir !== '.' && dir !== '/') {
      seen.add(`${dir}/`);
      dir = path.posix.dirname(dir);
    }
  }
  return seen.size;
}