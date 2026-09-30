/**
 * README and license.
 * Mirrors the "README and license" table of the pre-submission checklist.
 */

import { defineRule } from '../lib/registry.mjs';
import { readManifest } from './manifest.mjs';
import { countWords } from '../lib/util.mjs';

const README_NAMES = ['readme.md', 'readme.markdown', 'readme.txt', 'readme'];
/**
 * The table asks for "a README ... preferably named README.md", so any file called README
 * counts, whatever its extension: README.rst and README.adoc are READMEs too. Calling one
 * missing would be a Block on a plugin that has a README.
 */
const isReadmeName = (name) => /^readme(?:\.[a-z0-9]+)?$/i.test(name);
/**
 * A LICENSE by the names projects use: LICENSE, LICENSE.md, LICENSE-MIT and LICENSE-APACHE
 * (a dual-licensed project has both), LICENCE, COPYING, UNLICENSE, or a LICENSES folder.
 */
const isLicenseName = (rel) =>
  !/\.(?:m?js|cjs|ts|py|sh|json)$/i.test(rel)
  && /^(?:un)?licen[cs]e(?:[-_.][^/]*)?$|^copying(?:[-_.][^/]*)?$|^licenses\//i.test(rel);

/** The README the directory would read: the first match at the plugin root, else null. */
export function findReadme(scan) {
  for (const wanted of README_NAMES) {
    const entry = scan.pluginFiles.find((candidate) => candidate.pluginRel.toLowerCase() === wanted);
    if (entry) return entry;
  }
  return scan.pluginFiles.find((candidate) => isReadmeName(candidate.pluginRel)) ?? null;
}

function nestedReadme(scan) {
  return scan.pluginFiles.find((candidate) => {
    if (candidate.pluginRel === null || !candidate.pluginRel.includes('/')) return false;
    return isReadmeName(candidate.name);
  }) ?? null;
}

/**
 * The license file, from the same view as every other file. A LICENSE that sits on disk
 * without being committed is not in the submission, so it does not count here.
 */
function hasLicense(scan) {
  return scan.pluginFiles.some((candidate) => isLicenseName(candidate.pluginRel ?? ''));
}

export const docsRules = [
  defineRule({
    id: 'docs/readme-missing',
    section: 'docs',
    result: 'block',
    title: 'README missing',
    what: 'The plugin folder has no README, and the directory shows the README as the listing description.',
    fix: 'Add a README.md at the root of the plugin folder, with at least 40 words outside code blocks.',
    when: (scan) => !scan.noCommittedPluginFiles,
    limit: 1,
    run(scan) {
      if (findReadme(scan)) return [];
      const nested = nestedReadme(scan);
      return [{
        path: nested ? nested.repoRel : 'README.md',
        detail: nested
          ? `The only README is at "${nested.pluginRel}"; the directory reads one at the plugin root.`
          : 'No README file at the plugin root.',
      }];
    },
  }),

  defineRule({
    id: 'docs/readme-too-short',
    section: 'docs',
    result: 'block',
    title: 'README too short',
    what: 'The README has fewer than 40 words outside code blocks.',
    fix: 'Describe what the plugin does, what it runs, what it sends, and how to use it.',
    limit: 1,
    run(scan) {
      const entry = findReadme(scan);
      if (!entry) return [];
      const text = scan.readText(entry);
      if (text === null) return [];
      const words = countWords(text);
      if (words >= scan.limits.minReadmeWords) return [];
      return [{
        path: entry.repoRel,
        detail: `${words} word(s) outside code blocks; the directory requires ${scan.limits.minReadmeWords}.`,
      }];
    },
  }),

  defineRule({
    id: 'docs/license-missing',
    section: 'docs',
    result: 'block',
    title: 'License missing',
    what: 'The plugin folder has no LICENSE file and the manifest sets no license.',
    fix: 'Add a LICENSE file to the plugin folder, or set "license" to an SPDX identifier in plugin.json.',
    when: (scan) => !scan.noCommittedPluginFiles,
    limit: 1,
    run(scan) {
      const { data } = readManifest(scan);
      if (data && typeof data.license === 'string' && data.license.trim() !== '') return [];
      if (hasLicense(scan)) return [];
      return [{ path: null, detail: 'Neither a LICENSE file nor a "license" field in plugin.json.' }];
    },
  }),

  defineRule({
    id: 'docs/license-not-spdx',
    source: 'tool',
    section: 'docs',
    result: 'note',
    what: 'The license field does not look like an SPDX identifier.',
    fix: 'Use an SPDX identifier such as MIT or Apache-2.0.',
    limit: 1,
    run(scan) {
      const { data } = readManifest(scan);
      if (!data || typeof data.license !== 'string' || data.license.trim() === '') return [];
      if (/^[A-Za-z0-9.+-]+$/.test(data.license.trim())) return [];
      return [{ path: '.claude-plugin/plugin.json', detail: `"license": "${data.license}" is not a plain SPDX identifier.` }];
    },
  }),

  defineRule({
    id: 'docs/readme-nested',
    source: 'tool',
    section: 'docs',
    result: 'note',
    what: 'A second README sits below the plugin root.',
    fix: 'Keep the README the listing uses at the plugin root.',
    limit: 1,
    run(scan) {
      if (!findReadme(scan)) return [];
      const nested = nestedReadme(scan);
      return nested ? [{ path: nested.repoRel, detail: 'The directory reads the README at the plugin root.' }] : [];
    },
  }),
];