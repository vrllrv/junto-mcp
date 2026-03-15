# Publishing & Distribution Guide

> How to get junto-mcp visible, timestamped, and discoverable.
> Each channel below serves a different purpose — reach, SEO, credibility, or prior art.

---

## Overview

| Channel | Purpose | Priority | Status |
|---|---|---|---|
| [npm registry](#1-npm-publish) | Package distribution + name reservation | High | **Done** (v0.1.1) |
| [MCP directories](#2-mcp-directories) | Developer discoverability | High | **mcp.so done**, others pending |
| [Official MCP Registry](#3-official-mcp-server-list) | Official credibility + traffic | High | **Done** (`io.github.vrllrv/junto-mcp`) |
| [GitHub Topics](#4-github-topics--social-preview) | Search + indexing | Quick win | Pending |
| [Archive.org](#5-archiveorg-snapshot) | Immutable timestamping / prior art | High | Queued |
| [npm README sync](#6-npm-readme) | npm page matches GitHub | Medium | Pending |
| [Hacker News](#7-hacker-news) | Developer reach + feedback | Medium | Pending |
| [Dev.to / Hashnode](#8-devto--hashnode) | SEO + long-form reach | Medium | Pending |
| [X / Twitter](#9-x--twitter) | Social proof + MCP community | Medium | Pending |
| [LinkedIn](#10-linkedin) | Professional credibility | Low | Pending |

---

## 1. npm Publish

**Why first:** Claims the package name. Anyone searching `npm install junto-mcp` finds you. Once claimed, no one can squat the name.

### Prerequisites

- [ ] `package.json` author field is filled in (currently blank)
- [ ] `package.json` repository URL is the real GitHub URL
- [ ] `npm account` created at npmjs.com

### Steps

```bash
# 1. Fill in package.json first
# Change:
#   "author": "",
#   "repository": { "url": "https://github.com/user/junto-mcp" }
# To:
#   "author": "vrllrv",
#   "repository": { "url": "https://github.com/vrllrv/junto-mcp" }

# 2. Build the project
npm run build

# 3. Check what will be published (dry run)
npm publish --dry-run

# 4. Login to npm
npm login

# 5. Publish
npm publish --access public
```

### What gets published

The `dist/` folder is the output. Verify `package.json` has the correct `main` and `bin` fields:

```json
{
  "main": "dist/index.js",
  "bin": {
    "junto-mcp": "dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

Add a `files` field to avoid publishing source files, tests, and docs.

### After publish

The package will be live at:
- `https://www.npmjs.com/package/junto-mcp`
- Installable via `npm install -g junto-mcp` or `npx junto-mcp`

### Version bump cadence

- Patch (`0.1.1`) — bug fixes, new env vars
- Minor (`0.2.0`) — new provider, new tool
- Major (`1.0.0`) — breaking interface changes

---

## 2. MCP Directories

These are the MCP-specific discovery sites where developers search for MCP servers. Submit to all of them for maximum SEO coverage.

### 2.1 mcp.so

URL: `https://mcp.so`

- Click "Submit" or "Add Server"
- Fill in: name (`junto-mcp`), GitHub URL, description, categories
- Category: `payments`, `finance`

### 2.2 Glama.ai

URL: `https://glama.ai/mcp/servers`

- Click "Submit MCP Server"
- GitHub URL: `https://github.com/vrllrv/junto-mcp`
- Glama auto-crawls and generates its own listing page
- Your server will get a URL like: `https://glama.ai/mcp/servers/@vrllrv/junto-mcp`

### 2.3 PulseMCP

URL: `https://pulsemcp.com`

- Submit via their web form
- Tracks server stats over time (stars, npm downloads)

### 2.4 Smithery.ai

URL: `https://smithery.ai`

- Submit new server
- Smithery also supports one-click installs — fills in Claude Desktop config automatically
- Add a `smithery.yaml` config file to your repo for best results:

```yaml
# smithery.yaml (add to project root)
name: junto-mcp
description: The payment protocol for people and agents. Multi-provider payments with built-in guardrails.
icon: https://raw.githubusercontent.com/vrllrv/junto-mcp/main/logo.png
categories:
  - payments
  - finance
  - agentic
configSchema:
  type: object
  properties:
    WOOVI_APP_ID:
      type: string
      title: Woovi App ID
      description: "Woovi/OpenPix API key for Pix payments (Brazil)"
    STRIPE_SECRET_KEY:
      type: string
      title: Stripe Secret Key
      description: "Stripe secret key for card, ACH, SEPA payments"
    JUNTO_DAILY_LIMIT:
      type: string
      title: Daily Spend Limit (cents)
      default: "50000"
```

### 2.5 LobeHub MCP Marketplace

URL: `https://lobehub.com/mcp`

- Submit via GitHub PR to their registry repository
- Or use their web submission form

### 2.6 Cursor MCP Directory

URL: `https://docs.cursor.com/context/model-context-protocol`

- Cursor doesn't have a formal directory yet, but listing in the above directories gets you indexed here indirectly

---

## 3. Official MCP Server List

**This is the highest-credibility channel.** Getting listed in the official Anthropic-maintained MCP servers repository puts you next to Stripe's own server, PayPal's own server, etc.

Repository: `https://github.com/modelcontextprotocol/servers`

### Steps

1. **Fork the repo** at `https://github.com/modelcontextprotocol/servers`

2. **Find the community servers list** — typically in `README.md` or a dedicated `servers/` index

3. **Add junto-mcp** to the payments/finance section:

```markdown
- [junto-mcp](https://github.com/vrllrv/junto-mcp) — Universal payment MCP server.
  Multi-provider routing (Woovi/Pix, Stripe, Belvo), spending guardrails,
  human-in-the-loop confirmation, and audit logging.
```

4. **Open a PR** with the title:
   ```
   Add junto-mcp: universal payment MCP server with multi-provider routing
   ```

5. **PR description** should include:
   - What junto-mcp does
   - Why it's different from Stripe MCP (multi-provider, guardrails, open source)
   - npm link, GitHub link
   - Screenshot or demo output

---

## 4. GitHub Topics & Social Preview

Quick wins that improve discoverability without leaving GitHub.

### Add topics to the repo

Go to `https://github.com/vrllrv/junto-mcp` → gear icon next to "About"

Add topics:
```
mcp model-context-protocol payments pix stripe anthropic claude ai-agents
agentic-payments open-finance brazil fintech typescript
```

### Add a social preview image

Settings → General → Social preview → Upload image

A 1280×640px image showing the project name and a one-liner. This is what shows up when the URL is shared on X, LinkedIn, Slack, etc.

### Pin the repo

On your GitHub profile, pin `junto-mcp` as one of your 6 featured repositories.

---

## 5. Archive.org Snapshot

**This is the timestamping move.** Archive.org creates an immutable, dated snapshot of your GitHub page that can be used to establish prior art if needed.

### How to do it

1. Go to: `https://web.archive.org/save`
2. Enter: `https://github.com/vrllrv/junto-mcp`
3. Click "Save Page"
4. Also snapshot the npm page once published: `https://www.npmjs.com/package/junto-mcp`
5. Also snapshot the README directly: `https://raw.githubusercontent.com/vrllrv/junto-mcp/main/README.md`

The Wayback Machine will return a permanent URL like:
```
https://web.archive.org/web/20260218XXXXXX/https://github.com/vrllrv/junto-mcp
```

Save these URLs in a note for future reference.

### Why this matters

Git commits are timestamped but can be rebased. npm publish timestamps are definitive. Archive.org adds a third, independent timestamp with no trust dependency.

---

## 6. npm README

npm uses the `README.md` from your repo root. Since README.md is already well-written, no extra work is needed. However, npm renders slightly differently than GitHub — check the npm page after publishing and adjust if needed.

npm-specific tips:
- The top of README.md becomes the npm package description
- Badges render correctly on npm (add a npm version badge and a test badge)
- Add shields.io badges to README.md:

```markdown
[![npm version](https://badge.fury.io/js/junto-mcp.svg)](https://www.npmjs.com/package/junto-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

---

## 7. Hacker News

**Target:** HN "Show HN" — the highest signal-to-noise developer audience.

### Post format

Title: `Show HN: junto-mcp – Universal payment MCP server with guardrails`

Comment (first comment by you, expands the submission):

```
I built junto-mcp because AI agents are starting to move real money,
but every payment provider has a different API.

junto-mcp is one MCP server that routes to Woovi (Pix/Brazil), Stripe (global),
or Belvo (Open Finance), with:
- Spending limits (daily cap, per-tx cap)
- Human-in-the-loop confirmation for high-value transactions
- Full audit log (JSONL)

GitHub: https://github.com/vrllrv/junto-mcp
npm: https://www.npmjs.com/package/junto-mcp

Happy to answer questions about the architecture or the guardrails model.
```

### Timing

Post on **Tuesday–Thursday between 8–10am US Eastern**. That's peak HN traffic.

URL: `https://news.ycombinator.com/submit`

---

## 8. Dev.to / Hashnode

Write one technical post that lives permanently and ranks in Google.

**Suggested title:** "How I built a universal payment MCP server for AI agents"

**Outline:**
1. Problem: AI agents need to move money but every API is different
2. Solution: junto-mcp — one MCP server, any payment rail
3. How it works: provider adapter pattern + routing
4. Guardrails: why this matters when AI handles real money
5. Code walkthrough: implementing the PaymentProvider interface
6. What's next: Stripe, Belvo, Wise

**Cross-post** the same article to both platforms. Dev.to has better SEO; Hashnode gives you a custom domain.

---

## 9. X / Twitter

Three posts, spaced a few days apart.

### Post 1 — Announcement

```
I built junto-mcp: a universal payment MCP server for AI agents.

One MCP server. Any payment rail (Pix, Stripe, Belvo, Wise).
Built-in guardrails so agents can't drain your account.

→ github.com/vrllrv/junto-mcp

#MCP #ModelContextProtocol #AI #fintech
```

### Post 2 — Architecture

```
The thing about AI agents + payments:

Every provider has a different API. Woovi for Pix.
Stripe for cards. Belvo for Open Finance. Wise for bank transfers.

junto-mcp abstracts all of them behind one interface + adds:
- Daily spend caps
- Per-tx max
- Human confirmation above a threshold
- Full audit trail

Thread 🧵
```

### Post 3 — Community hook

```
junto-mcp needs your help:

Looking for contributors to implement:
→ Stripe adapter
→ Belvo adapter (Open Finance, all Brazilian banks)
→ Wise adapter

Each provider is a single file implementing a 6-method interface.
Great first PR.

→ github.com/vrllrv/junto-mcp/issues
```

**Tag relevant accounts:** `@AnthropicAI`, `@mcp_protocol`, fintech / dev builders you know.

---

## 10. LinkedIn

One post, professional tone.

```
I open-sourced junto-mcp — a payment protocol for AI agents.

The problem: AI assistants are starting to handle real financial transactions.
But there's no safe, universal way to give an AI payment access.

junto-mcp solves this with:
• One MCP server, any payment provider (Pix, Stripe, Belvo, Wise)
• Spending guardrails — daily limits, per-transaction caps
• Human-in-the-loop confirmation for large amounts
• Audit trail for every action

Available now on GitHub and npm.

#AI #fintech #OpenSource #payments #Pix #Stripe
```

---

## Sequence / Order

Do these in this order for maximum effect:

```
1. Fix package.json (author + repo URL)       ← 5 minutes
2. npm publish                                 ← 10 minutes
3. Archive.org snapshots (GitHub + npm)        ← 5 minutes
4. GitHub topics + social preview              ← 10 minutes
5. MCP directory submissions (all 5)           ← 30 minutes
6. modelcontextprotocol/servers PR             ← 30 minutes
7. X post #1                                   ← immediate
8. HN Show HN post                             ← best timing: Tue-Thu morning ET
9. Dev.to / Hashnode article                   ← write when you have momentum
10. X posts #2 and #3                          ← space out over 1-2 weeks
11. LinkedIn                                   ← whenever
```

---

## Package.json Fixes Before npm Publish

Two fields need to be updated before publishing:

```json
{
  "author": "vrllrv",
  "repository": {
    "type": "git",
    "url": "https://github.com/vrllrv/junto-mcp"
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

Also add a `LICENSE` file if it doesn't already exist (the README says MIT).
