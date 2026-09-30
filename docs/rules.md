# The rules this checker applies

Generated from the ruleset by node scripts/rules-doc.mjs. Do not edit by hand.

- Ruleset version: **2026-09-30**
- Mirrors: https://claude.com/docs/plugins/pre-submission-checklist (read 2026-09-30)
- Also drawn from: https://claude.com/docs/plugins/submit, https://code.claude.com/docs/en/plugins/manifest-reference, https://code.claude.com/docs/en/hooks
- Rules: 82, plus 10 decisions listed as out of reach

Each rule below carries the result class the directory would give the same problem, the
title the portal uses in its report where the documentation gives one, and where the rule
comes from. Only the first source is the directory's own checklist; a rule from any
other source is this checker's reading of the documentation, of the directory's
validator output, or its own advice, and the directory does not check it in those words.
Edit the rule in `scripts/rules/`, not this file.

## Result classes

| Class | What the portal does |
| - | - |
| Validation stops | the portal shows "Couldn’t validate that repository" and no report. |
| Blocks | you cannot submit until you fix this and validate again. |
| Held for a reviewer | you can submit; a human reads this version before it can go live. |
| Warning | you can submit without fixing this. |
| Note | information. |

## Where a rule comes from

| Source | Meaning | Rules |
| - | - | - |
| directory checklist | a row of the pre-submission checklist | 57 |
| claude plugin validate | the plugin fails to load; the command reports it as an error | 4 |
| manifest reference | a rule of the manifest reference, not of the checklist | 3 |
| directory validator | a finding the directory's validator reports, observed in its output, that the checklist tables do not list | 1 |
| this tool | advice from this checker; the directory does not check it | 17 |

## Repository and folder layout

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| layout/os-junk-file | Blocks | macOS or Windows system file | The plugin folder contains a .DS_Store, Thumbs.db, desktop.ini or __MACOSX entry. | Remove the file from the repository (git rm --cached then delete it) and add it to .gitignore. | directory checklist |
| layout/os-junk-file-untracked | Note | — | A system file sits in the plugin folder without being committed. | Add it to .gitignore so a later commit cannot pick it up. | this tool |
| layout/symlink | Blocks | — | A symbolic link is where the plugin loads its files from. | Replace the link with the real file or folder, and commit that instead. | directory checklist |
| layout/symlink-elsewhere | Warning | — | A symbolic link sits somewhere the plugin does not load an entry from. | Only a link where the plugin loads a component blocks a submission, but replace it with the real file while you are there. | directory checklist |
| layout/submodule | Blocks | — | A Git submodule stands where the plugin loads its files from. | Commit the files themselves instead of a submodule reference. | directory checklist |
| layout/submodule-elsewhere | Warning | — | A Git submodule sits somewhere the plugin does not load an entry from. | Only a submodule where the plugin loads a component blocks a submission, but commit the files themselves while you are there. | directory checklist |
| layout/lfs-pointer | Blocks | — | A file the plugin loads is a Git LFS pointer, not the file itself. | Commit the real file, or stop tracking it with Git LFS. | directory checklist |
| layout/lfs-pointer-elsewhere | Warning | — | A Git LFS pointer sits somewhere the plugin does not load an entry from. | Only a pointer where the plugin loads a component blocks a submission, but commit the real file while you are there. | directory checklist |
| layout/invalid-name | Validation stops | Couldn’t validate that repository | A file or folder name is not valid on both Windows and macOS. | Rename the entry so it works on both systems, then commit the rename. | directory checklist |
| layout/case-conflict | Validation stops | Couldn’t validate that repository | Two names in the same folder differ only by capitalization. | Rename one of them; macOS and Windows cannot check both out side by side. | directory checklist |
| layout/plugin-path-name | Validation stops | Couldn’t validate that repository | A folder on the path from the repository root to the plugin uses characters the portal does not accept. | Rename the folder to letters, digits, dots, hyphens and underscores only. | directory checklist |
| layout/plugin-path-case | Note | — | The plugin path has to be typed with the same capitalization as the repository. | Copy the folder name from the repository when you fill in the Plugin path field. | directory checklist |
| layout/gitattributes-export | Validation stops | Couldn’t validate that repository | A .gitattributes file uses export-ignore or export-subst. | Remove those attributes; they change which files the portal sees. | directory checklist |
| layout/gitattributes-filter | Validation stops | Couldn’t validate that repository | A .gitattributes file at the repository root, above the plugin folder or inside it rewrites file contents. | Remove the filter attributes, Git LFS included, from that file. | directory checklist |
| layout/gitattributes-rewrites-content | Note | — | A .gitattributes file in scope sets an attribute that can rewrite file contents on checkout: text, eol, ident or working-tree-encoding. | If the portal reads "other attributes that rewrite file contents" as anything beyond filter, these stop validation. Keeping only line endings you need, or dropping the file, avoids the question. | this tool |
| layout/plugin-entry-too-large | Validation stops | Repository too large to validate | A file in the plugin folder is 5 MiB or larger. | Keep every file in the plugin folder below 5 MiB. | directory checklist |
| layout/repository-unpacked-size | Validation stops | Repository too large to validate | The repository is 256 MiB or larger unpacked. | Move large files out of the repository, or split the plugin into its own repository. | directory checklist |
| layout/repository-archive-size | Validation stops | Repository too large to validate | The repository is 50 MiB or larger as GitHub archives it. | Move large files out of the repository, or split the plugin into its own repository. | directory checklist |
| layout/repository-entries | Validation stops | Repository too large to validate | The repository holds 10,000 files and folders or more. | Split the plugin into its own repository. | directory checklist |
| layout/plugin-not-committed | Blocks | — | The plugin folder exists on disk, but the commit the directory would read holds none of its files. | Commit the plugin folder and push it, then validate again — or run the checker with --worktree to check what is on disk in the meantime. Until it is committed there is nothing to submit. | this tool |
| layout/ignored-component-file | Warning | — | A file inside the plugin folder is hidden by a .gitignore rule, so it is not in the commit and will not ship. | Change the ignore rule that hides it, or rename the file, so the component is committed. | this tool |
| layout/repository-not-readable | Note | — | A .git was found above the plugin folder, but Git would not read it, so the report covers the plugin folder on its own. | Point --repo at the repository root if the plugin belongs to one. | this tool |
| layout/uncommitted-files | Warning | — | Files in the plugin folder are untracked, so the commit the directory reads does not hold them. | Commit them before you validate, or run the checker with --worktree to check what is on disk instead. | this tool |
| layout/several-plugins | Note | Pick one plugin first | The repository holds more than one plugin folder. The table blocks a submission that covers several at once; this report is about one of them. | Validate and submit each plugin folder on its own; a submission covers one folder. | directory checklist |

## Manifest and plugin name

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| manifest/skills-only | Note | — | The folder has no manifest, only skills. The directory accepts this and lists the plugin for Claude Code only. | Add .claude-plugin/plugin.json if the plugin should also appear in chat and Cowork, and to declare a version. | directory checklist |
| manifest/missing | Blocks | — | The plugin folder has no .claude-plugin/plugin.json. | Add .claude-plugin/plugin.json with at least a name, a version and a description. | directory checklist |
| manifest/unreadable | Blocks | — | plugin.json is not valid JSON, so nothing else in the manifest can be checked. | Fix the JSON syntax, then run "claude plugin validate ." to confirm it loads. | claude plugin validate |
| manifest/homepage-not-a-url | Blocks | — | The homepage field does not parse as a URL, and a plugin whose homepage does not parse fails to load. | Write an absolute URL, such as https://example.com/docs. | manifest reference |
| manifest/name-missing | Blocks | — | The manifest has no name, and every component is namespaced under it. | Set "name" to your kebab-case plugin identifier. | claude plugin validate |
| manifest/name-non-ascii | Blocks | Non-ASCII identifier | The plugin name uses characters outside ASCII. | Rename the plugin with lowercase ASCII letters, digits and hyphens. | directory checklist |
| manifest/name-unloadable | Blocks | — | The plugin name uses characters that stop Claude Code from loading the plugin. | Use lowercase letters, digits and hyphens, with no spaces, colons, @ signs or path separators. | claude plugin validate |
| manifest/name-pattern | Warning | — | The plugin name is not kebab-case: lowercase letters, digits and hyphens, up to 64 characters, starting and ending with a letter or digit. | Rename the plugin, for example "deploy-tools" instead of "Deploy_Tools". | directory checklist |
| manifest/name-reserved | Blocks | Name is taken | The plugin name is a word the directory reserves: claude, anthropic, official, plugin, mcp or test. | Build the name around your own product or project name. | directory checklist |
| manifest/name-generic | Held for a reviewer | Name may be confused with an existing listing | The plugin name is built only from generic words. | Add your own distinctive product or project name to the plugin name. | directory checklist |
| manifest/identity-hazards | Blocks | — | displayName or author.name mixes writing systems, hides invisible characters, or uses look-alike letters. | Write each name in one writing system with plain characters. | directory checklist |
| manifest/component-key-misspelled | Blocks | — | A key that declares a component is spelled differently from the reference, so the component never loads. | Spell the key exactly as the manifest reference does. | directory checklist |
| manifest/component-in-experimental | Blocks | — | A component key sits inside "experimental", where Claude Code does not look for it. | Move the key to the top level of plugin.json. | directory checklist |
| manifest/component-path-outside | Blocks | — | A component path points outside the plugin folder. | Keep every file the plugin loads inside the plugin folder and write the path relative to it. | directory checklist |
| manifest/author-shape | Warning | — | author is not an object with a name. | Write "author": { "name": "Your name or team" }. | manifest reference |
| manifest/missing-metadata | Warning | — | The manifest leaves out description, author or version. | Set all three; the directory shows the description in your listing and uses the version to detect releases. | directory checklist |
| manifest/icon-missing | Warning | — | The plugin has no icon: there is no .claude-plugin/icon.svg and plugin.json sets no icon. | Add .claude-plugin/icon.svg (square, at least 128 px) or set icon in plugin.json; without it the publisher's avatar is used. | directory validator |

## README and license

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| docs/readme-missing | Blocks | README missing | The plugin folder has no README, and the directory shows the README as the listing description. | Add a README.md at the root of the plugin folder, with at least 40 words outside code blocks. | directory checklist |
| docs/readme-too-short | Blocks | README too short | The README has fewer than 40 words outside code blocks. | Describe what the plugin does, what it runs, what it sends, and how to use it. | directory checklist |
| docs/license-missing | Blocks | License missing | The plugin folder has no LICENSE file and the manifest sets no license. | Add a LICENSE file to the plugin folder, or set "license" to an SPDX identifier in plugin.json. | directory checklist |
| docs/license-not-spdx | Note | — | The license field does not look like an SPDX identifier. | Use an SPDX identifier such as MIT or Apache-2.0. | this tool |
| docs/readme-nested | Note | — | A second README sits below the plugin root. | Keep the README the listing uses at the plugin root. | this tool |

## Files in the plugin folder

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| files/oversized | Held for a reviewer | Files or downloads the validator couldn’t inspect | A file that is not an image or a font is 256 KiB or larger. | Shrink the file, generate it at run time, or move it into ${CLAUDE_PLUGIN_DATA} on first use. | directory checklist |
| files/too-many | Held for a reviewer | Files or downloads the validator couldn’t inspect | The plugin folder holds more than 512 files. | Remove generated files, or move data a user installs into ${CLAUDE_PLUGIN_DATA}. | directory checklist |
| files/binary | Held for a reviewer | Files or downloads the validator couldn’t inspect | A file in the plugin folder is a binary that is not a PNG, JPEG, GIF, WebP, SVG or font. | Remove the binary, commit readable source instead, or download the tool at run time. | directory checklist |
| files/bundled-mcp-server | Held for a reviewer | Bundled MCP server not inspected | The plugin declares an MCP server as a .mcpb or .dxt bundle. | Declare the server with "command" and "args", or with "url", instead of a bundle. | directory checklist |
| files/bundled-mcp-server-url | Blocks | Bundled MCP server not inspected | The plugin fetches an MCP server bundle from a URL. | Declare the server with "command" and "args", or with "url", instead of a bundle. | directory checklist |
| files/image-referenced-from-code | Held for a reviewer | — | A bundled image or font is referred to from a command, a hook or a script, or written inside a code block or backticks. | Show a bundled image with Markdown image syntax in the README, and keep its path out of anything that runs. | directory checklist |

## What the plugin runs and connects to

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| runtime/mcp-json-invalid | Blocks | .mcp.json can’t be parsed | .mcp.json is not valid JSON, so none of its servers load. | Fix the JSON, then run "claude plugin validate ." against the plugin folder. | directory checklist |
| runtime/mcp-server-shape | Blocks | MCP server URL is not https | An MCP server entry does not match the schema: a remote server needs a type and an absolute https or wss URL. | Give each remote server "type": "http", "sse" or "ws" and an https:// or wss:// url, and each local server "command" with "args". | directory checklist |
| runtime/mcp-server-command | Held for a reviewer | MCP server command wasn’t read | A local MCP server starts through a shell, an inline program or a package-manager script instead of running a file. | Start the server by running a file in the plugin with plain arguments, such as node ${CLAUDE_PLUGIN_ROOT}/server.js. | directory checklist |
| runtime/user-config-undeclared | Blocks | — | A ${user_config.KEY} reference in an MCP, LSP or hook config names an option the manifest does not declare. | Declare the key under userConfig in plugin.json, or remove the reference. | claude plugin validate |
| runtime/user-config-in-content | Note | — | Content in a skill, command or agent names a ${user_config.KEY} the manifest does not declare, so nothing is substituted there. | Declare the key under userConfig, or make the reference an example rather than a live one. | this tool |
| runtime/user-config-in-shell-field | Blocks | — | A shell-form hook command or a monitor command interpolates ${user_config.KEY}, which the field rejects. | Use a hook in exec form with "args", read CLAUDE_PLUGIN_OPTION_<KEY> in the hook, or let the monitor fetch the value itself. | manifest reference |
| runtime/launcher-unpinned | Blocks | Unpinned npx launcher | A package launcher runs a package that is not pinned to an exact version. | Pin the version (npx pkg@1.2.3, uvx pkg==1.2.3) or bundle the code into the plugin. | directory checklist |
| runtime/launcher-pinned | Held for a reviewer | Runs a pinned npx or uvx package | A launcher runs a registry package pinned to an exact version; a reviewer always reads this. | Nothing to fix. Expect a hold, or bundle the package into the plugin to avoid it. | directory checklist |
| runtime/package-manager-config-launcher | Blocks | Install may use a custom registry or package source | The plugin ships a package-manager configuration file and runs a package launcher. | Remove the configuration file; a plugin that uses a launcher may not point a package manager at its own registry or proxy. | directory checklist |
| runtime/package-manager-config-install | Held for a reviewer | Install may use a custom registry or package source | The plugin ships a package-manager configuration file and runs a package install. | Remove the configuration file, or expect a reviewer to read it. | directory checklist |
| runtime/lockfile-install | Held for a reviewer | Dependencies install from a lockfile | A package.json sits beside a lockfile in the root of the plugin folder, so Claude Code installs those packages when a user installs the plugin. | Nothing to fix. Expect a hold, or commit the code instead of a lockfile. | directory checklist |
| runtime/credential-literal | Blocks | — | A file holds what looks like a real credential. | Remove the value, rotate it, and ask for it through a userConfig entry with "sensitive": true, referenced as ${user_config.KEY}. | directory checklist |
| runtime/credential-looks-real (heuristic) | Blocks | — | A file assigns a long literal value to something named like a secret. | If it is a real credential, remove it and use a userConfig entry with "sensitive": true. If it is an example, make that obvious. | this tool |
| runtime/env-credential-exfiltration | Held for a reviewer | Uses a credential from the user’s machine | Something reads a credential out of the user’s environment and sends it to a server. | Ask for the value through a userConfig entry with "sensitive": true instead. | directory checklist |
| runtime/env-credential-http-hook | Blocks | Uses a credential from the user’s machine | An HTTP hook sends a credential the user already has in their environment. | Ask for the value through a userConfig entry with "sensitive": true instead. | directory checklist |
| runtime/plugin-root-path | Blocks | — | A hook or MCP server command names a path the plugin loads — a file inside the plugin, an absolute or relative path, or the script an interpreter runs — without writing it from ${CLAUDE_PLUGIN_ROOT}. | Write each path from the plugin root: "${CLAUDE_PLUGIN_ROOT}/scripts/file.sh", with no command substitution and no wildcard. ${CLAUDE_PLUGIN_DATA}, ${CLAUDE_PROJECT_DIR} and ${user_config.KEY} are the other variables these fields take. | directory checklist |
| runtime/plugin-root-path-at-root | Note | — | A hook or MCP server command names a path the plugin loads without writing it from ${CLAUDE_PLUGIN_ROOT}; the same shape blocks a submission when the plugin folder is a subfolder of the repository. | Write every path as "${CLAUDE_PLUGIN_ROOT}/scripts/file.sh". | directory checklist |
| runtime/script-follow (heuristic) | Held for a reviewer | Scripts the validator couldn’t follow | A script that a hook or an MCP server runs holds something the directory validator cannot follow. | Keep the logic in a plain shell script that names each path as ${CLAUDE_PLUGIN_ROOT}/<file>, or move the plugin to the root of its own repository. | this tool |

## Hooks, skills, commands, and agents

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| components/hooks-json-invalid | Blocks | hooks.json is invalid | A hooks file does not parse, is missing its top-level "hooks" object, uses an unknown event or handler type, or sends an HTTP hook to a URL that is not https. | Fix the file and compare it with the hooks reference; a malformed hooks file stops the plugin from loading. | directory checklist |
| components/hooks-json-declared | Warning | — | The manifest lists hooks/hooks.json in its "hooks" field, which Claude Code already loads on its own. | Remove hooks/hooks.json from the manifest "hooks" field. | directory checklist |
| components/frontmatter-broken | Blocks | — | A skill, command or agent file has front matter that does not parse, or a description that is not a single text value. | Write the front matter as "key: value" lines and keep description on one line as text. | directory checklist |
| components/frontmatter-missing | Warning | — | A skill, command or agent file has no front matter, or no description in it. | Add front matter with at least a "description" line. | directory checklist |
| components/folder-spelling | Blocks | — | A component folder or file is spelled differently from what Claude Code expects, so the component never loads. | Use skills/<name>/SKILL.md, commands/<name>.md, agents/<name>.md and hooks/hooks.json exactly. | directory checklist |
| components/folder-is-not-a-skill | Note | — | A folder under skills/ has no SKILL.md, so Claude Code does not load it as a skill. | Add a SKILL.md to the folder, or move the folder out of skills/. | directory checklist |

## Security scan readiness

| Rule | Result | Portal title | What it finds | How to fix it | Comes from |
| - | - | - | - | - | - |
| security/undisclosed-destination (heuristic) | Blocks | — | Something in the plugin sends data to a host that neither the README nor the manifest mentions. | Name every destination in the README, or stop sending to it. A plugin that sends data somewhere it does not disclose fails the security scan. | this tool |
| security/hidden-characters (heuristic) | Blocks | — | A file holds invisible or direction-changing characters, which can hide instructions from a reader. | Remove the characters. If they are not yours, treat the file as untrusted. | this tool |
| security/encoded-blob (heuristic) | Blocks | — | A file holds a long encoded block that decodes to readable text. | Commit readable source, or explain in the README what the block is and why it is encoded. | this tool |
| security/hidden-instruction-comment (heuristic) | Blocks | — | An HTML comment inside a skill, command or agent file carries instruction-shaped text. | Delete the comment. Comments are invisible in the rendered file, so a reader never sees them. | this tool |
| security/permission-change (heuristic) | Blocks | — | Something in the plugin changes Claude Code permission settings or turns permission checks off. | Remove it. A plugin that changes permissions without saying so fails the security scan. | this tool |
| security/unreadable-code (heuristic) | Blocks | — | A file holds code no reader can follow: one very long line, or a generated bundle. | Commit readable source. Code the security scan cannot read is held for a reviewer. | this tool |

## What this checker cannot decide

These are printed at the end of every report. A clean run does not settle them.

- **Whether your plugin name is already taken** The portal compares your name with every listing and blocks an exact match. Only the live directory knows the answer.
- **Whether the name, displayName or author.name can be mistaken for a brand or another publisher** A look-alike is held for a reviewer, or blocked. That is a judgement about the world, not about your files.
- **Whether the name presents the plugin as official** The table blocks a name that presents the plugin as official, and only Anthropic can say what reads that way. The reserved words are checked; the rest is a judgement about the world.
- **Whether a fork still uses the upstream project’s name** Forks are allowed; a fork that keeps the upstream name is held.
- **Whether the plugin follows the Anthropic Software Directory Policy** The policy covers behaviour: what the plugin does with data, who it targets, how it represents itself.
- **Whether the plugin passes the security scan** The scan runs on Anthropic’s side and is not public. The heuristics in this report cover the categories the documentation names, nothing more.
- **What a reviewer decides about the findings that are always held** A pinned launcher, a lockfile install, a bundled MCP server and unreadable scripts are read by a person before the version can go live.
- **Whether your GitHub account can push to the repository, and whether the repository is public** The portal checks push access when you create or submit, and publishing needs a public repository.
- **Your organisation’s remaining submissions today** Ten submissions per 24 hours, and drafts and withdrawn submissions count.
- **The data-handling answers on the submission form** Personal data, destinations other than declared connectors, retention, and whether the plugin targets people under 18.

## Known limits of these checks

- The default view reads the last commit, and `--worktree` reads the files on disk. Which one a report used is printed at the top of it.
- Rules tagged "this tool" are this checker's own advice. The directory does not check them.
- The `text`, `eol`, `ident` and `working-tree-encoding` attributes in a .gitattributes file may or may not be what the checklist means by "other attributes that rewrite file contents"; only `filter`, Git LFS included, is treated as a stop.
- The security scan runs on Anthropic's side and is not public. The rules in that section are heuristics that look for the categories the documentation names, and a clean result there is not a pass.
- The 50 MiB archive limit is estimated by deflating the tracked files in this process. The portal measures the archive GitHub builds, which this checker cannot fetch, so the number is close rather than exact.
- Launchers are read from the commands a plugin declares, the shell scripts it ships, the scripts a hook or an MCP server runs, and package.json scripts. Those are things the plugin runs, so those findings are confirmed. A launcher written in a code block of a SKILL.md, a command or an agent is an instruction rather than behaviour: it is reported as a heuristic, and it does not decide the exit code. A README and the reference files a skill keeps beside its SKILL.md are documentation and are not read at all.
- The credential rules know the shapes they know. A credential in an unusual format passes them, and a realistic example can be reported as one.
- The front matter reader checks the block as a whole and the `description` value in particular, because that is the value the table names. Other keys are read but not judged: `argument-hint: [system] [--source <path>]` is not valid YAML and is not reported as such.
- Whether a name is already listed, whether it resembles a brand, and what a reviewer decides about a held version are outside the files, and are listed in the report as such.
- The repository size and entry-count checks read the files Git tracks. In working-tree mode they read every file on disk that Git would not ignore.

Generated by directory-preflight 0.1.0.
