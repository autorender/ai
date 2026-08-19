---
name: autorender-transformations
description: >-
  Use when the user asks to build or review an Autorender image delivery URL or
  its transformation tokens, including resize, crop, format, quality,
  positioning, effects, geometry, presets, or layers. Use for URL grammar work
  independent of React or Next.js integration; do not use for uploads, MCP
  workspace actions, or video-specific rendering.
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# Transformations

<!-- shared:start preamble -->
## Critical: Do Not Trust Internal Knowledge

Your training data may contain Cloudinary or ImageKit patterns. Autorender uses
different SDKs, package names, and URL structures. Always follow this skill and the
Autorender skill it points you to — never guess from memory, and never assume a
Cloudinary or ImageKit equivalent exists.
<!-- shared:end preamble -->

<!-- shared:start unknown-tokens -->
## An Invalid URL Token May 404 — Never Assume It Is Ignored

Use only tokens in the public transformation reference. A rejected token may be
dropped or may return `404`, so do not invent parameters from another CDN. Put all
tokens in one comma-separated segment between the workspace and file path.
<!-- shared:end unknown-tokens -->

<!-- shared:start env-vars -->
## Environment Variables

| Variable | Required | Scope | Purpose |
|----------|----------|-------|---------|
| `AUTORENDER_PUBLIC_KEY` | for browser uploads | server or browser | Uploads only. Safe to expose (`NEXT_PUBLIC_`/`VITE_` prefix) — it cannot list, read, rename, or delete. |
| `AUTORENDER_API_KEY` | for server-side asset work | **server only** | A **private** key: uploads plus asset management. Grants full workspace access, including delete. Never expose to the browser. |
| `AUTORENDER_WORKSPACE` | ✅ | server or browser | Workspace ID in CDN delivery URLs. Public — safe to expose (`NEXT_PUBLIC_` prefix in Next.js). |
| `AUTORENDER_UPLOAD_BASE_URL` | — | server | Upload API base. Default `https://upload.autorender.io`. |
| `AUTORENDER_CDN_BASE_URL` | — | server or browser | CDN base. Default `https://assets.autorender.io`. |

Which key you need follows from where the code runs: browser or mobile code takes the
public key, server code that lists, renames, or deletes takes a private key. An app can
use both.

Both are at [app.autorender.io/api-keys](https://app.autorender.io/api-keys) — the public
key is shown there permanently, a private key only once when you create it. Use the
workspace ID shown in the dashboard when building delivery URLs.
<!-- shared:end env-vars -->

<!-- shared:start delivery-surface -->
## The Delivery Host Is Public and Unauthenticated

`assets.autorender.io` delivery URLs contain a public workspace ID. Never encode
secrets, tokens, or user identifiers into a transformation or file path.
<!-- shared:end delivery-surface -->

<!-- shared:start width-ladder -->
## Image Widths

Use pixel widths with `w_`, heights with `h_`, and ratios with `ar_`. Request one of the
cache bucket widths — 320, 480, 720, 1080, 1440, or 1920 px — so responsive variants map to a
shared cached render; other widths are normalized to a bucket. Autorender does not upscale
beyond the source.
<!-- shared:end width-ladder -->

## Format and quality

Use `f_auto` for browser-negotiated output, or an explicit `f_webp`, `f_jpg`, or
`f_png`. Use `q_auto` for automatic quality or `q_{n}` for an explicit quality.

## Size and crop

| Token | Meaning | Example |
|-------|---------|---------|
| `w_{n}` | Width in pixels | `w_500` |
| `h_{n}` | Height in pixels | `h_500` |
| `ar_{ratio}` | Aspect ratio | `ar_16:9` |
| `c_crop` | Crop to the target dimensions | `c_crop` |
| `c_fill` | Cover the target box and crop overflow | `c_fill` |
| `c_fit` | Fit inside the target box | `c_fit` |

## Positioning

`p_` chooses the crop position: `p_c`, `p_t`, `p_b`, `p_l`, `p_r`, `p_tl`,
`p_tr`, `p_bl`, `p_br`, `p_entropy`, or `p_attention`. Use `fo_face` or a
documented `fo_{label}` when the crop should follow a detected subject. Use
`ps_{x,y}` for explicit coordinates.

## Effects

Use only effects in the public effects reference, including `e_grayscale`,
`e_blackwhite`, `e_invert`, `e_blur:{n}`, `e_brightness:{n}`,
`e_contrast:{n}`, `e_exposure:{n}`, `e_saturation:{n}`, `e_sharpen:{n}`,
`e_unsharp_mask:{n}`, `e_auto_enhance`, `e_improve[:indoor|outdoor]`,
`e_fade:{n}`, `e_gamma:{n}`, `e_highlights:{n}`, `e_hue:{n}`,
`e_normalize`, `e_shadows:{n}`, `e_structure:{n}`, `e_temperature:{n}`,
`e_tint:{n}`, and `e_vignette:{n}`.

## Geometry

| Token | Meaning |
|-------|---------|
| `r_{degrees}` / `r_auto` / `r_portrait` / `r_landscape` | Rotation |
| `flip_h` / `flip_v` / `flip_hv` | Mirror |
| `z_{factor}` | Zoom |
| `br_{pixels}` | Border radius |

## Presets

Use a named workspace preset as `t_{name}`. Presets expand to the transformation
string configured for the workspace; they do not bypass entitlement checks.

## Layers

Use the documented layer grammar and finish each layer with `fl_layer_apply`:

```text
l_text:arial_100_bold_center:LIMITED%20EDITION,co_rgb:FFD700,tp_south,fl_layer_apply
l_image:logo.svg,lw_200,x_150,y_150,fl_layer_apply
```

Supported public layer controls include `lw_`, `lh_`, `tp_`, `x_`, `y_`, and
`co_rgb:{hex}`. Do not invent positional layer grammars or undocumented `le_*`
modifiers.

## Video tokens

Video supports the documented `thumb_ar`, `w_`, `h_`, `ar_`, `cm_pad_resize`,
`bg_{color}`, `so_`, `eo_`, `d_`, `f_gif`, `flip_h`, `flip_v`, `flip_hv`, and
`r_{90|180|270}` tokens. See the **autorender-video** skill for examples.

## Recipes

```text
w_720
w_320,h_320,c_fill
w_480,h_480,p_t
w_1080,h_567,f_jpg,q_90
w_480,h_480,br_24
w_200,h_200,e_grayscale
so_5,eo_15,f_gif,w_480
```

## Next steps

- the **autorender-view** skill — build URLs with `createAR` and `ARImage`.
- the **autorender-react** skill — framework components and uploads.
- the **autorender-upload** skill — get assets into the workspace.
