/**
 * Run the ruleset over a scan, collect the findings, and summarize them.
 */

import { toFinding, RESULT_ORDER, BLOCKING_RESULTS, SECTIONS } from './registry.mjs';

const SECTION_ORDER = Object.keys(SECTIONS);

/** Run every rule against the scan. A rule that throws becomes a finding, never a crash. */
export function runRules(scan, rules) {
  const findings = [];
  const suppressed = [];
  for (const rule of rules) {
    if (typeof rule.when === 'function' && !rule.when(scan)) continue;
    let hits;
    try {
      hits = rule.run(scan) ?? [];
    } catch (error) {
      hits = [{
        path: null,
        detail: `The check failed to run: ${error.message}`,
        fix: 'This is a bug in directory-preflight, not in the plugin under inspection.',
      }];
    }
    const cap = Math.max(0, Math.min(rule.limit, scan.limits?.maxFindingsPerRule ?? rule.limit));
    const kept = hits.slice(0, cap);
    if (hits.length > kept.length) suppressed.push({ rule: rule.id, hidden: hits.length - kept.length });
    for (const hit of kept) findings.push(toFinding(rule, hit));
  }
  return { findings, suppressed };
}

/** Sort findings the way the report prints them: by result, then section, then rule. */
export function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const byResult = RESULT_ORDER.indexOf(left.result) - RESULT_ORDER.indexOf(right.result);
    if (byResult !== 0) return byResult;
    const bySection = SECTION_ORDER.indexOf(left.section) - SECTION_ORDER.indexOf(right.section);
    if (bySection !== 0) return bySection;
    if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
    return String(left.path ?? '').localeCompare(String(right.path ?? ''));
  });
}

/** Counts by result class, with the heuristic split called out. */
export function summarize(findings) {
  const counts = Object.fromEntries(RESULT_ORDER.map((key) => [key, 0]));
  let heuristic = 0;
  for (const finding of findings) {
    counts[finding.result] += 1;
    if (finding.heuristic) heuristic += 1;
  }
  const blocking = RESULT_ORDER.filter((key) => BLOCKING_RESULTS.has(key))
    .reduce((sum, key) => sum + counts[key], 0);
  const blockingHeuristic = findings.filter((finding) => BLOCKING_RESULTS.has(finding.result) && finding.heuristic).length;
  return {
    counts,
    total: findings.length,
    heuristic,
    blocking,
    /** Findings that decide the exit code: blocking, and not a heuristic. */
    blockingConfirmed: blocking - blockingHeuristic,
    blockingHeuristic,
  };
}

/** Group findings by result class, keeping the report's order. */
export function groupByResult(findings) {
  const groups = new Map();
  for (const key of RESULT_ORDER) groups.set(key, []);
  for (const finding of findings) groups.get(finding.result).push(finding);
  return groups;
}

/** The exit code: 1 when a blocking finding is confirmed, 0 otherwise. */
export function exitCodeFor(summary, { strict = false } = {}) {
  if (strict ? summary.blocking > 0 : summary.blockingConfirmed > 0) return 1;
  return 0;
}