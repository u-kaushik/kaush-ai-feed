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
pnpm digest:send
pnpm digest:test-send
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
- send via SMTP with `scripts/send-email.mjs`
- configure local env in `.env` from `.env.example`

### Saved items and notes
- `data/saved-items.json` is the local placeholder for starred or saved items
- `data/digest-notes.json` is the local placeholder for discussion notes and watched-item notes
- Friday recap can pull from those files without touching business ops data

## Intended next step

1. ingest real GitHub breakout/trending repos
2. merge in selected YouTube AI/dev items
3. score and trim to the top daily items
4. keep the daily feed local-first
5. store only explicitly saved items separately
6. render a Friday recap from saved items and notes
7. send the morning email automatically

## Why this shape

It keeps things simple:
- one repo
- one feed
- one email output
- easy for Jarvis and Utkarsh to discuss specific items later
