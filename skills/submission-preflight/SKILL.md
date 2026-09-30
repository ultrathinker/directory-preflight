---
name: submission-preflight
description: Explain what the plugin directory checks before it lists a plugin, run a local check of a plugin folder against that checklist, and turn each finding into a concrete fix. Use when someone asks whether a plugin is ready to submit, what "held for a reviewer" means, why a submission was blocked, or how to prepare a plugin for the Claude plugin directory.
allowed-tools: Bash(node --version), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs:*)
---

# Preparing a plugin for the directory

Anthropic's plugin directory validates a plugin folder when you press **Validate** in the
developer portal, and scans it again after you submit. The portal's report is the authority,
and you can re-validate as often as you like — but it needs a push and the portal, it cannot
run in your editor or in CI, and an organisation can only create ten submissions in any 24
hours. `claude plugin validate` catches syntax and schema problems only; the portal checks
much more.

## Run the local check first

The checker in this plugin reads a plugin folder and prints the findings the portal's
tables describe, each with the result class the portal would give it.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs <plugin folder>
```

If the install path holds a space, wrap it in double quotes; Claude Code then asks for
permission the first time instead of running it straight away.

It reads files and prints a report. It never writes, moves or deletes anything, and it
makes no network calls. It needs Node.js 18 or later on PATH: Claude Code's own installer
does not provide Node, so check `node --version` first and say so if it fails.

The default view is the last commit, contents and file list both, because that is what the
directory reads: a file you edited but did not commit is not in the submission. Add
`--worktree` to check what is on disk instead. `--json` gives a machine-readable report,
`--md` gives Markdown, `--strict` lets heuristic findings decide the exit code.

## What the result classes mean

| Class | What the portal does |
| - | - |
| Validation stops | The form shows *Couldn't validate that repository* and no findings at all. A repository-level problem, such as a file name Windows cannot check out or a `.gitattributes` that rewrites files. Fix these before anything else, because they hide every other finding. |
| Blocks | You cannot submit until you fix it and validate again. |
| Held for a reviewer | You can submit. A person reads the held version before it can go live. A hold is not a rejection, and the scan can raise it again on each new version. |
| Warning | You can submit without fixing it. |
| Note | Information. |

The directory's tables give those five results, and the checker uses those five.
**Heuristics** — its own guesses at the security scan, and an example that looks like the
thing it documents — are printed in a separate section, marked `(heuristic)`, and do not
decide the exit code unless the user passes `--strict`.

Every other finding decides the exit code, whatever its source. Some of them are not
checklist rows and still stop a submission: a plugin folder that is not in the commit, a
manifest Claude Code cannot load (it does not parse, its name is unusable, or `homepage` is
not a URL), and a `user_config` key that a config uses but the manifest does not declare or
that sits in a shell-form hook command. Each finding prints where it comes from, so say
which is which when you report a result: a heuristic is a guess, and the security scan it
is guessing at is not public.

## The findings that surprise people

- **README.** At least 40 words outside code blocks, at the root of the plugin folder. The
  directory shows it as your listing description, so words in code blocks do not count
  towards the limit and do not appear in the listing either.
- **License.** A `LICENSE` file in the plugin folder, or a `license` field in the manifest.
- **File size.** Every file in the plugin folder that is not an image or a font must stay
  under 256 KiB. This catches generated files and data dumps that were committed by
  accident. Anything at 5 MiB or more stops validation outright.
- **Package launchers.** A launcher that downloads a package and runs it must name an exact
  version. Naming a range, a tag such as latest, or nothing at all blocks a submission;
  naming an exact version passes validation and is held, because the package still resolves
  its own dependencies at install time. This covers the npm and Python launchers alike, and
  the Python runner additionally has to be given its locked or frozen flag. Bundling the
  package's code into the plugin avoids the finding entirely.
- **Credentials.** A real credential in any file blocks a submission, examples included.
  Ask for values through a `userConfig` entry with `"sensitive": true`, and reference the
  value where the plugin needs it — the manifest reference shows the exact syntax. Reading
  a credential that is already in the user's environment and sending it anywhere is held,
  and an HTTP hook that does it is blocked.
- **MCP servers.** A remote server needs a `type` of `http`, `sse` or `ws` and an absolute
  `https://` or `wss://` URL. A local server should run a file in the plugin with plain
  arguments, not through a shell, an inline program or `npm run`.
- **Paths.** When the plugin is a subfolder of its repository, every path in a hook or MCP
  command has to be written in full from `${CLAUDE_PLUGIN_ROOT}`, with no other variable,
  command substitution, wildcard or inline program. Keeping the plugin at the root of its
  own repository turns this block into a note.
- **Component spelling.** `skills/<name>/SKILL.md`, `commands/<name>.md`,
  `agents/<name>.md`, `hooks/hooks.json`. A folder named `Skills` loads nothing at all, and
  Claude Code will not tell you why.
- **Front matter.** Each skill, command and agent file needs YAML front matter whose
  `description` is a single text value, not a list.
- **The security scan.** It runs on Anthropic's side after you submit and is not public. A
  first submission that fails it is rejected. Describe in the README everything the plugin
  runs, sends or fetches, and commit readable source rather than compiled or minified code.
  The checker's own heuristics for this are guesses, and it says so.
- **Files hidden by an ignore rule.** A component that a `.gitignore` pattern keeps out of
  the commit never ships, and nothing in the plugin says a word about it. The checker names
  the rule that hides it; if `git ls-files` does not list a component, that is the first
  thing to look at.

## What no local tool can decide

Name collisions and look-alikes need the live directory. Brand confusion, fork naming and
the Software Directory Policy are human judgements. Whether your GitHub account can push to
the repository, and the data-handling answers on the submission form, are outside the
files. The checker lists these at the end of every report rather than printing a false
"pass". Read that list to the user.

## Reporting a result

Say which ruleset version the report is based on, so an old report is visibly old. Never
tell someone their plugin is approved or will be approved: the directory decides. Say what
was checked, what was found, and what is left for a reviewer.

## Keeping the rules current

The rules live in `scripts/rules/`, one file per section of the pre-submission checklist,
and each rule carries its own id, result class, portal title, fix hint and documentation
link. When the documentation changes, edit the rule that changed, move the ruleset date in
`scripts/lib/registry.mjs`, regenerate `docs/rules.md`, and run the tests.