# directory-preflight

[![ci](https://github.com/ultrathinker/directory-preflight/actions/workflows/ci.yml/badge.svg)](https://github.com/ultrathinker/directory-preflight/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Check a Claude Code plugin against the rules of Anthropic's plugin directory pre-submission checklist
**before** you push, and see each finding under the result the checklist gives that shape: **Blocks**,
**Held for a reviewer**, **Warning**, or **Note**. The directory's own report is the authority; this is the
same ground covered locally, without a push.

`claude plugin validate` tells you whether your files are well-formed. The directory checks a lot more than that:
README length, license, file sizes, unpinned package launchers, credentials in examples, MCP server URLs, hook
events, `.gitattributes`, names Windows or macOS cannot check out. The portal does show you a report — its
**Validate** button runs the whole checklist and you can re-validate as often as you like — but it needs a push
first, it needs the portal, and it does not run in your editor or in CI. This plugin is the same loop, locally
and offline: fix, re-run, repeat, and only then go and validate.

## Install

```
/plugin marketplace add ultrathinker/directory-preflight
/plugin install directory-preflight@directory-preflight
```

Or clone the repository and point Claude Code straight at the folder, with no marketplace:

```
git clone https://github.com/ultrathinker/directory-preflight
claude --plugin-dir ./directory-preflight
```

**It needs Node.js 18 or later on your PATH.** Claude Code's own installer does not bring Node with it, so if
`node --version` fails, install Node first or run the checker from a machine that has it. That is the only
requirement: the plugin ships no `package.json`, installs nothing, and makes no network requests.

## Use

Inside Claude Code:

```
/directory-preflight:check                  # check the plugin in the current directory
/directory-preflight:check ../my-plugin     # check another folder
```

From a shell, anywhere:

```
node scripts/preflight.mjs ../my-plugin
node scripts/preflight.mjs ../my-plugin --json
node scripts/preflight.mjs ../my-plugin --md > report.md
```

Claude also reaches for the `submission-preflight` skill when you ask whether a plugin is ready to submit, and
the `submission-checker` agent when you want a verdict on the parts no checker can decide.

## What the report tells you

By default the checker reads **the last commit**, not the files on disk: the directory reads a commit, its
verdict is tied to one commit, and a file you edited but did not commit is not in the submission. The list of
files and their contents both come from that commit, so the two can never disagree. `--worktree` swaps both for
the working tree when you want to see what you are looking at.

| Result | What the portal does with it |
| - | - |
| **Validation stops** | No report at all: the form shows *Couldn't validate that repository*. Fix these first, because they hide everything else. |
| **Blocks** | You cannot submit until you fix the problem and validate again. |
| **Held for a reviewer** | You can submit, and a human reads the held version before it can go live. A hold is not a rejection. |
| **Warning** | You can submit without fixing it. |
| **Note** | Information. Nothing to fix. |

The directory's tables list five results and this checker uses those five. Its **heuristics** — guesses at the
security scan, and an example that looks like the thing it documents — are printed in a separate section, marked
`(heuristic)`, and do not decide the exit code unless you pass `--strict`. The biggest of those is the security
scan, which is not public: the checker looks for the categories the documentation names and says plainly that it
is guessing. Everything else decides the exit code, whatever its source. Some findings that are not checklist
rows still stop a submission: a plugin folder that is not in the commit, a manifest Claude Code cannot load (it
does not parse, its name is unusable, or `homepage` is not a URL), and a `${user_config.KEY}` that a config uses
but the manifest does not declare or that sits in a shell-form hook command. Each finding prints where it comes
from.

Every finding names the rule, what was found, a concrete fix, and where the rule comes from. At the end comes
the list of decisions a local tool cannot make — name collisions, brand look-alikes, reviewer holds, the scan —
so a clean run is never mistaken for an approval.

## Options

| Option | What it does |
| - | - |
| `--worktree` | Check the files on disk instead of the last commit. |
| `--json` | Print a machine-readable report. |
| `--md` | Print a Markdown report. |
| `--strict` | Let heuristic findings decide the exit code. |
| `--quiet` | Print only the findings that block a submission. |
| `--max-findings <n>` | Cap how many findings one rule prints. Default 20. |
| `--limit <name=n>` | Override one threshold, such as `maxPluginFiles=3`; the names are the keys of `DEFAULT_LIMITS` in `scripts/lib/scan.mjs`. |
| `--repo <path>` | Treat this folder as the repository root instead of finding it. |
| `--no-judgment` | Leave out the list of decisions the checker cannot make. |

Exit codes: `0` when nothing in the portal's blocking classes was found, `1` when at least one finding stops
validation or blocks a submission, `2` when the checker could not run at all. Heuristic findings never decide
the exit code unless you pass `--strict`, so a plausible false positive cannot break your build on its own.

## What it does not do

- It does not reproduce the directory's validation. It cannot: some checks need the live directory to answer,
  such as whether a name is taken.
- It does not reproduce the security scan, which is not public. Those rules are heuristics, marked as such.
- It does not check the Anthropic Software Directory Policy, which covers behaviour a local tool cannot judge.
- It does not decide whether a name, a display name or an author looks like someone else's, or what a reviewer
  does with a held version. It lists those as out of reach instead.
- A clean report is not an acceptance. `docs/rules.md` lists every rule, what it checks, and where it comes
  from, including the places where the local check is weaker than the real thing.

## Privacy

The checker reads files and prints a report. It never writes, moves, renames or deletes anything, it runs every
Git command with `--no-optional-locks` so it does not even refresh your index, and it makes no network requests.
Nothing it reads leaves your machine, and it never looks at Claude's memory, chat history or session
transcripts. Privacy: `PRIVACY.md`. Security reports: `SECURITY.md`.

## Updating the rules

The directory's rules change. Everything this checker knows lives in `scripts/rules/`, one file per section of
the pre-submission checklist, and each rule carries its own id, result class, where it comes from, the portal's
title for that finding where the documentation gives one, and a fix hint. To follow a documentation change, edit
the rule that changed, move the ruleset date in `scripts/lib/registry.mjs`, regenerate the catalogue, and run
the tests:

```
node scripts/rules-doc.mjs > docs/rules.md
node --test tests/*.test.mjs
```

Every report prints the ruleset version and the documentation it was written against, so nobody has to guess
how old a report is.

## License

MIT. See `LICENSE`.