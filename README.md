# FINN

A mobile-first investment agent for Indian equities. It reads every exchange filing across a portfolio and shows the few that matter (push), and it researches any NSE company from its own annual reports and call transcripts (pull).

## Run it

Needs Node 20.12 or newer.

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start
```

Open http://localhost:3001 (on a phone: the same port on your computer's network address). The backend serves the built client, so there is one process to run and one service to deploy.

For frontend work, run `npm run dev` in `frontend/` alongside the backend; Vite proxies `/api` to port 3001.

### Install it as an app

FINN is a PWA (`frontend/public/manifest.webmanifest` and `frontend/public/sw.js`). Installing needs HTTPS or `localhost`, so a phone on your Wi-Fi cannot install from a `http://192.168…` address; deploy it first, or open it through an HTTPS tunnel.

- Android, or Chrome/Edge on desktop: Rules → **Install the app**, or the browser's Install app menu item.
- iPhone (Safari): Share → **Add to Home Screen**.

The service worker caches the app shell and the last good API answers, so the brief still opens offline.

### Optional settings

Copy `backend/.env.example` to `backend/.env`. FINN runs with none of them set.

| Setting | What it turns on |
|---|---|
| `ACCESS_CODE` | **Set this on every public deployment.** The app opens to a lock screen, and every API call needs the code, which is entered once per device. Unset means open, which is fine on localhost. |
| `GEMINI_API_KEY` or `GROQ_API_KEY` | The written analysis: promise vs delivered, bull vs bear, management bios from the filing, "Read it for me", Ask. Any OpenAI-compatible endpoint also works through `LLM_BASE_URL`. |
| `GLM_API_KEY` + `GLM_BASE_URL` (+ `GLM_MODEL`, default `hyde/glm-5.3-flash`) | The same, through an OpenAI-compatible inference gateway. One model serves both tiers. |
| `MONGODB_URI` | MongoDB for the cache and the filings history. Without it the same data goes to JSON files in `backend/data/`. |
| `DATA_DIR` | Where those JSON files live, for a host with a persistent disk. |
| `LLM_DAILY_TOKENS`, `MODEL_RATE_LIMIT`, `ANALYSIS_PER_HOUR` | Spend limits for the model (see Security). |
| `CORS_ORIGIN`, `TRUST_PROXY` | A client on another origin; the real client IP behind a reverse proxy. |

## What is in it

**Brief (push).** One sentence at the top says how many filings arrived and how many matter. The window is 24 hours by default and can be 3, 7 or 30 days or any two dates. Filings fall into three tiers: *Matters* (cards), *Glance* (one line each), *Routine* (collapsed and counted). The same event filed on both exchanges, with its advert and deck, is one row. A results filing opens with Revenue, EBITDA, PBT and PAT against the previous quarter and the same quarter last year. A management change shows who, which post, and a LinkedIn lookup; with a model key it adds the background from the profile inside the filing. Every item can be cleared, so the brief empties as it is read.

**Moves.** Holdings whose last close broke the investor's own thresholds (price move, volume against the 20-day average), each tied to any filing in the window that might explain it.

**Research (pull).** Works on any ticker Screener lists. Verdicts computed from the reported numbers, then promise vs delivered from the last four calls, eight quarters, multi-year trajectory, balance sheet, cash quality, bull vs bear, a question box that answers with quotes, and the source documents.

**Rules.** Thresholds, per-category overrides (always alert, mute), the portfolio, browser notifications, and a panel showing data sources, models and tokens spent.

## How it is built

```
frontend/   React + Vite, plain CSS, hand-drawn SVG charts, no UI library
backend/    Express
  src/sources/   prices.js (Yahoo, Screener fallback) · screener.js · nse.js (RSS poller)
  src/classify.js   ordered rules: category and tier for every filing, no model
  src/push.js       digest, grouping, movers, enrichment
  src/research.js   facts (no model), analysis job, ask
  src/docs.js       PDF text, cached for good; keyword passage selection
  src/llm.js        two model tiers, prompt-hash cache, token ledger
  src/store.js      MongoDB or JSON files behind one interface
```

Decisions worth knowing:

- **Rules before models.** Classification, priority, the results first cut and every chart and verdict are computed. A model is called only when a person opens a material item or a company.
- **Two tiers.** A fast model reads each document once (about 6k tokens per transcript after passage selection). A stronger model makes one pass over those extractions and the reported numbers. A first read of a company costs roughly 30k tokens; a second costs none, because a filed PDF never changes and every answer is cached on its prompt hash.
- **Primary sources only on the pull side.** Prompts carry the transcript and annual-report excerpts and the reported numbers, and instruct the model to use nothing else. Each promise carries its quote and call.
- **Filings.** NSE's public RSS feed is polled every five minutes and stored, because the feed only holds about a day. Each company's latest BSE announcements (through Screener) fill in what the poller was not running for.

## Security

Audited against a 25-point web app security checklist on 15 Nov 2026. FINN has no accounts, payments, uploads or SQL database, so those groups do not apply; every item is listed so the gaps are visible.

| # | Check | Status | How FINN meets it |
|---|---|---|---|
| 1 | No hardcoded secrets | Pass | Keys are read from `backend/.env` only. Repo and full git history searched for `sk-`, `API_KEY`, `SECRET`, `PASSWORD`; the live key appears in no commit. |
| 2 | No secrets in client code | Pass | The only client variable is `VITE_API_URL`, a public URL. Every model call is made by the backend. |
| 3 | Env set in every environment | Pass | Nothing is required: without a key FINN runs on rules, and `/api/meta` reports a half-set key (`GLM_API_KEY` without `GLM_BASE_URL`) instead of failing silently. |
| 4 | `.env` ignored | Pass | `.env` and `.env.*` are ignored, `.env.example` is the only tracked env file. |
| 5–10 | Password hashing, sessions, JWT, reset tokens, email verification, OAuth state | N/A | No accounts or login. The portfolio and rules live in the browser's local storage. |
| 11 | Every API route checks the caller | Pass (shared code) | With `ACCESS_CODE` set, every `/api` route except the access check and unlock returns 401 without the code in `X-Finn-Code`. Codes are compared in constant time on SHA-256 digests. There are no user accounts yet, so this is one shared code rather than per-user sessions. |
| 12 | Own data only (IDOR) | Pass | There are no per-user records on the server: a portfolio and its rules live in the browser. Every id-taking route serves public data (`/api/research/:ticker`, analysis, Ask, digest by ticker). Shared caches are keyed by the document URL or a hash of the full prompt, so one caller cannot plant an answer another receives. `/api/enrich` takes only a filing id and a ticker. It loads the filing from the server's own store and checks that it belongs to that company. An unknown id and another company's filing both return the same 404, so ids cannot be probed. Before this fix it trusted a filing object sent by the client. |
| 13–14 | Admin routes, tenant boundaries | N/A | No admin routes, single tenant. |
| 15 | Parameterized queries | Pass | No SQL. MongoDB queries use typed values, and every ticker is checked against `^[A-Z0-9&-]{1,20}$` before it reaches a query or an upstream URL. |
| 16 | File uploads restricted | N/A | No uploads. JSON bodies are capped at 50 kB. |
| 17 | User input sanitized before HTML | Pass | No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere; React escapes all text, model output included. Links from scraped pages pass `safeUrl` (http/https only). |
| 18 | Login rate limit | Pass | Wrong access codes are counted per IP. After 10 in 15 minutes that IP gets 429 with `Retry-After`, even for the right code, so the code cannot be guessed by brute force. Only failures count, so normal use is never blocked. |
| 19 | Reset rate limit | N/A | No password reset. Change `ACCESS_CODE` and restart to revoke every device. All of `/api` is also limited to 300 requests per minute per IP. |
| 20 | AI endpoints have spend limits | Pass | Three layers: Ask and "Read it for me" 30 per IP per 10 min; new company analyses 12 per IP per hour (polling a running job is free); a server-wide cap of 2M fresh tokens per day. Cached answers never count. |
| 21–23 | Webhook signatures, idempotent orders, server-side subscription checks | N/A | No payments. |
| 24 | Row-Level Security | N/A | No Supabase. MongoDB, when used, is reached only by the backend with credentials from the environment. |
| 25 | Errors do not leak internals | Pass | Errors are logged on the server with the stack; the client receives a generic line or a known safe message, never a stack trace, upstream URL or file path. |

Hardening beyond the list:

- **SSRF.** `/api/enrich` only fetches `https://` URLs on `nseindia.com` or `bseindia.com`. Other documents come from links on Screener's company pages.
- **Headers.** Content-Security-Policy (self plus Google Fonts), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a Permissions-Policy, and no `X-Powered-By`.
- **CORS.** Off by default, since the backend serves its own client. A separately hosted client must be listed in `CORS_ORIGIN`, so other sites cannot spend the model budget from a visitor's browser.
- **Input bounds.** Questions are capped at 300 characters, search at 40, and a digest window at about 3 months.
- **Dependencies.** `npm audit --omit=dev` reports 0 vulnerabilities in both packages. unpdf was moved to 2.x, which drops the `canvas` and `tar` chain that carried a critical advisory.

Verified against the running server: `/api/enrich` returns 200 for a filing's own company, 404 for the same id under another company and for a made-up id, and 400 for an object in place of the id (operator injection) and for the old client-built filing object; without the code, `/api/meta` and Ask return 401 while the page itself still loads; a wrong code returns 401 and the right one 200; after 10 wrong codes, even the right one returns 429; unsafe tickers (`../../etc`, `<script>`) return 400, an enrich URL pointing at `169.254.169.254` returns 400, a request from another origin gets no CORS header, and the 31st Ask request within 10 minutes returns 429 with `Retry-After`.

Open items:

- Rate limits live in memory, which suits one instance. Running several needs a shared store such as Redis.
- The access code is shared, not per user. Anyone you give it to has full access until you change `ACCESS_CODE` and restart, which signs out every device. Sign-in with per-user sessions is planned; it replaces `codeOk` in `server.js`, and the lock screen becomes the login page.
- The code is stored in the browser's local storage on each device. Rules → **Lock FINN on this device** removes it.

## Known limits

- The filings history is as deep as the poller has been running, plus the last five BSE announcements per company. A 30-day window on a fresh install is thin.
- The results first cut uses Screener's standardised quarterly table, not text parsed from the results PDF. It can trail a fresh filing by some hours; the card says so when it does.
- "Financing profit" stands in for EBITDA at banks and lenders, where EBITDA has no meaning.
- Alerts are evaluated when the app is open (and through browser notifications while a tab is alive). There is no server push to a closed phone.
- Names from the NSE feed are matched to companies by normalised name and filename symbol; an unusual legal name can be missed.
- The model path was tested live against `hyde/glm-5.3-flash`. On DIXON, Ask answered in under 3 seconds with page-cited quotes. The first full read used about 31k fast-tier tokens; once cached, a repeat run took 12 seconds. Gemini and Groq go through the same OpenAI-compatible code but have not been run live.
