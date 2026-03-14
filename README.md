# bugreel

> A vibe-coded, self-hosted alternative to [jam.dev](https://jam.dev).

Record bugs without screen recording — capture DOM, console, and network as a structured, replayable file you can host yourself.

---

## What is this?

When a user hits a bug, they click **Record**, reproduce the issue, click **Stop**. They get a `.reel` file containing:

- A **pixel-perfect DOM replay** — not a video, an interactive replay of the actual HTML
- **Console logs** with timestamps
- **Network requests** (XHR/Fetch) with status, headers, duration

That file can be shared or uploaded to the bugreel viewer to be replayed in a web player.

This project is intentionally kept simple and self-hosted. No SaaS, no tracking, no vendor lock-in.

It is designed as an **internal tool** — meant to run on your company's private network, not exposed to the internet. Install the extension, record bugs, and share reels with your team without any data leaving your infrastructure.

---

## Why?

Tools like [jam.dev](https://jam.dev) are great for capturing bugs, but they're SaaS — your DOM snapshots, console logs, and network requests all end up on someone else's servers. For companies that handle sensitive data or simply don't want to send internal app state to a third party, that's a dealbreaker.

I looked for a self-hostable equivalent and couldn't find one. So Claude built this.

---

## Storage

Uses **SQLite** (`node:sqlite` with WAL mode) and the local filesystem. No external database required.

- **Database**: `data/bugreel.db` — stores metadata for users, workspaces, apps, reels, API tokens, and workspace members
- **Reel files**: `data/reels/{id}.reel` — gzipped JSON files stored on disk

This keeps the setup zero-dependency beyond Node.js and makes backups trivial (just copy the `data/` folder).

---

## Capture

The browser extension captures three streams in parallel during a recording session:

### DOM replay (rrweb)

Uses [rrweb](https://github.com/rrweb-io/rrweb) to record DOM snapshots and mutations, mouse movements, scrolls, focus changes, and input events. Key settings:
- `maskInputOptions: { password: true }` — passwords are masked
- `slimDOMOptions` — strips scripts, comments, and unnecessary meta tags
- `checkoutEveryNth: 200` — periodic full snapshots for seeking
- A synthetic end-marker event (`type: 5`, tag `bugreel-end`) is appended so duration is known even on static pages

External `@font-face` URLs are fetched and inlined as base64 during recording so fonts render correctly on replay. An optional full HTML snapshot (with external stylesheets inlined) can also be captured.

### Console capture

Content scripts run in an isolated JS context and cannot override the page's `console.*` methods directly. The solution: inject an inline `<script>` into the DOM at `document_start` that:
1. Overrides `console.log/info/warn/error/debug/table/trace` in the page context
2. Catches uncaught errors and unhandled promise rejections
3. Dispatches a `CustomEvent` on `window`
4. The content script listens to that event and stores timestamped entries

### Network capture

Via `browser.webRequest` in the background script:
- `onBeforeRequest` — captures URL, method, request body
- `onBeforeSendHeaders` — captures request headers
- `onCompleted` / `onErrorOccurred` — captures status code, response headers, duration

**Limitation**: `webRequest` cannot capture **response bodies** (browser security restriction). Only metadata is captured (status, headers, duration). Capturing bodies would require a different approach (page-side Service Worker interceptor or a local proxy).

### Output format

All three streams are merged into a single `.reel` file — gzipped JSON (via [fflate](https://github.com/101arrowz/fflate), level 6):

```json
{
  "version": "1.0",
  "meta": {
    "url": "...",
    "title": "...",
    "recordedAt": "ISO8601",
    "duration": 12345,
    "userAgent": "..."
  },
  "rrwebEvents": [],
  "consoleEvents": [{ "time": 0, "level": "log", "args": [] }],
  "networkEvents": [{ "time": 0, "url": "...", "method": "GET", "status": 200 }],
  "htmlSnapshot": "<!DOCTYPE html>..." 
}
```

The file can be uploaded to the server or downloaded locally.

---

## Setup

### Extension

```bash
cd extension
npm install
npm run build
```

### Web app

```bash
cd server
npm install
npm run dev       # starts at http://localhost:5555
```
---

## TODO

- [ ] Add direct S3 upload  
- [ ] Add messages with timestamp to the viewer  
- [ ] Add email validation  
- [ ] Add email invitation  
- [ ] Add sdk to inject record widget direct on the website  
- [ ] In viewer add tab to list all interactions (click, navigation, type)  
