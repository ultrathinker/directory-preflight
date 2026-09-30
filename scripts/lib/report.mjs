/**
 * Render a report: text for a terminal, Markdown for a file, JSON for another tool.
 */

import { TOOL_NAME, TOOL_VERSION, RULESET, RESULTS, RESULT_ORDER } from './registry.mjs';
import { groupByResult, summarize } from './run.mjs';
import { humanSize, toPosix } from './util.mjs';

export const HEURISTIC_HEADING = 'POSSIBLE PROBLEMS, NOT A PORTAL RESULT';
export const HEURISTIC_BLURB =
  'These come from heuristics, not from the directory’s checklist: no local tool can run the real\n' +
  '  security scan, and an example can look like the thing it documents. They do not decide the exit\n' +
  '  code unless you pass --strict.';

/** A short line naming the ruleset a report is based on. */
export function rulesetLine() {
  return `Ruleset ${RULESET.version} · mirrors ${RULESET.source} (read ${RULESET.retrieved})`;
}

const VIEW_LABEL = {
  commit: 'the last commit (HEAD): the file list and the contents both come from it',
  index: 'the staged files; this repository has no commit yet',
  worktree: 'the working tree, including files Git does not track',
  directory: 'every file on disk',
};

function contextBlock(scan) {
  const lines = [
    `Plugin folder  : ${scan.pluginRel === '' ? '.' : scan.pluginRel}`,
    `Repository     : ${toPosix(scan.repoRoot)}`,
    `Read from      : ${VIEW_LABEL[scan.source] ?? scan.source}`,
    `Files read     : ${scan.pluginFiles.length} in the plugin folder, ${scan.files.length} in the repository, ${humanSize(scan.totalBytes)}`,
  ];
  if (scan.isGit && scan.stale) {
    lines.push('Note           : the working tree differs from the commit. This report describes the commit, which is what the directory reads.');
  }
  if (scan.unreadFiles.length > 0) {
    lines.push(`Note           : ${scan.unreadFiles.length} file(s) in the plugin folder are too large to read for the text checks; only their size was checked.`);
  }
  return lines;
}

/**
 * Heuristic findings never sit under a portal class heading. The portal's own table has
 * four results and a heuristic is not one of them, so they get their own section and a
 * marker everywhere they appear.
 */
export function splitHeuristics(findings) {
  return {
    portal: findings.filter((finding) => !finding.heuristic),
    heuristic: findings.filter((finding) => finding.heuristic),
  };
}

function ruleLabel(finding) {
  return finding.heuristic ? `[${finding.rule}] (heuristic)` : `[${finding.rule}]`;
}

function findingLines(finding, index) {
  const where = finding.path ?? '';
  const lines = [where === ''
    ? `  ${index}.  ${ruleLabel(finding)}`
    : `  ${index}. ${where}  ${ruleLabel(finding)}`];
  if (finding.title) lines.push(`     ${finding.title}: ${finding.what}`);
  else lines.push(`     ${finding.what}`);
  if (finding.detail) lines.push(`     ${finding.detail}`);
  if (finding.fix) lines.push(`     Fix: ${finding.fix}`);
  lines.push(`     Source: ${finding.sourceLabel}${finding.doc ? ` · ${finding.doc}` : ''}`);
  return lines;
}

/** The plain-text report. */
export function renderText(scan, findings, { suppressed = [], judgment = [], strict = false } = {}) {
  const summary = summarize(findings);
  const { portal, heuristic } = splitHeuristics(findings);
  const groups = groupByResult(portal);
  const lines = [
    `${TOOL_NAME} ${TOOL_VERSION} — submission readiness for a Claude Code plugin`,
    rulesetLine(),
    ...contextBlock(scan),
  ];

  for (const key of RESULT_ORDER) {
    const group = groups.get(key);
    if (group.length === 0) continue;
    lines.push('', `${RESULTS[key].label.toUpperCase()} (${group.length}) — ${RESULTS[key].blurb}`);
    group.forEach((finding, index) => lines.push(...findingLines(finding, index + 1)));
  }

  if (heuristic.length > 0) {
    lines.push('', `${HEURISTIC_HEADING} (${heuristic.length})`, `  ${HEURISTIC_BLURB}`);
    groupByResult(heuristic).forEach((group, key) => {
      if (group.length === 0) return;
      // "Would block if real", not "Blocks": the portal's class names are claims, and a
      // heuristic has not earned one.
      const conditional = { stop: 'stop validation', block: 'block', hold: 'be held', warning: 'warn', note: 'read as a note' };
      lines.push('', `  Would ${conditional[key]} if real (${group.length}):`);
      group.forEach((finding, index) => lines.push(...findingLines(finding, index + 1)));
    });
  }

  const hidden = suppressed.reduce((sum, item) => sum + item.hidden, 0);
  if (hidden > 0) {
    lines.push('', `(${hidden} more finding(s) of the same rules were not printed; --max-findings raises the cap.)`);
  }

  if (findings.length === 0) {
    lines.push('', 'No findings. Every rule this checker knows about passed.');
  }

  if (judgment.length > 0) {
    lines.push('', `WHAT THIS CHECKER CANNOT DECIDE (${judgment.length})`);
    for (const item of judgment) lines.push(`  - ${item.title}. ${item.detail}`);
  }

  if (portal.length > 0) {
    lines.push('', 'SUMMARY');
    for (const key of RESULT_ORDER) {
      const count = portal.filter((finding) => finding.result === key).length;
      if (count === 0) continue;
      lines.push(`  ${count}  ${RESULTS[key].label}`);
    }
  }
  const verdict = summary.blockingConfirmed > 0
    ? `${summary.blockingConfirmed} finding(s) stop validation or block a submission. The directory decides whether it accepts the plugin; this is what it would report.`
    : summary.blockingHeuristic > 0
      ? `nothing confirmed blocks a submission. ${summary.blockingHeuristic} heuristic finding(s) would block if they are real, and ${heuristic.length} in total need your reading.`
      : 'no blocking findings. The directory still decides: run it with no findings and it can still hold or reject a version.';
  lines.push('', `Result: ${verdict}`);
  return lines.join('\n');
}

/** One finding as Markdown list items, with the portal's own title when it has one. */
function markdownFinding(finding) {
  const where = finding.path ? `\`${finding.path}\` ` : '';
  const title = finding.title ? `**${finding.title}.** ` : '';
  const lines = [
    `- ${where}${title}${finding.detail ?? finding.what} \`${finding.rule}\`${finding.heuristic ? ' _(heuristic)_' : ''}`,
  ];
  if (finding.fix) lines.push(`  - Fix: ${finding.fix}`);
  lines.push(`  - Source: ${finding.sourceLabel}${finding.doc ? ` · [documentation](${finding.doc})` : ''}`);
  return lines;
}

/** The Markdown report, for pasting into an issue or a pull request. */
export function renderMarkdown(scan, findings, { suppressed = [], judgment = [], strict = false } = {}) {
  const { portal, heuristic } = splitHeuristics(findings);
  const groups = groupByResult(portal);
  const lines = [
    `# Preflight report: ${scan.pluginRel === '' ? scan.pluginName : scan.pluginRel}`,
    '',
    `- ${rulesetLine()}`,
    `- Plugin folder: \`${scan.pluginRel === '' ? '.' : scan.pluginRel}\``,
    `- Repository: \`${toPosix(scan.repoRoot)}\``,
    `- Read from: ${VIEW_LABEL[scan.source] ?? scan.source}`,
    `- Files read: ${scan.pluginFiles.length} in the plugin folder, ${scan.files.length} in the repository, ${humanSize(scan.totalBytes)}`,
    '',
  ];
  for (const key of RESULT_ORDER) {
    const group = groups.get(key);
    if (group.length === 0) continue;
    lines.push(`## ${RESULTS[key].label} (${group.length})`, '', `_${RESULTS[key].blurb}_`, '');
    for (const finding of group) {
      lines.push(...markdownFinding(finding));
    }
    lines.push('');
  }
  if (heuristic.length > 0) {
    lines.push(`## ${HEURISTIC_HEADING} (${heuristic.length})`, '', `_${HEURISTIC_BLURB.replace(/\n\s+/g, ' ')}_`, '');
    for (const finding of heuristic) lines.push(...markdownFinding(finding));
    lines.push('');
  }
  if (findings.length === 0) lines.push('No findings. Every rule this checker knows about passed.', '');
  if (judgment.length > 0) {
    lines.push(`## What this checker cannot decide (${judgment.length})`, '');
    for (const item of judgment) lines.push(`- **${item.title}.** ${item.detail}`);
    lines.push('');
  }
  lines.push('## Summary', '');
  for (const key of RESULT_ORDER) {
    const count = portal.filter((finding) => finding.result === key).length;
    if (count > 0) lines.push(`- ${count} ${RESULTS[key].label}`);
  }
  if (heuristic.length > 0) lines.push(`- ${heuristic.length} heuristic finding(s), which are not a portal result`);
  if (suppressed.length > 0) {
    lines.push(`- ${suppressed.reduce((sum, item) => sum + item.hidden, 0)} further finding(s) not printed (--max-findings)`);
  }
  lines.push('', '---', '', `Generated by ${TOOL_NAME} ${TOOL_VERSION} with ruleset ${RULESET.version}.`);
  return lines.join('\n');
}

/** The JSON report. */
export function renderJson(scan, findings, { suppressed = [], judgment = [], strict = false } = {}) {
  const summary = summarize(findings);
  return {
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    ruleset: { version: RULESET.version, retrieved: RULESET.retrieved, source: RULESET.source, alsoFrom: RULESET.alsoFrom },
    target: {
      pluginFolder: scan.target,
      repository: scan.repoRoot,
      pluginPathInRepository: scan.pluginRel === '' ? '.' : scan.pluginRel,
      source: scan.source,
      workingTreeHasUncommittedChanges: Boolean(scan.stale),
      filesRead: scan.files.length,
      filesInPluginFolder: scan.pluginFiles.length,
      bytesRead: scan.totalBytes,
    },
    summary: {
      total: summary.total,
      byResult: summary.counts,
      heuristicFindings: summary.heuristic,
      blockingConfirmed: summary.blockingConfirmed,
      blockingHeuristic: summary.blockingHeuristic,
    },
    findings: findings.map((finding) => ({ ...finding })),
    suppressed,
    cannotDecide: judgment,
  };
}