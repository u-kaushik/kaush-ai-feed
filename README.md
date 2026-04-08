# ai-digest

Lean daily AI digest for Utkarsh.

This is the simple home for:
- a card-based AI news feed you can open and browse
- a shared digest Jarvis can reference in chat
- a morning HTML email built from the same feed items

## What it does

- keeps one unified feed in `data/ai-feed.json`
- renders that feed in a lightweight static UI
- groups items like GitHub repos, YouTube videos, tools, and research in one place
- generates a morning HTML email from the top feed items

## Minimal feed schema

Canonical schema file:
- `data/schema.json`

Main item fields:
- `id`
- `type`
- `source`
- `title`
- `url`
- `author`
- `published`
- `tags`
- `summary`
- `why_it_matters`
- `score`
- `metrics`

## Commands

```bash
pnpm digest:update
pnpm digest:email
pnpm digest:run
```

## Current flow

### Web feed
- source file: `data/ai-feed.json`
- UI reads directly from that file

### Daily updater
- script: `scripts/update-feed.mjs`
- current version is intentionally lean
- it normalizes and refreshes the local feed file
- next step is plugging in real GitHub and YouTube ingestion

### Morning email
- script: `scripts/render-email.mjs`
- output: `out/morning-email.html`
- send that HTML through your preferred mail pipeline

## Intended next step

1. ingest real GitHub breakout/trending repos
2. merge in selected YouTube AI/dev items
3. score and trim to the top daily items
4. render and send the morning email automatically

## Why this shape

It keeps things simple:
- one repo
- one feed
- one email output
- easy for Jarvis and Utkarsh to discuss specific items later
