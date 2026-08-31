# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A three-part system for HOT Business CRM:

1. **Web CRM** (`index.html`, `crm.html`, `track.html`, etc.) — PWA for managing deals, clients, and tasks. Uses Firebase Realtime Database + localStorage with cloud sync.
2. **Web Scraping Agent** (`agent/`) — Generic framework for monitoring websites and APIs. Powered by rules extracted from real-world scanning failures. No site-specific code; each watch is a JSON file.
3. **Tender Radar** (`tenders/`) — Specific use of the agent to monitor 65+ Israeli government tender sources across five domains (telecom, IT, cybersecurity, AI, equipment).

The agent and radar share a single codebase (`agent/core/`) — one implementation, not two.

## Key Commands

```bash
# Run all tests (agent + tender radar)
npm test

# Run agent tests only (115 tests against shared core)
npm run test:agent

# Run the web scraping agent directly
node agent/run.js --list                      # List defined watches
node agent/run.js --watch=<id> --probe        # Test connectivity (no save)
node agent/run.js --watch=<id> --audit        # Trace where items failed (no save)
node agent/run.js --watch=<id> --dry-run      # Full scan, print only
node agent/run.js --watch=<id>                # Full scan + save
node agent/run.js --watch=<id> --source=<id>  # Scan single source
```

For CI/local development without network access, use **Actions → `agent`** to run from GitHub.

## Architecture

### Web Scraping Agent (`agent/`)

The core (`agent/core/`) is a seven-stage pipeline. Each watch (JSON) defines sources and taxonomy; the code doesn't change:

```
Sources → Harvest → Gate → Classify → Extract dates → Merge with history → Report
```

**Core Modules:**
- `text.js` — HTML entity cleanup, stable hashing, text normalization
- `match.js` — Hebrew-aware term matching (prefixes ו/ה/ב/ל/מ/ש/כ, declensions); negation cancels all scores
- `dates.js` — Extract dates by semantic hint ("last submission", "published"), not position
- `urls.js` — Site identity, normalization, root detection
- `net.js` — Fetching with timeout, retry, and declared identity
- `harvest.js` — Extract links from HTML + read RSS/Atom
- `discover.js` — Auto-find list pages from home (site structure changes don't break it)
- `adapters.js` — Handlers for `html`, `discover`, `rss`, `json` source types
- `pipeline.js` — Orchestrates the seven-stage flow
- `history.js` — Merge with stored data, detect orphans, track health

**Watch Configuration** (`agent/watches/*.watch.json`):
- `sources[]` — URLs or APIs with `kind` (html/discover/rss/json)
- `taxonomy[]` — Terms grouped by topic; `phrases[]` acts as a pre-filter gate
- `negations[]` — Terms that cancel scores across all topics
- `dates.hints[]` — Regex patterns to find date boundaries in context

**Key Rules from Real Failures:**
1. Context window of a list item swallows neighboring items — classify by item window only, not surrounding context
2. First date on a row ≠ deadline — match by semantic hint ("last submission")
3. HTML form fields are false positives — filter by element type
4. Relative dates need anchor points — extract "from now" date references
5. RSS feeds sometimes timestamp the feed, not the item — check `<pubDate>` on item
6. Negation is global, not per-topic — one negated term kills scoring for all topics
7. Site structure changes break XPath selectors — harvest text + context window instead

### Tender Radar (`tenders/`)

Specific instantiation of the agent for Israeli government tenders.

- `tenders/config/` — Taxonomy (Hebrew terms by domain), negations, sources (65 tender publishers)
- `tenders/data/` — Output per source and run (JSON + timestamped snapshots)
- `tenders/test/` — 115 fixtures; all agent tests run against shared core

**Outputs:**
- GitHub Issues auto-generated daily (filtered by domain, sector, days until deadline)
- HTML dashboard (`tenders.html`) with filtering by topic, publication type, sector
- One-click export to CRM

### Web CRM

- `index.html` / `crm.html` — Main interface (responsive, RTL-ready)
- `track.html`, `cinematic.html` — Specialized views
- `sw.js` — Service Worker for offline + push notifications
- `manifest.json` — PWA metadata
- Firebase Realtime Database + local storage with cloud sync
- Anthropic SDK integration for AI features (optional review)

**Key Implementation Details:**
- Data layer syncs between Firebase and localStorage (persistent offline state)
- Notifications track linked entities (deals, clients) to detect orphans
- Archive system has per-row "return to active" and "move to archive" actions

## Testing

**Agent/Radar Tests:**
```bash
npm run test:agent   # All 115 agent tests (no network)
npm test             # Agent + tender radar tests

# Single test
node --test agent/test/core.test.js
```

Tests use fixtures; no external network calls. Each core module is tested against real-world scanning examples extracted from `tenders/test/fixtures/`.

## Important Files & Patterns

**Agent:**
- `agent/watches/example.watch.json` — Template with explanations for every field
- `agent/watches/tenders.watch.json` — Radar configuration (profile/attribution)
- `agent/data/` — Per-watch output and audit logs
- `agent/test/` — Fixtures and test suites

**Tender Radar:**
- `tenders/config/` — Tuning (terms, sources)
- `tenders/README.md` — Detailed measurement notes, tuning history
- `tenders/data/` — Scan output and history

**CI/CD:**
- `.github/workflows/tenders-radar.yml` — Daily scan + GitHub Issues
- `.github/workflows/agent.yml` — Manual agent run from Actions
- `.github/workflows/tests.yml` — Run full test suite on push
- `.github/workflows/pages.yml` — Deploy static pages (CRM, radar dashboard)

## Git Workflow

This project uses feature branches with merge commits. The designated branch for Claude-driven work is specified at session start. Always:
1. Develop on the assigned branch
2. Commit with clear messages (why, not what)
3. Push to the assigned branch
4. Do NOT create a PR unless explicitly asked

## Development Notes

**Adding a New Watch:**
1. Copy `agent/watches/example.watch.json`
2. Define sources (URLs + kind: html/discover/rss/json)
3. Define taxonomy and negations (Hebrew terms)
4. Run `node agent/run.js --watch=<id> --probe` to test connectivity
5. Run `node agent/run.js --watch=<id> --dry-run` to see classifications
6. Run `node agent/run.js --watch=<id>` to save results
7. Tests inherit the core; no site-specific code needed

**Modifying Agent Core:**
- Changes to `agent/core/` affect all watches (agent + radar)
- The 115 tests catch regressions across all core modules
- Document any new rule in `agent/README.md` (why + where found)
- Update related tests if the rule changes
