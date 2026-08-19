# Autorender AI — Repo Guide

Distribution repo for Autorender agent skills and AI integrations.

## Structure

```
skills/autorender/               ← entry point: env, SDK matrix, security, routing
skills/autorender-upload/        ← uploads: server, widget, proxy, multipart
skills/autorender-transformations/ ← URL token grammar
skills/autorender-view/          ← framework-agnostic View SDK
skills/autorender-react/         ← React and Vite
skills/autorender-nextjs/        ← Next.js
skills/autorender-video/         ← ARVideo and video tokens
skills/autorender-mcp/           ← MCP asset management during a build

prompts/                 ← copy-paste prompts for humans and no-code builders
  agent-onboarding.md    ← sandbox API reference pasted into Lovable/v0/Bolt

shared/                  ← single source of truth for cross-skill invariants
  preamble.md            ← the anti-prior warning
  env-vars.md            ← environment variable table
  invariants/            ← width ladder, crop modes, API keys, unknown tokens
  required.json          ← which blocks each file MUST carry
scripts/
  bake-shared.mjs        ← injects shared blocks; `--check` gates CI
  lib/bake.mjs           ← pure logic, unit tested

.claude-plugin/          ← Claude Code plugin + marketplace manifests
.cursor-plugin/          ← Cursor plugin manifest
.mcp.json                ← MCP server config (leading dot is required)
gemini-extension.json    ← Gemini CLI config
README.md                ← public entry point: install paths per client
AGENTS.md                ← agent-facing repo summary
LICENSE                  ← MIT
```

## Editing skills

Edit the relevant `skills/<name>/SKILL.md` directly. Skills are **independently
versioned** — bump only the skill you changed. The four plugin manifests
(`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`.cursor-plugin/plugin.json`, `gemini-extension.json`) share one version and must
agree with each other; CI enforces both rules.

Every fact in a skill is verified against the published SDK types, the
live API, or a live CDN request before it ships. Do not add a claim from memory,
and do not describe planned behavior as though it exists.

## Shared invariants — do not hand-edit baked text

Skills cannot import one another. An agent selects and loads a **single**
`SKILL.md` by matching a prompt against each skill's `description`, so any
invariant that must never be missed has to be physically present in every skill
that could be loaded alone. Duplicating that text by hand guarantees drift, so it
is generated instead.

`shared/` holds each invariant once. A skill opts in by placing a marker pair
where the text belongs:

```
<!-- shared:start width-ladder -->
<!-- shared:end width-ladder -->
```

Then run:

```bash
node scripts/bake-shared.mjs          # inject; commit the result
node scripts/bake-shared.mjs --check  # what CI runs
node --test "scripts/**/*.test.mjs"   # 58 tests
```

Rules worth knowing before you touch it:

- **Edit `shared/`, never the baked copy.** `--check` fails on a hand-edited
  block. That failure is the mechanism working, not a bug.
- **The injected text is committed.** `npx skills add` and Claude Code read this
  repo raw — there is no install step to generate anything.
- A block lives at `shared/<name>.md` **or** `shared/invariants/<name>.md`, never
  both; `invariants/` is for the safety-critical facts an agent must not get
  wrong. Defining a name twice is an error.
- **Blocks own their `##` heading**, so place markers at top-level section depth.
- Blocks do not nest, and a mismatched pair is an error rather than a silent
  skip — that silence was the whole failure mode this replaces.
- `shared/required.json` lists the blocks a file **must** carry. Adding a skill
  without them fails CI by design; amend the policy deliberately, not reflexively.
- A shared source may not itself contain marker syntax, so this mechanism is
  documented here rather than in a file under `skills/`.
