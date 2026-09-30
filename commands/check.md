---
description: Check a Claude Code plugin against the plugin directory's pre-submission checklist and explain every finding.
argument-hint: "[path to the plugin folder] [--worktree] [--strict]"
allowed-tools: Bash(node --version), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs:*), Read, Glob, Grep
---

Run the local checker on the plugin folder and report what it found.

It needs Node.js 18 or later. Claude Code's own installer does not bring Node with it, so
run `node --version` first; if that fails, say so and stop rather than pretending.

The checker is `scripts/preflight.mjs` in this plugin. Pass the folder the user means
(default: the current directory):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs <path>
```

If the plugin's install path holds a space, wrap it in double quotes instead. Claude Code may
ask for permission the first time: the rule above is written for the checker's own command,
not for `node` in general.

Then:

1. **Read the top of the report aloud.** Say which plugin folder and which repository were
   read, whether the files came from the last commit or from the working tree, and which
   ruleset version the report is based on.
2. **If the report lists untracked files**, the directory will not read them: it reads a
   commit. Say so, and offer to re-run with `--worktree` to check what is on disk instead.
3. **Go through the findings from the top.** Results come in the order that matters:
   *Validation stops* first, then *Blocks*, then *Held for a reviewer*, *Warnings* and
   *Notes*. For each finding, say what it means for the submission and what the fix is.
   Do not re-list findings the user can already see; add what the report does not say.
   Keep the heuristic section separate when you summarise: those findings are guesses at a
   scan nobody can run locally, they are marked `(heuristic)`, and they do not decide the
   exit code unless the user passed `--strict`. Do not describe them as portal results.
4. **Do not offer to fix anything by default.** This command reports. Ask before editing
   files, and never delete, move or rename a file to satisfy a check: tell the user what to
   remove and let them do it.
5. **Repeat the list of decisions the checker cannot make** from the end of the report, so
   nobody reads a clean run as an approval.

Useful flags: `--worktree` checks the files on disk, `--strict` lets heuristic findings
decide the exit code, `--json` prints a machine-readable report, `--md` prints Markdown.

If the user asks what a result means, or how to fix something the report does not explain,
read `skills/submission-preflight/SKILL.md` in this plugin and answer from it.