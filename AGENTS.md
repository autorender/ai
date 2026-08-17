# Autorender AI

This repository contains agent skills and AI integrations for [Autorender](https://autorender.io) — an image and media platform for uploading, transforming, and delivering assets at scale.

## Skills

Skills teach AI coding assistants how to use Autorender correctly.

Nine granular skills, so an agent loads only what the task needs. Each stands
alone — they never import one another.

- **[skills/autorender/](skills/autorender/)** — entry point: env vars, SDK matrix, security rules, routing
- **[skills/autorender-sandbox/](skills/autorender-sandbox/)** — HELD DRAFT; provision, upload, deliver, and claim handoff; DO NOT PUBLISH until launch approval
- **[skills/autorender-upload/](skills/autorender-upload/)** — uploads: server, browser widget, proxy routes, multipart
- **[skills/autorender-transformations/](skills/autorender-transformations/)** — URL tokens: resize, crop, format, effects
- **[skills/autorender-view/](skills/autorender-view/)** — View SDK: `createAR`, responsive images, DPR
- **[skills/autorender-react/](skills/autorender-react/)** — React and Vite
- **[skills/autorender-nextjs/](skills/autorender-nextjs/)** — Next.js App Router and Server Components
- **[skills/autorender-video/](skills/autorender-video/)** — `ARVideo` and video tokens
- **[skills/autorender-mcp/](skills/autorender-mcp/)** — managing assets through the MCP server

## MCP Server

Autorender exposes an MCP server for AI agents to manage assets directly.

See [.mcp.json](.mcp.json) for client configuration.

## Quick Start

Install the Autorender skill in your AI coding assistant — see [Install](README.md#install) for the command per client — then ask:

- "Upload an image to Autorender"
- "Show a responsive image from Autorender in React"
- "Upload a file to Autorender from a Next.js route handler"
- "Add Autorender to my Next.js app"
