/**
 * The full ruleset, in the order the pre-submission checklist presents its tables.
 * Add a rule by writing it in the file for its section; it joins the report automatically.
 */

import { layoutRules } from './layout.mjs';
import { manifestRules } from './manifest.mjs';
import { docsRules } from './docs.mjs';
import { filesRules } from './files.mjs';
import { runtimeRules } from './runtime.mjs';
import { componentRules } from './components.mjs';
import { securityRules } from './security.mjs';

export const RULES = [
  ...layoutRules,
  ...manifestRules,
  ...docsRules,
  ...filesRules,
  ...runtimeRules,
  ...componentRules,
  ...securityRules,
];

/**
 * Decisions the directory makes that no local tool can make. The report prints these
 * instead of implying that a clean run means a clean review.
 */
export const JUDGMENT_ITEMS = [
  {
    id: 'name-taken',
    title: 'Whether your plugin name is already taken',
    detail: 'The portal compares your name with every listing and blocks an exact match. Only the live directory knows the answer.',
  },
  {
    id: 'brand-look-alike',
    title: 'Whether the name, displayName or author.name can be mistaken for a brand or another publisher',
    detail: 'A look-alike is held for a reviewer, or blocked. That is a judgement about the world, not about your files.',
  },
  {
    id: 'presents-as-official',
    title: 'Whether the name presents the plugin as official',
    detail: 'The table blocks a name that presents the plugin as official, and only Anthropic can say what reads that way. The reserved words are checked; the rest is a judgement about the world.',
  },
  {
    id: 'fork-name',
    title: 'Whether a fork still uses the upstream project’s name',
    detail: 'Forks are allowed; a fork that keeps the upstream name is held.',
  },
  {
    id: 'policy',
    title: 'Whether the plugin follows the Anthropic Software Directory Policy',
    detail: 'The policy covers behaviour: what the plugin does with data, who it targets, how it represents itself.',
  },
  {
    id: 'security-scan',
    title: 'Whether the plugin passes the security scan',
    detail: 'The scan runs on Anthropic’s side and is not public. The heuristics in this report cover the categories the documentation names, nothing more.',
  },
  {
    id: 'reviewer-holds',
    title: 'What a reviewer decides about the findings that are always held',
    detail: 'A pinned launcher, a lockfile install, a bundled MCP server and unreadable scripts are read by a person before the version can go live.',
  },
  {
    id: 'repository-access',
    title: 'Whether your GitHub account can push to the repository, and whether the repository is public',
    detail: 'The portal checks push access when you create or submit, and publishing needs a public repository.',
  },
  {
    id: 'submission-limits',
    title: 'Your organisation’s remaining submissions today',
    detail: 'Ten submissions per 24 hours, and drafts and withdrawn submissions count.',
  },
  {
    id: 'data-handling',
    title: 'The data-handling answers on the submission form',
    detail: 'Personal data, destinations other than declared connectors, retention, and whether the plugin targets people under 18.',
  },
];