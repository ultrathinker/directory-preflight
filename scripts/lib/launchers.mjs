/**
 * Find package launchers in text and decide whether they pin an exact version.
 * A package launcher downloads a package and runs it: npx, bunx, pnpm dlx, yarn dlx,
 * uvx, pipx run and uv run all count. Unpinned ones block a submission.
 */

const LAUNCHER_RE = /\b(npx|bunx|pnpm\s+dlx|yarn\s+dlx|uvx|pipx\s+run|uv\s+run)\b([^\n\r]*)/g;

/** Flags that name the package themselves. */
const PACKAGE_FLAGS = new Set(['-p', '--package', '--from', '--with']);

const INSTALL_RE = new RegExp(
  '\\b(?:' + [
    'npm\\s+(?:i|install|ci|add)',
    'pnpm\\s+(?:i|install|add)',
    'yarn\\s+(?:add|install)',
    'bun\\s+(?:add|install)',
    'pip\\s+install',
    'pip3\\s+install',
    'uv\\s+(?:sync|pip\\s+install|add)',
    'poetry\\s+(?:install|add)',
    'cargo\\s+install',
    'go\\s+install',
    'gem\\s+install',
    'composer\\s+(?:install|require)',
  ].join('|') + ')\\b',
  'g',
);

/**
 * A token that could name a package: an optional scope, or a name with a version
 * specifier. Prose and punctuation do not pass this test, which is what keeps a sentence
 * about launchers from reading as one.
 */
export function looksLikePackageSpec(token) {
  if (!token || token.length > 214) return false;
  if (!/[A-Za-z0-9]/.test(token)) return false;
  return /^@?[A-Za-z0-9][A-Za-z0-9@/._+=~^-]*$/.test(token);
}

/** Split a command tail into tokens, stopping at a shell operator. */
export function tokenize(text) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    // A backtick quotes too: it is what surrounds a command written inside Markdown.
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    if (char === ';' || char === '|' || char === '&' || char === '#') break;
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Is this package specifier pinned to an exact version?
 * `pkg@1.2.3` and `pkg==1.2.3` are; `pkg`, `pkg@latest`, `pkg@^1.2.3`, `pkg>=1` are not.
 */
export function isPinned(spec) {
  if (!spec) return false;
  const at = spec.lastIndexOf('@');
  if (at > 0) return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.slice(at + 1));
  const eq = spec.indexOf('==');
  if (eq > 0) return /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.slice(eq + 2));
  return false;
}

/**
 * Every launcher invocation in a piece of text, as
 * `{ launcher, spec, flags, pinned, reason }`.
 */
export function findLaunchers(text) {
  const found = [];
  LAUNCHER_RE.lastIndex = 0;
  let match;
  while ((match = LAUNCHER_RE.exec(text)) !== null) {
    const launcher = match[1].replace(/\s+/g, ' ');
    const tokens = tokenize(match[2]);
    const flags = new Set();
    let fromFlag = null;
    let positional = null;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.startsWith('-')) {
        const [name, inlineValue] = token.includes('=')
          ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
          : [token, null];
        flags.add(name);
        if (inlineValue !== null && PACKAGE_FLAGS.has(name)) fromFlag = inlineValue;
        else if (inlineValue === null && PACKAGE_FLAGS.has(name) && tokens[index + 1] && !tokens[index + 1].startsWith('-')) {
          fromFlag = tokens[index + 1];
          index += 1;
        }
        continue;
      }
      if (positional === null) positional = token;
    }
    // The first thing after the launcher has to be a package. Prose that merely names a
    // launcher fails this test, and stopping here keeps the next word from being read as one.
    if (fromFlag === null && !looksLikePackageSpec(positional)) continue;
    const spec = fromFlag ?? positional;

    // `uv run` runs a command in the project's own environment. The pinning rule for it is
    // --locked or --frozen, and only `--with` names a registry package.
    if (launcher === 'uv run') {
      const locked = flags.has('--locked') || flags.has('--frozen');
      found.push({
        launcher,
        spec: fromFlag,
        flags: [...flags],
        pinned: locked && (fromFlag === null || isPinned(fromFlag)),
        reason: locked ? null : 'needs --locked or --frozen',
      });
      continue;
    }

    found.push({
      launcher,
      spec,
      flags: [...flags],
      pinned: isPinned(spec),
      reason: spec === null ? 'no package name found' : isPinned(spec) ? null : `"${spec}" is not an exact version`,
    });
  }
  return found;
}

/** Package installs, which make a package-manager config file a finding. */
export function findInstalls(text) {
  INSTALL_RE.lastIndex = 0;
  return [...text.matchAll(INSTALL_RE)].map((match) => match[0].replace(/\s+/g, ' '));
}
