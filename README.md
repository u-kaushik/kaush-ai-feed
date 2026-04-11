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
- fetches GitHub and YouTube candidates and writes the merged result to `data/ai-feed.json`
- YouTube creator sources live in `data/youtube-sources.json` and are used first; `data/yt-feed.json` remains the fallback snapshot
- GitHub search criteria live in `data/github-criteria.json`; the updater falls back to a default “recently pushed AI repos” query if that file is missing
- GitHub ingestion skips repos whose metadata appears to be Chinese-language, so they do not enter the feed
- YouTube is fetched in this order: creator RSS, then YouTube Data API search (if `YOUTUBE_API_KEY`/`GOOGLE_API_KEY` is set), then the local snapshot

### Automation
- run updates manually: `pnpm digest:update`
- wire into your scheduler with `scripts/scheduled-refresh.mjs` (full run: `node scripts/scheduled-refresh.mjs`, PM refresh: `node scripts/scheduled-refresh.mjs pm`)
- the file `netlify.toml` only serves static files and does not add a cron by itself

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
1. keep the feed ingestion reliable in one-shot + scheduled runs
2. keep the feed local-first in `data/ai-feed.json`
3. refine scoring/filters for your preferred signals
4. send the morning email automatically

## Why this shape

It keeps things simple:
- one repo
- one feed
- one email output
- easy for Jarvis and Utkarsh to discuss specific items later
