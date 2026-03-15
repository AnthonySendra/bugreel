# bugreel

> A self-hosted alternative to [jam.dev](https://jam.dev).

Record bugs without screen recording — capture DOM, console, and network as a structured, replayable file you can host yourself.

No SaaS, no tracking, no vendor lock-in. Runs on your own infrastructure.

---

## Features

### Recording

| | Firefox extension | SDK (script tag) |
|---|---|---|
| DOM replay (rrweb) | ✅ | ✅ |
| Console logs | ✅ | ✅ |
| Uncaught errors & promise rejections | ✅ | ✅ |
| Network requests (URL, method, headers, status, duration) | ✅ webRequest API | ✅ fetch/XHR intercept |
| Network response bodies | ❌ browser restriction | ✅ JSON up to 5 KB |
| Request body | ✅ | ✅ |
| Click / input / navigation tracking | ✅ | ✅ |
| Font inlining (base64) for faithful replay | ✅ | ❌ |
| Multi-page recording (full-page navigations) | ✅ | ❌ single page |
| Works without install | ❌ | ✅ |
| Auto-upload to workspace | ✅ | ✅ |
| Local download fallback | ✅ | ✅ |

Recordings are saved as `.reel` files — gzipped JSON containing all streams.

### Viewer

- **DOM replay** — pixel-perfect interactive replay powered by rrweb, not a video
- **Scrubber** — seek anywhere in the timeline; all panels sync to the current position
- **Console panel** — logs, warnings, errors and uncaught exceptions with timestamps; scrolls with playback
- **Network panel** — all requests in a table; click any row to expand headers, request body, and status
- **Interactions panel** — ordered list of clicks, inputs, and navigations with seek-to buttons
- **Comments** — timestamped threaded comments; yellow bubbles on the timeline; reply notifications by email
- **Playwright export** — one click generates a ready-to-run `.spec.ts` reproduction script from the interaction events

### Storage

- **Database** — SQLite with WAL mode (`data/bugreel.db`)
- **Reel files** — local disk by default (`data/reels/`), or any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO)
- **S3 uploads** — extension and SDK upload directly to S3 via presigned PUT URLs; viewer redirects to presigned GET URLs — the API server is never in the data path

---

## Project structure

```
bugreel/
├── app/          # Nuxt 4 web app (viewer + API)
│   └── public/
│       ├── sdk/recorder.js          # SDK served to end users
│       └── recorder-lib/            # rrweb + fflate served by the app
├── recorder/     # extension + SDK source
│   ├── manifest.json
│   ├── content.js / background.js / popup.*
│   ├── lib/      # rrweb.min.js, fflate.min.js
│   └── sdk/
│       └── recorder.js              # SDK source
```

---

## Setup

### Web app

```bash
cd app
npm install
npm run dev       # http://localhost:7777
```

### Extensions

```bash
cd recorder
npm install
npm run build
# Load recorder/dist as a temporary extension in about:debugging
```

Configure the extension by clicking ⚙ in the popup:
- **API URL** — base URL of your bugreel server
- **App ID** — UUID of the app (visible in workspace settings)
- **API Token** — token generated in workspace settings

### SDK (no extension required)

Add one script tag to your site:

```html
<script
  src="https://your-bugreel.com/sdk/recorder.js"
  data-host="https://your-bugreel.com"
  data-app-id="your-app-id"
  data-token="your-api-token"
></script>
```

This injects a floating **⏺ Record Bug** button. On stop the recording is compressed and uploaded automatically.

**Programmatic control** (no widget):

```js
BugreelRecorder.init({ host, appId, token, widget: false })
BugreelRecorder.start()
await BugreelRecorder.stop()
```

> When updating `recorder/sdk/recorder.js`, copy it to `app/public/sdk/recorder.js` and run `cp recorder/lib/*.min.js app/public/recorder-lib/` to keep served files in sync.

---

## S3 storage (optional)

Set these in `app/.env`:

```env
NUXT_S3_REGION=us-east-1
NUXT_S3_BUCKET=bugreel
NUXT_S3_ACCESS_KEY_ID=your-access-key
NUXT_S3_SECRET_ACCESS_KEY=your-secret-key

# Non-AWS only (Cloudflare R2, MinIO, …)
NUXT_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

All five must be set for S3 to activate. Missing any falls back to local disk silently.

**Bucket CORS** — allow `PUT` from extension/SDK origins:

```json
[{ "AllowedHeaders": ["*"], "AllowedMethods": ["PUT"], "AllowedOrigins": ["*"], "MaxAgeSeconds": 3600 }]
```

---

## Email (optional)

When configured, bugreel sends verification, password reset, workspace invitation, and comment reply emails.

```env
NUXT_EMAIL_PROVIDER=smtp        # smtp | resend | console
NUXT_EMAIL_FROM=noreply@yourcompany.com
NUXT_PUBLIC_BASE_URL=https://bugreel.yourcompany.com

# SMTP
NUXT_EMAIL_SMTP_HOST=smtp.yourprovider.com
NUXT_EMAIL_SMTP_PORT=587
NUXT_EMAIL_SMTP_USER=your-user
NUXT_EMAIL_SMTP_PASS=your-password

# Resend
NUXT_EMAIL_RESEND_API_KEY=re_xxxxxxxxxxxxx
```

Leave `NUXT_EMAIL_PROVIDER` unset to disable all email sending.

---

## TODO

- [x] DOM replay viewer with synchronized console, network, and interaction panels
- [x] Timestamped threaded comments with timeline bubbles
- [x] Email verification, password reset, workspace invitations, comment reply notifications
- [x] Direct S3 upload via presigned URLs (extension + SDK bypass the API server)
- [x] Multi-page DOM recording — full-page navigations continue the recording seamlessly
- [x] SDK — embed a record button on any site without the extension
- [x] Playwright export — generate a `.spec.ts` reproduction script from the interaction events
- [ ] Support `target="_blank"` — new-tab navigations are not recorded (would need screen recording or multi-tab tracking)
