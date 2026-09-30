/**
 * Credential patterns.
 *
 * The directory blocks real credentials in any file, documentation and examples included.
 * The first list holds shapes that are a credential and nothing else. The second list is a
 * guess from an assignment, so its hits are reported as heuristics: placeholders such as
 * "YOUR_API_KEY" or "changeme" are filtered out, but a local tool cannot tell a live token
 * from a realistic example.
 */

export const CREDENTIAL_PATTERNS = [
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: 'Stripe secret key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

const ASSIGNMENT_RE = new RegExp(
  '\\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|refresh[_-]?token|' +
  'password|passwd|secret|token)\\b\\s*[:=]\\s*["\']?([A-Za-z0-9_\\-./+=]{16,})["\']?',
  'gi',
);

const PLACEHOLDER_RE = new RegExp(
  '^(?:' + [
    'your[_-]?', 'my[_-]?', 'example', 'sample', 'dummy', 'fake', 'test', 'placeholder',
    'redacted', 'changeme', 'none', 'null', 'undefined', 'todo', 'xxx+', '\\*+',
  ].join('|') + ')',
  'i',
);

/**
 * Credentials that are printed in public documentation as examples. Flagging them would
 * teach the wrong thing: they are safe by definition, and a README that quotes them is
 * doing what the documentation does.
 */
export const PUBLISHED_EXAMPLES = new Set([
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
]);

function looksLikePlaceholder(value) {
  if (PLACEHOLDER_RE.test(value)) return true;
  if (PUBLISHED_EXAMPLES.has(value)) return true;
  if (/^[A-Z_]+$/.test(value)) return true;             // YOUR_TOKEN_HERE
  if (/^(.)\1+$/.test(value)) return true;              // aaaaaaaa
  if (/[<>{}$]/.test(value)) return true;               // ${user_config.KEY}, <token>
  // An expression that reads the value from somewhere else, not a value.
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) return true;
  if (/^(?:process\.env|os\.environ|env\.|getenv|System\.getenv)/.test(value)) return true;
  return false;
}

/** True when the value already matches one of the shapes that are a credential and nothing else. */
export function matchesKnownCredentialShape(value) {
  return CREDENTIAL_PATTERNS.some((pattern) => {
    pattern.re.lastIndex = 0;
    return pattern.re.test(value);
  });
}

/** Every credential-shaped string in the text, with its kind. */
export function findCredentials(text) {
  const hits = [];
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of text.matchAll(pattern.re)) {
      if (looksLikePlaceholder(match[0])) continue;
      hits.push({ name: pattern.name, value: match[0], heuristic: false, index: match.index ?? 0 });
    }
  }
  ASSIGNMENT_RE.lastIndex = 0;
  for (const match of text.matchAll(ASSIGNMENT_RE)) {
    const value = match[1];
    if (looksLikePlaceholder(value)) continue;
    hits.push({ name: `a value assigned to "${match[0].split(/[:=]/)[0].trim()}"`, value, heuristic: true, index: match.index ?? 0 });
  }
  return hits;
}

/**
 * Snippets where a credential is read from the environment. `CLAUDE_PLUGIN_OPTION_*` is
 * excluded on purpose: that is the variable Claude Code itself exports for a value the user
 * configured, and reading it is the fix this checker recommends, not a problem.
 */
const ENV_CREDENTIAL_SOURCE =
  '\\$(?:\\{)?(?:env:)?(?!CLAUDE_PLUGIN_OPTION_)(' + [
    'GITHUB_TOKEN', 'GH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID', 'SLACK_TOKEN', 'NPM_TOKEN', 'DOCKER_PASSWORD', 'DATABASE_URL',
    '[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD)',
  ].join('|') + ')(?:\\})?';

/**
 * Deliberately not a global regex. With the `g` flag, `test` and `exec` carry `lastIndex`
 * from one call to the next, so a loop over lines skips every other match.
 */
export const ENV_CREDENTIAL_RE = new RegExp(ENV_CREDENTIAL_SOURCE);

/** The first environment credential a string names, or null. */
export function findEnvCredential(text) {
  const match = new RegExp(ENV_CREDENTIAL_SOURCE).exec(String(text));
  return match ? match[0] : null;
}

/** Redact a credential before it reaches a report. */
export function redact(value) {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}