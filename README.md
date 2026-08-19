# Autorender AI

Agent skills that teach AI coding assistants how to build with [Autorender](https://autorender.io): uploading assets, transforming them through URL tokens, and delivering responsive images over the CDN.

Coding models carry Cloudinary and ImageKit patterns in their training data, and those patterns do not transfer. Package names, import paths, and token values all differ, and a wrong URL token may return `200` with an unchanged image or `404`, depending on how the token is parsed. This skill replaces the guess with the measured behavior.

## What's in this repo

| Path | Contents |
|------|----------|
| [skills/autorender/](skills/autorender/) | **Entry point** — environment variables, SDK selection matrix, security rules, and routing to the skill below that fits the task |
| [skills/autorender-upload/](skills/autorender-upload/) | Server and browser uploads, proxy routes, multipart, remote import, reading files back |
| [skills/autorender-transformations/](skills/autorender-transformations/) | URL token grammar — resize, crop, format, quality, focal point, effects, layers |
| [skills/autorender-view/](skills/autorender-view/) | Framework-agnostic View SDK — `createAR`, responsive `srcset`, DPR, server-side URLs |
| [skills/autorender-react/](skills/autorender-react/) | React and Vite — provider, `ARImage`, upload widget, no-server uploads |
| [skills/autorender-nextjs/](skills/autorender-nextjs/) | Next.js — App Router, Server Components, `next.config`, `nextOptimize` |
| [skills/autorender-video/](skills/autorender-video/) | `ARVideo`, the `video.js` peer, its own import path, video tokens |
| [skills/autorender-mcp/](skills/autorender-mcp/) | Managing real assets through the MCP server while building |
| [prompts/](prompts/) | Copy-paste prompts for humans and no-code builders — plain text, not skills, no shared blocks |
| [shared/](shared/) | Single source of truth for cross-skill invariants, injected by `scripts/bake-shared.mjs` |
| [.claude-plugin/](.claude-plugin/) | Claude Code plugin and marketplace manifests |
| [.cursor-plugin/](.cursor-plugin/) | Cursor plugin manifest |
| [gemini-extension.json](gemini-extension.json) | Gemini CLI extension config |
| [.mcp.json](.mcp.json) | MCP server config, read by Claude Code when the plugin is installed |

The skills teach `@autorender/js`, `@autorender/react`, `@autorender/nextjs`, and the REST API for server-side work. The entry skill also records verified install and import paths for the supported Vue, Angular, and Svelte packages; framework-specific guidance for those three is still to come.

## Install

The plugin is not listed in a curated marketplace yet, so every path below installs from this repository.

### Claude Code

```bash
/plugin marketplace add autorender/ai
/plugin install autorender@autorender
```

### Any assistant that reads Agent Skills

```bash
npx skills add autorender/ai
```

Skills installed this way do not auto-update. Run `npx skills update -y` to pull the current version.

### Gemini CLI

```bash
gemini extensions install https://github.com/autorender/ai
```

### Cursor

Cursor reads plugins from its marketplace, and Autorender is not published there yet. Until it is, use the `npx skills add` path above — the [.cursor-plugin/plugin.json](.cursor-plugin/plugin.json) manifest is in place for the listing.

## What the skills prevent

Each of these fails without an error message, which is why the skill exists:

- **Invalid URL tokens do not fail consistently.** Depending on the token, a typo may return an unoptimized `200` or a `404` indistinguishable from a bad asset path.
- **View exports live under the `/viewtag` subpath.** `import { createAR } from '@autorender/js'` returns `undefined`; the package root is the uploader.
- **There are two key types, and the wrong one returns `403`.** The public key uploads and nothing else, so it is safe in browser code; a private key grants full workspace access, including delete, and belongs on the server. A private key in a bundle is a workspace takeover; a public key on `GET /api/v1/files` is a `403`.
- **`file_name` is required on every direct upload.** Omitting it returns `400 FILE_NAME_REQUIRED`.
- **The uploader stylesheet is never injected for you.** Skip `import '@autorender/<pkg>/styles'` and the widget renders unstyled, with a clean console.
- **`ARVideo` needs `video.js`.** It is an optional peer dependency (`^8`); without it, the video entry fails to resolve or its lazy player import rejects.
- **Never hand-write a package version.** `"^1.0.0"` does not exist and `npm install` fails with `ETARGET`. Run `npm i @autorender/<pkg>` and let npm resolve it.

## MCP server

Autorender hosts a remote MCP server at `https://api-mcp.autorender.io/sse`, which lets an agent list, upload, rename, and delete assets while it builds. Authorize at `https://api-mcp.autorender.io/authorize`; the key is held server-side per connection and injected into tool calls, so it never reaches the model.

Installing the Claude Code plugin registers the server automatically, because Claude Code reads [.mcp.json](.mcp.json) from the plugin root. The leading dot is required — a file named `mcp.json` is not discovered by any client. For every other client, configure it directly:

```json
{
  "mcpServers": {
    "autorender": {
      "type": "sse",
      "url": "https://api-mcp.autorender.io/sse"
    }
  }
}
```

Two hosts, two jobs. The MCP host serves agents during a build and is not a REST proxy — fetching `/files` or `/uploads` from it returns `404`. Application backends call `https://upload.autorender.io/api/v1` with `Authorization: Bearer <api_key>`.

The server exposes **13** tools across files, folders, and multipart uploads. See [the autorender-mcp skill](skills/autorender-mcp/SKILL.md) for every tool, its parameters, and what it returns.

## Requirements

Node **22** is recommended; Node **20** is the minimum. Node 16 and 18 are EOL and unsupported.

## Contributing

Skills are authored directly under `skills/`. Report a wrong or missing fact as a GitHub issue with the URL, token, or snippet that misbehaved — a reproduction is worth more than a description, because most of these failures return `200`.

**Versioning.** Skills are versioned **independently** — bump only the `metadata.version` of the skill you changed. The four plugin manifests share one version and must agree with each other: [.claude-plugin/plugin.json](.claude-plugin/plugin.json), [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json), [.cursor-plugin/plugin.json](.cursor-plugin/plugin.json), [gemini-extension.json](gemini-extension.json). CI enforces both rules, because `claude plugin tag` rejects a plugin whose manifest and marketplace entry state different versions.

**Shared invariants.** Facts that must appear in every skill live once in [shared/](shared/) and are injected between `<!-- shared:start … -->` markers by `scripts/bake-shared.mjs`. Edit `shared/`, never a baked copy, then run `node scripts/bake-shared.mjs` and commit the result. CI runs `--check` and fails on a hand-edited block.

## License

[MIT](LICENSE)
