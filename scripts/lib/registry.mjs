/**
 * The ruleset a report is based on, and the vocabulary the report speaks.
 *
 * A rule is one entry in one of the files under scripts/rules/. Every rule carries its own
 * id, its result class, the title the portal uses in its report when one is documented, a
 * one-line explanation, a fix hint and a documentation link. To follow a documentation
 * change, edit the rule and bump RULESET.version.
 */

export const TOOL_NAME = 'directory-preflight';
export const TOOL_VERSION = '0.1.0';

export const RULESET = {
  /** The date of the documentation this ruleset was written against. */
  version: '2026-09-30',
  retrieved: '2026-09-30',
  source: 'https://claude.com/docs/plugins/pre-submission-checklist',
  alsoFrom: [
    'https://claude.com/docs/plugins/submit',
    'https://code.claude.com/docs/en/plugins/manifest-reference',
    'https://code.claude.com/docs/en/hooks',
  ],
  anchor: {
    layout: '#repository-and-folder-layout',
    manifest: '#manifest-and-plugin-name',
    docs: '#readme-and-license',
    files: '#files-in-the-plugin-folder',
    runtime: '#review-what-the-plugin-runs-and-connects-to',
    components: '#hooks-skills-commands-and-agents',
    security: '#prepare-for-the-security-scan',
  },
};

/**
 * The result classes the directory uses in a validation report, plus `stop` for the
 * repository-level problems that make the portal show one error and no report at all.
 */
export const RESULTS = {
  stop: { key: 'stop', label: 'Validation stops', blurb: 'the portal shows "Couldn’t validate that repository" and no report.' },
  block: { key: 'block', label: 'Blocks', blurb: 'you cannot submit until you fix this and validate again.' },
  hold: { key: 'hold', label: 'Held for a reviewer', blurb: 'you can submit; a human reads this version before it can go live.' },
  warning: { key: 'warning', label: 'Warning', blurb: 'you can submit without fixing this.' },
  note: { key: 'note', label: 'Note', blurb: 'information.' },
};

export const RESULT_ORDER = ['stop', 'block', 'hold', 'warning', 'note'];

/** Result classes that stop a submission, used for the exit code. */
export const BLOCKING_RESULTS = new Set(['stop', 'block']);

/**
 * Where a rule comes from. Only the first is the directory's own checklist; the others are
 * real problems that the checklist does not list, and saying so is the honest thing to do.
 * `validator` marks what the directory's validator is seen to report without the checklist
 * documenting it.
 */
export const SOURCES = {
  checklist: {
    label: 'directory checklist',
    url: 'https://claude.com/docs/plugins/pre-submission-checklist',
    blurb: 'a row of the pre-submission checklist',
  },
  validate: {
    label: 'claude plugin validate',
    url: 'https://code.claude.com/docs/en/plugins/cli-reference#plugin-validate',
    blurb: 'the plugin fails to load; the command reports it as an error',
  },
  'manifest-reference': {
    label: 'manifest reference',
    url: 'https://code.claude.com/docs/en/plugins/manifest-reference',
    blurb: 'a rule of the manifest reference, not of the checklist',
  },
  validator: {
    label: 'directory validator',
    url: 'https://claude.com/docs/plugins/pre-submission-checklist#read-a-validation-result',
    blurb: 'a finding the directory\'s validator reports, observed in its output, that the checklist tables do not list',
  },
  tool: {
    label: 'this tool',
    url: null,
    blurb: 'advice from this checker; the directory does not check it',
  },
};

export const SECTIONS = {
  layout: 'Repository and folder layout',
  manifest: 'Manifest and plugin name',
  docs: 'README and license',
  files: 'Files in the plugin folder',
  runtime: 'What the plugin runs and connects to',
  components: 'Hooks, skills, commands, and agents',
  security: 'Security scan readiness',
};

/**
 * Normalize one rule declaration. `run` receives the scan context and returns an array of
 * `{ path?, detail, fix?, }` objects; the harness fills in everything else.
 */
export function defineRule(rule) {
  if (!rule.id || !rule.section || !rule.result || !rule.what) {
    throw new Error(`Rule is missing id, section, result or what: ${JSON.stringify(rule.id)}`);
  }
  if (!SECTIONS[rule.section]) throw new Error(`Unknown section "${rule.section}" in rule "${rule.id}"`);
  if (!RESULTS[rule.result]) throw new Error(`Unknown result "${rule.result}" in rule "${rule.id}"`);
  if (rule.source && !SOURCES[rule.source]) throw new Error(`Unknown source "${rule.source}" in rule "${rule.id}"`);
  const source = rule.source ?? 'checklist';
  return {
    title: null,
    fix: null,
    source,
    doc: rule.doc ?? (source === 'checklist'
      ? `${RULESET.source}${RULESET.anchor[rule.section] ?? ''}`
      : SOURCES[source].url ?? null),
    heuristic: false,
    limit: 20,
    ...rule,
    source,
  };
}

/** Turn one rule hit into the finding the report prints. */
export function toFinding(rule, hit) {
  return {
    rule: rule.id,
    section: rule.section,
    sectionLabel: SECTIONS[rule.section],
    result: rule.result,
    resultLabel: RESULTS[rule.result].label,
    // A rule can name two portal titles (npx and uvx launchers); the hit picks the right one.
    title: hit.title ?? rule.title,
    what: rule.what,
    path: hit.path ?? null,
    detail: hit.detail ?? null,
    fix: hit.fix ?? rule.fix,
    doc: rule.doc,
    source: rule.source,
    sourceLabel: SOURCES[rule.source].label,
    // A rule can be a confirmed check for one file and a heuristic for another: a launcher
    // in a script the plugin runs is behaviour, the same words in a code block are
    // documentation. The hit says which, and the rule's own flag is the fallback.
    heuristic: hit.heuristic ?? rule.heuristic,
  };
}