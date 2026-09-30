/**
 * The two fixture plugins the integration tests check, as data.
 *
 * `clean-plugin` meets every rule. `broken-plugin` holds structural problems only: a
 * manifest with a bad name and a path that leaves the folder, a misspelled component
 * folder, front matter that does not parse, a hooks file with an unknown event and type,
 * and a README that is too short.
 *
 * They are written into a fresh temporary directory for each test run (see `fixtureDir`
 * in helpers.mjs) instead of being committed as folders. A committed copy would be two
 * more plugin folders inside this plugin's own repository, and this repository is checked
 * by the checker it ships.
 *
 * Each value is the exact text of the file, with no trailing newline where the original
 * had none. `${` is escaped so a template literal does not read it as a substitution.
 */

const cleanPlugin = {
  '.claude-plugin/plugin.json': `{
  "name": "greeting-tools",
  "displayName": "Greeting Tools",
  "version": "1.0.0",
  "description": "Greeting commands, a helper agent and a formatting hook.",
  "author": {
    "name": "Example Author"
  },
  "license": "MIT",
  "keywords": ["greeting", "example"]
}`,
  '.claude-plugin/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48"/></svg>\n',
  LICENSE: `MIT License

Copyright (c) 2026 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  'README.md': `# greeting-tools

A small example plugin used by the directory-preflight test suite. It exists to show what a
plugin folder looks like when every check the directory runs has something to pass on: a
manifest with a kebab-case name, a version and an author, a README long enough for the
listing, a license file, one skill, one command, one agent and one hook.

## What it does

The plugin greets people. It runs one shell script, and that script only prints text. It
sends nothing anywhere, it reads no credentials, and it installs nothing. There is no
network access at any point.

## Layout

- \`skills/greet/SKILL.md\` explains how to greet someone.
- \`commands/hello.md\` is a slash command that greets once.
- \`agents/helper.md\` is a small agent used by the command.
- \`hooks/hooks.json\` runs \`scripts/greet.sh\` after a tool call.`,
  'agents/helper.md': `---
name: helper
description: A small agent that checks whether a greeting is polite.
---

Read the greeting you are given and answer with "polite" or "not polite". Say nothing else.`,
  'commands/hello.md': `---
description: Print one greeting.
argumentHint: "[name]"
---

Greet the person named in the arguments, or greet the user when no name is given.`,
  'hooks/hooks.json': `{
  "description": "Print a greeting after a tool call.",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\${CLAUDE_PLUGIN_ROOT}/scripts/greet.sh"
          }
        ]
      }
    ]
  }
}`,
  'scripts/greet.sh': `#!/bin/sh
# Print one greeting. Reads no input, sends nothing anywhere.
echo "hello"`,
  'skills/greet/SKILL.md': `---
name: greet
description: Greet a person by name, in the tone the user asks for.
---

# Greet

Ask who to greet, then say hello in one short sentence. Keep the greeting plain.

Do not add a signature, a list of options or a follow-up question.`,
};

const brokenPlugin = {
  '.claude-plugin/plugin.json': `{
  "name": "Deploy_Tools",
  "displayName": "Deploy Tools",
  "author": "Example Team",
  "hooks": "./hooks/hooks.json",
  "commands": ["./commands/hello.md", "../outside/commands"],
  "mcpServers": {
    "report-api": {
      "type": "sse",
      "url": "http://api.example.com/mcp"
    }
  },
  "unexpectedKey": true
}`,
  'README.md': `# deploy-tools

Too short to pass.`,
  'Skills/demo/SKILL.md': `---
description: A skill in a folder whose name is spelled wrong.
---

Say something.`,
  'agents/helper.md': `# Helper

This file has no front matter at all.`,
  'commands/hello.md': `---
description:
  - one
  - two
---

Say hello.`,
  'hooks/hooks.json': `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\${CLAUDE_PLUGIN_ROOT}/scripts/lint.sh"
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \${CLAUDE_PLUGIN_ROOT}/scripts/lint.py"
          }
        ]
      }
    ],
    "BeforeToolUse": [
      {
        "hooks": [
          {
            "type": "webhook",
            "url": "http://example.com/hook"
          }
        ]
      }
    ]
  }
}`,
  'scripts/lint.py': `"""A hook runs this file, and it is not a shell script, so a reviewer cannot follow it."""

import sys

print("lint", sys.argv[1:])`,
  'scripts/lint.sh': `#!/bin/sh
# A plain shell script a hook runs. Nothing here should raise a finding.
echo "lint $1"`,
};

/** Fixture plugins written for each run, by name. */
export const FIXTURE_TREES = {
  'clean-plugin': cleanPlugin,
  'broken-plugin': brokenPlugin,
};
