# FINN

A mobile-first investment agent for Indian equities (NSE and BSE).

FINN does two jobs:

- **Push.** It reads every exchange filing across a portfolio and surfaces the few that matter. Each results filing gets a first cut of the numbers, and each management change gets a short bio.
- **Pull.** It researches any NSE-listed company from primary sources only: annual reports, earnings-call transcripts and reported financials.

It is built to be cheap to run. Rules do the sorting, models are called only when a person opens something, and every filed document and model answer is cached.

**How it was built:** [`docs/agentic-build-log.json`](docs/agentic-build-log.json) is the build conversation with an AI coding agent, in chat-export format: 20 prompts and replies, with the agent's tool calls and verification results. It runs from the first requirements prompt through iteration, features, the security and SEO audits to deployment.

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Deployment](#deployment)
5. [Installing as an app](#installing-as-an-app)
6. [Architecture](#architecture)
7. [How it works](#how-it-works)
8. [API reference](#api-reference)
9. [Module reference](#module-reference)
10. [Security](#security)
11. [SEO](#seo)
12. [Known limitations](#known-limitations)
13. [Contributing](#contributing)

---

## Features

### Brief (push)

| Capability | Detail |
|---|---|
| Windowed digest | Filings for the last 24 hours by default. Also 3, 7 or 30 days, or any two dates. |
| Prioritisation | Every filing is classified into one of 17 categories and three tiers: **Matters** (cards), **Glance** (one line), **Routine** (collapsed and counted). |
| De-duplication | The same event filed on both exchanges, with its advert and deck, shows as a single item. |
| Results first cut | Revenue, EBITDA, PBT and PAT against the previous quarter (QoQ) and the same quarter last year (YoY), with margin change. Lenders show *Financing profit* in place of EBITDA. |
| Management changes | Who, which post and the effective date, plus background from the profile inside the filing and a LinkedIn lookup. |
| Holdings | Average move of the portfolio, up/down breadth and the biggest movers, each with a 30-day sparkline. |
| Moves | Holdings that broke the investor's own price or volume thresholds at the last close. |
| Read it for me | A three-line model summary of any filing, with figures quoted verbatim. |
| Alerts | Browser notifications for new material filings, plus per-category overrides (always alert, or mute). |

### Research (pull)

| Capability | Detail |
|---|---|
| Snapshot | Price, valuation and return ratios, and signals computed from reported numbers. |
| Trajectory | Multi-year revenue, operating profit, margin and PAT, with 3-, 5- and 10-year CAGRs. |
| Balance sheet | Borrowings, equity, debt-to-equity, ROCE, cash conversion cycle, and debtor, inventory and payable days. |
| Cash quality | Operating cash flow, free cash flow, and five-year cash conversion against PAT. |
| Promise vs delivered | Guidance from the last four earnings calls, tested against the quarters reported since. Each promise carries its verbatim quote and the call it came from. |
| Narrative vs numbers | Where management's story and the numbers agree, and where they diverge. |
| Guidance | What still stands from the latest call: metric, target and horizon. |
| Bull vs bear | Three points each, every one resting on a number or a quote. |
| Ask | Free-form questions, answered only from the company's own documents, with page-cited quotes. |
| Sources | Links to every transcript, annual report and the financials used. |

### Rules

Price and volume thresholds, notifications, portfolio editing, per-category overrides, and a panel showing data sources, the model in use and tokens spent.

---

## Quick start

**Requirements:** Node.js 20.12 or newer.

```bash
git clone https://github.com/rohit-541/FINN.git
cd FINN

# Build the client
cd frontend && npm install && npm run build

# Start the server (it also serves the built client)
cd ../backend && npm install && npm start
```

Open <http://localhost:3001>. On a phone on the same network, use your computer's network address and port 3001.

FINN runs with no configuration at all. Without a model key, everything rule-based works: the digest, results cards, prices, charts and computed signals. The written analysis needs a key ([Configuration](#configuration)).

### Development

Run the backend, and in a second terminal start the Vite dev server with hot reload:

```bash
cd backend && npm run dev        # node --watch, port 3001
cd frontend && npm run dev       # Vite, proxies /api to port 3001
```

---

## Configuration

Settings are read from `backend/.env`. Copy [`backend/.env.example`](backend/.env.example) to start. Every setting is optional.

### Access

| Variable | Default | Purpose |
|---|---|---|
| `ACCESS_CODE` | unset (open) | **Set on every public deployment.** Locks the API behind a shared code that users enter once per device. Use 12 or more random characters. |

Generate a code with:

```bash
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

### Language model

FINN talks to any OpenAI-compatible `/chat/completions` endpoint. The first configured provider wins.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini (free tier available). |
| `GROQ_API_KEY` | Groq (free tier available). |
| `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL` | An OpenAI-compatible inference gateway. `GLM_MODEL` defaults to `hyde/glm-5.3-flash`. One model serves both tiers. |
| `LLM_API_KEY`, `LLM_BASE_URL` | Any other OpenAI-compatible endpoint. |
| `LLM_FAST_MODEL`, `LLM_SMART_MODEL` | Override the model used for each tier. |
| `LLM_SMART_EFFORT` | Reasoning effort for the smart tier on reasoning models (default `low`). |
| `LLM_THINKS`, `LLM_THINK_TOKENS` | Extra token budget for reasoning models on a custom endpoint (default 6000). |

### Storage

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB` | unset, `finn` | Store the cache and the filings history in MongoDB. |
| `DATA_DIR` | `backend/data` | Without MongoDB, data is kept in JSON files here. Point it at a persistent disk in production. |

### Limits and network

| Variable | Default | Purpose |
|---|---|---|
| `LLM_DAILY_TOKENS` | `2000000` | Fresh model tokens per UTC day across all users. `0` disables the cap. |
| `MODEL_RATE_LIMIT` | `30` | Model calls (Ask, Read it for me) per client IP per 10 minutes. |
| `ANALYSIS_PER_HOUR` | `12` | New company analyses per client IP per hour. |
| `CORS_ORIGIN` | unset | Comma-separated origins allowed to call the API, needed only when the client is hosted elsewhere. |
| `TRUST_PROXY` | `0` | Set to `1` behind one reverse proxy, so rate limits see the real client IP. |
| `SITE_URL` | unset | Public origin, such as `https://finn.example.com`. Fills the canonical URL, share tags and structured data, and publishes `sitemap.xml`. |
| `PORT` | `3001` | HTTP port. |

---

## Deployment

FINN is one Node process that serves both the API and the built client, so it deploys as a single web service on any Node host (Render, Railway, Fly.io, a VPS).

| Step | Value |
|---|---|
| Build command | `cd frontend && npm install && npm run build && cd ../backend && npm install` |
| Start command | `node backend/src/server.js` |
| Required env | `ACCESS_CODE`, plus the model key for your provider |
| Recommended env | `SITE_URL`, `TRUST_PROXY=1`, and `DATA_DIR` on a persistent disk or `MONGODB_URI` |

Serve it over HTTPS. Browsers allow installing the app and showing notifications only on secure origins.

---

## Installing as an app

FINN is a Progressive Web App ([`manifest.webmanifest`](frontend/public/manifest.webmanifest), [`sw.js`](frontend/public/sw.js)).

- **Android, or Chrome and Edge on desktop:** Rules → **Install**, or the browser's *Install app* menu item.
- **iPhone (Safari):** Share → **Add to Home Screen**.

The service worker caches the app shell and the last successful API answers, so the brief still opens offline. Installing requires HTTPS or `localhost`.

---

## Architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  React 18 · hash routing · localStorage (portfolio, rules, code)      │
│  Brief · Research · Rules · Lock screen · service worker              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  /api  (X-Finn-Code header)
┌───────────────────────────────▼───────────────────────────────────────┐
│  Express                                                              │
│  security headers → rate limit → access gate → routes                 │
│                                                                       │
│  push.js      digest · grouping · market · results card · bios        │
│  research.js  facts (no model) · analysis job · ask                   │
│  classify.js  category and tier for every filing (rules, no model)    │
│  docs.js      PDF text, cached for good · keyword passage selection   │
│  llm.js       fast/smart tiers · prompt-hash cache · token budget     │
│  store.js     MongoDB or JSON files · read-through cache              │
└──────┬──────────────┬──────────────┬──────────────┬───────────────────┘
       │              │              │              │
   NSE RSS feed   Screener.in    Yahoo Finance   Model provider
   (every 5 min)  (financials,   (EOD prices)    (OpenAI-compatible)
                   documents, BSE)
```

### Repository layout

```
FINN/
├── backend/
│   ├── src/
│   │   ├── server.js        HTTP server, middleware, routes, NSE poller
│   │   ├── push.js          Digest, market moves, enrichment
│   │   ├── research.js      Company facts, analysis job, Ask
│   │   ├── classify.js      Filing classifier
│   │   ├── docs.js          PDF extraction and passage selection
│   │   ├── llm.js           Model routing, caching, token budget
│   │   ├── store.js         Storage and cache layer
│   │   └── sources/
│   │       ├── http.js      Fetch with per-host concurrency gate
│   │       ├── screener.js  Company pages, search, charts
│   │       ├── prices.js    Quotes and price summaries
│   │       └── nse.js       NSE announcements feed
│   └── .env.example
├── frontend/
│   ├── public/              Manifest, service worker, icons
│   ├── src/
│   │   ├── main.jsx         Entry, service-worker registration
│   │   ├── App.jsx          Access gate, routing, dock
│   │   ├── Brief.jsx        Home: digest, holdings, moves
│   │   ├── Research.jsx     Company research
│   │   ├── Rules.jsx        Settings
│   │   ├── Charts.jsx       SVG sparkline and series charts
│   │   ├── lib.js           API client, hooks, formatters
│   │   └── styles.css       Design system
│   └── vite.config.js
└── README.md
```

### Stack

| Layer | Choice | Why |
|---|---|---|
| Client | React 18, Vite 6, plain CSS | Small bundle (about 60 kB gzipped JavaScript), no UI library. |
| Charts | Hand-drawn SVG | No chart dependency, and full control of the scrub readout. |
| Server | Express 4 (ESM) | One process for the API and the static client. |
| Scraping | cheerio | Parses Screener's server-rendered pages. |
| PDF | unpdf 2 | Serverless pdf.js build, no native dependencies. |
| Storage | MongoDB 6 driver, or JSON files | Runs anywhere, with no database required. |

---

## How it works

### Push pipeline

1. **Collect.** The NSE announcements RSS feed is polled every five minutes and every item is stored, because the feed only holds about a day. Each company's latest BSE announcements (via Screener) fill gaps from before the poller started.
2. **Match.** Feed items are matched to holdings by ticker, NSE symbol or normalised company name.
3. **Classify.** An ordered list of regular-expression rules assigns each filing a category and a tier from its title and summary. Rule order matters: the most specific rules come first, and paperwork is checked after results. A few categories are promoted by content, such as key managerial personnel changes and rating upgrades or downgrades.
4. **Group.** Items sharing a ticker, category and IST calendar day collapse into one. The leader is the most material item, preferring a readable PDF and a specific headline. The rest ride along as related filings.
5. **Enrich on demand.**
   - Results filings get the four-line first cut from the standardised quarterly table.
   - Management changes get people extracted from the filing (model), with a regex fallback on the headline.
   - *Read it for me* sends the filing text to the fast tier.

### Pull pipeline

1. **Facts (no model).** Screener's tables are parsed into a trailing-twelve-month view, growth CAGRs, annual series, balance-sheet and cash ratios, eight quarters and computed signals. Banks and lenders get ROE in place of the margin signal.
2. **Analysis job (background).**
   - The fast tier reads up to four call transcripts and the latest annual report. It sees only keyword-selected passages, about 6k tokens per transcript.
   - The smart tier then makes a single pass over those extractions and the reported numbers, producing credibility, promises, agree/diverge, guidance and bull/bear.
   - The client polls the job until it finishes.
3. **Ask.** The question selects passages from the same documents, and the model answers with page-cited quotes. It says so when the documents do not cover the question.

### Model routing and cost

| Practice | Effect |
|---|---|
| Rules before models | Classification, priority, results cards, charts and verdicts cost nothing. |
| Two tiers | The cheap model reads documents; the stronger model judges once. |
| Passage selection | Keyword scoring sends only relevant chunks, without embeddings. |
| Permanent document cache | A filed PDF never changes, so it is extracted once. |
| Prompt-hash cache | An identical prompt is never sent twice. |
| Daily budget | A hard ceiling on fresh tokens per day. |

A first full read of a company costs about 30k fast-tier tokens. Opening it again costs nothing.

---

## API reference

All routes are under `/api` and return JSON.

- **Access code.** When `ACCESS_CODE` is set, every route except `GET /api/access` and `POST /api/unlock` requires the header `X-Finn-Code: <code>`.
- **Rate limit.** All of `/api` is limited to 300 requests per minute per IP.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/access` | Whether a code is required, and whether the sent one is valid | Public |
| `POST` | `/api/unlock` | Check an access code | Public |
| `GET` | `/api/meta` | Default portfolio, research picks, categories, model and storage status | Code |
| `GET` | `/api/digest` | Classified, grouped filings for a window | Code |
| `GET` | `/api/market` | End-of-day quotes and summaries | Code |
| `POST` | `/api/enrich` | Results card, people or a model summary for one filing | Code |
| `GET` | `/api/search` | Company search | Code |
| `GET` | `/api/research/:ticker` | Company facts computed from reported numbers | Code |
| `GET` | `/api/research/:ticker/analysis` | Start or poll the analysis job | Code |
| `POST` | `/api/research/:ticker/ask` | Answer a question from the company's documents | Code |

Two crawler files are served outside `/api`, with no access code: `GET /robots.txt` and `GET /sitemap.xml` (see [SEO](#seo)).

### Endpoint details

**`GET /api/access`**
```json
{ "required": true, "ok": false }
```

**`POST /api/unlock`**
- Body: `{ "code": "<access code>" }`
- Returns `200 { "ok": true }`, or `401` for a wrong code.
- After 10 wrong codes in 15 minutes from one IP, every request from that IP returns `429` with `Retry-After`.

**`GET /api/meta`**
- Returns `{ portfolio, picks, categories, llm, store, feed, access }`.
- `llm` holds the provider, both models, token usage, and any configuration problem.

**`GET /api/digest?tickers=TCS,INFY&from=<ms>&to=<ms>`**
- `tickers`: up to 30, each matching `^[A-Z0-9&-]{1,20}$`. Defaults to the server's portfolio.
- `from`, `to`: epoch milliseconds. Default is the last 24 hours. The window is capped at about 92 days, and `to` is capped at now.
- Returns `{ from, to, filings, items[], companies[], missing[], feed }`.
- Each item has `id, ticker, company, title, headline, summary, url, ts, category, tier, label, related[]`.

**`GET /api/market?tickers=…`**
- Returns one row per ticker:
  - `ticker, name, date, close, changePct`
  - `volume, avgVolume20, volumeRatio`
  - `ret5, ret21, high52, low52`
  - `spark[30], source`

**`POST /api/enrich`**
- Body: `{ "id": "<filing id>", "ticker": "TCS", "read": false }`
- The filing is loaded from the server's own store and must belong to `ticker`.
- Returns `{ id, results?, people?, brief?, needsKey?, briefError? }`.
- Errors: `400` for a malformed body; `404` for an unknown id or one belonging to another company.
- With `read: true` the call uses the model and counts toward `MODEL_RATE_LIMIT`.

**`GET /api/search?q=tata`**
- Requires at least 2 characters; the query is truncated to 40.
- Returns matching companies.

**`GET /api/research/:ticker`**
- Returns `{ ticker, name, about, view, financial, price, ratios, ttm, growth, annual, balance, cash, quarters, signals, docs, llm }`.

**`GET /api/research/:ticker/analysis`**
- Returns one of:
  - `{ status: "running", stage }`
  - `{ status: "done", data: { business, calls, verdict, warnings } }`
  - `{ status: "error", error }`
  - `{ status: "no_llm" }`
- Starting a new company counts toward `ANALYSIS_PER_HOUR`. Polling a job already started is free.

**`POST /api/research/:ticker/ask`**
- Body: `{ "question": "What margin guidance was given?" }`, 3 to 300 characters.
- Returns:
  - `answer`
  - `sources[]`, each `{ doc, page, quote }`
  - `not_in_sources`: true when the documents do not cover the question
- Returns `{ needsKey: true }` when no model is configured.
- Counts toward `MODEL_RATE_LIMIT`.

### Errors

| Status | Meaning |
|---|---|
| `400` | Malformed input (ticker format, body shape) |
| `401` | Access code missing or wrong |
| `404` | Filing not found for that company |
| `429` | Rate or spend limit reached; see `Retry-After` |
| `502` | An upstream source failed. The message is generic, and details are logged on the server only. |

---

## Module reference

### Backend

#### `server.js`
| Function | Description |
|---|---|
| `limiter(name, max, windowMs)` | In-memory fixed-window rate limiter per client IP. Returns Express middleware that answers 429 with `Retry-After`. |
| `codeOk(code)` | Constant-time comparison of SHA-256 digests against `ACCESS_CODE`. Always true when no code is set. |
| `tickersOf(req)` | Parses and validates the `tickers` query parameter (up to 30). |
| `wrap(fn)` | Async route wrapper. Logs the full error and returns a generic or allow-listed message. |

#### `push.js`
| Function | Description |
|---|---|
| `loadCompanies(tickers)` | Loads company data for tickers, three at a time, dropping failures. |
| `digest({ tickers, from, to })` | Polls sources, finds filings in the window, classifies and groups them by ticker, category and IST day. |
| `market(tickers)` | Quotes and price summaries for each holding. |
| `resultsCard(company, filedAt)` | Revenue, EBITDA, PBT and PAT with QoQ, YoY and margin. Flags when the table trails the filing. |
| `enrichById(id, ticker, opts)` | Loads a filing from the store, verifies it belongs to the company, then enriches it. |
| `enrich(item, { read })` | Builds the results card, people extraction and an optional model brief for one filing. |

#### `research.js`
| Function | Description |
|---|---|
| `facts(ticker)` | Everything computable from reported numbers: TTM, CAGRs, annual series, balance sheet, cash quality, quarters and signals. |
| `analysis(ticker)` | Starts or returns the background job: transcripts and annual report through the fast tier, then one smart-tier verdict. |
| `ask(ticker, question)` | Selects passages from the company's documents and answers with cited quotes. |

#### `classify.js`
| Export | Description |
|---|---|
| `classify(filing)` | Returns `{ category, tier, tag }` from ordered rules. |
| `headline(filing)` | The most specific human-readable line for a filing. |
| `CATEGORY_LABEL` | Display names for the 17 categories. |

#### `docs.js`
| Export | Description |
|---|---|
| `pages(url)` | Text of a filed document, one string per page, cached permanently. Handles PDF, HTML and XBRL. Capped at 45 MB. |
| `select(pages, terms, budget, chunkSize)` | Keyword-scored chunk selection within a character budget. |
| `GUIDANCE_TERMS` | Vocabulary used to find forward-looking statements. |

#### `llm.js`
| Export | Description |
|---|---|
| `llmJson({ tier, system, user, maxTokens })` | Calls the fast or smart tier and returns parsed JSON. Cached on the prompt hash, retried on 429 and 5xx, and blocked once the daily budget is spent. |
| `llmInfo()` | Provider, models, usage, and any configuration problem. |
| `parseJson(text)` | Extracts the first complete JSON object or array from model output. |
| `usage` | Token ledger: calls, input and output per tier, and cache hits. |

#### `store.js`
| Export | Description |
|---|---|
| `initStore()` | Connects to MongoDB when `MONGODB_URI` is set, otherwise loads the JSON files. |
| `cached(key, ttlMs, fn)` | Read-through cache with in-flight de-duplication, serving stale data on upstream errors. |
| `peek(key)` | Reads a cached value without computing it. |
| `upsertFilings(list)` | Inserts new filings; keeps two months in file mode. |
| `getFiling(id)` | One stored filing by id. |
| `findFilings({ companies, from, to })` | Filings in a window for the given companies. |

#### `sources/`
| Function | Description |
|---|---|
| `http.get(url, opts)` | Fetch with a timeout and a per-host concurrency gate. |
| `http.mapLimit(items, limit, fn)` | Concurrency-limited map. |
| `screener.company(ticker)` | Name, codes, ratios, quarterly, P&L, balance sheet, cash flow and ratio tables, announcements, annual reports and concalls. Consolidated with a standalone fallback. |
| `screener.search(q)` | Company search. |
| `screener.chart(id, days)` | Price history, used as a fallback. |
| `prices.quote(company)` | Yahoo Finance (`.NS`, then `.BO`), falling back to Screener. |
| `prices.summarise(bars)` | Day move, 20-day volume ratio, 5- and 21-day returns, 52-week range and a 30-close spark. |
| `nse.pollNse(force)` | Fetches and stores the NSE announcements feed. |
| `nse.backfill(company)` | Stores a company's recent BSE announcements from Screener. |
| `nse.parseFeed(xml)` | Parses the RSS feed into filings. |

### Frontend

| Module | Exports and responsibilities |
|---|---|
| `lib.js` | `api` (typed client for every route, sends the access code, signals a 401), `accessCode`, `useLocal`, `useAsync` (with refresh interval), formatters (`num`, `cr`, `price`, `pct`, `fy`, `ago`), `DEFAULT_RULES`, `tierOf`, `moveOf`, `safeUrl`. |
| `App.jsx` | Checks access, shows the `Lock` screen, does hash routing (`#/brief`, `#/research/:ticker`, `#/rules`) and renders the dock. |
| `Brief.jsx` | `Brief` home page: hero item, `Pulse` holdings card, moves and glance tiles, the material list, and routine filings. `Filing`, `ResultsTable` and `People` render enrichment. |
| `Research.jsx` | `Search`, the `Company` page, the `Analysis` job view and the `Ask` box. |
| `Rules.jsx` | Thresholds, notifications, portfolio, category overrides, data panel and the install prompt. |
| `Charts.jsx` | `Spark` and `Chart` (bar or line) with a pointer scrub readout. |

---

## Security

FINN was audited against a 25-point web application security checklist on 15 November 2026. It has no user accounts, payments, uploads or SQL database, so those groups do not apply. Every item is still listed, so the gaps are visible.

### Threat model

| Asset | Risk | Control |
|---|---|---|
| Model API key and budget | Theft or spend abuse | Key held server-side only; access code; per-IP and daily limits |
| Server | SSRF, injection, crashes | Server-side lookups, input validation, bounded inputs |
| Users' browsers | XSS, clickjacking | React escaping, `safeUrl`, Content-Security-Policy, frame denial |
| Shared caches | Poisoning across users | Keys derived from document URLs and full prompt hashes |

### Audit results

| # | Check | Status | Implementation |
|---|---|---|---|
| 1 | No hardcoded secrets | Pass | Keys are read from `backend/.env` only. The repository and full git history were searched for `sk-`, `API_KEY`, `SECRET` and `PASSWORD`; no live key appears in any commit. |
| 2 | No secrets in client code | Pass | The only client variable is `VITE_API_URL`, a public URL. All model calls are made by the server. |
| 3 | Environment set in every environment | Pass | Nothing is required to start. `/api/meta` reports a half-set provider (key without base URL) instead of failing silently. |
| 4 | `.env` ignored | Pass | `.env` and `.env.*` are ignored; `.env.example` is the only tracked env file. |
| 5–10 | Password hashing, sessions, JWT, reset tokens, email verification, OAuth state | N/A | No accounts. The portfolio and rules live in the browser. |
| 11 | Every API route checks the caller | Pass | With `ACCESS_CODE` set, every route except the access check and unlock returns 401 without a valid `X-Finn-Code`. The comparison is constant time on SHA-256 digests. |
| 12 | Users access only their own data (IDOR) | Pass | No per-user records exist on the server. `/api/enrich` accepts only a filing id and ticker, loads the filing from the server's store, and verifies ownership. An unknown id and another company's filing return the same 404, so ids cannot be probed. Shared caches cannot be poisoned across users. |
| 13–14 | Admin routes, tenant boundaries | N/A | No admin routes; single tenant. |
| 15 | Parameterised queries | Pass | No SQL. MongoDB queries take typed values. Tickers are validated against `^[A-Z0-9&-]{1,20}$` and ids must be strings, which blocks operator injection. |
| 16 | File uploads restricted | N/A | No uploads. JSON bodies are capped at 50 kB. |
| 17 | Input sanitised before rendering | Pass | No `dangerouslySetInnerHTML`, `innerHTML` or `eval`. React escapes all text, including model output. Scraped links pass `safeUrl` (http and https only). |
| 18 | Login rate limiting | Pass | Wrong access codes are counted per IP. After 10 in 15 minutes, that IP receives 429 even for the correct code. Only failures count. |
| 19 | Reset rate limiting | N/A | No password reset. Rotating `ACCESS_CODE` signs out every device. |
| 20 | AI endpoints have spend limits | Pass | Ask and *Read it for me* are limited to 30 per IP per 10 minutes. New analyses are limited to 12 per IP per hour. A server-wide cap of 2M fresh tokens per day applies to all model calls. Cached answers are free. |
| 21–23 | Webhook signatures, idempotency, subscription checks | N/A | No payments. |
| 24 | Row-level security | N/A | No Supabase. MongoDB is reached only by the server, with credentials from the environment. |
| 25 | Errors do not leak internals | Pass | Errors are logged server-side with stack traces. Clients receive a generic or allow-listed message, never a stack trace, upstream URL or file path. |

### Additional hardening

- **Server-side request forgery.** The server never fetches a URL supplied by a client. Filing documents come from the server's own store; other documents come from links on Screener's company pages.
- **Security headers:**
  - `Content-Security-Policy`: self only, plus Google Fonts
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`: no camera, microphone or geolocation
  - `X-Powered-By`: removed
- **CORS.** Disabled by default, since the server hosts its own client. Other origins must be listed in `CORS_ORIGIN`.
- **Input bounds.** Questions are capped at 300 characters, search at 40, tickers at 30 per request, and digest windows at about 92 days.
- **Dependencies.** `npm audit --omit=dev` reports 0 vulnerabilities in both packages. unpdf was upgraded to 2.x to remove the `canvas` → `tar` chain, which carried a critical advisory.
- **Service worker.** Never caches the access check or a running analysis job. Copies a response before caching it.

### Verification

Each control was tested against the running server.

| Test | Expected | Result |
|---|---|---|
| `/api/meta` without the code | 401 | Pass |
| Ask without the code | 401 | Pass |
| Static page without the code | 200 (lock screen) | Pass |
| Unlock with a wrong code, then the right code | 401, then 200 | Pass |
| 11th unlock after 10 wrong codes, using the right code | 429 | Pass |
| Enrich: filing's own company | 200 | Pass |
| Enrich: same id under another company | 404 | Pass |
| Enrich: made-up id | 404 | Pass |
| Enrich: object as id (`{"$ne": null}`) | 400 | Pass |
| Enrich: client-built filing object | 400 | Pass |
| Ticker `../../etc` or `<script>` | 400 | Pass |
| Request with a foreign `Origin` | No CORS header | Pass |
| 31st Ask within 10 minutes | 429 with `Retry-After` | Pass |
| Page renders under the Content-Security-Policy | No blocked resources | Pass |

### Open items

- **Shared code, not per-user sign-in.** Anyone holding the code has full access until `ACCESS_CODE` is rotated. Per-user sessions are planned: they replace `codeOk` in [`server.js`](backend/src/server.js), and the lock screen becomes the login page.
- **In-memory rate limits.** These suit a single instance. Scaling out needs a shared store such as Redis.
- **Code stored in local storage.** It stays on each device until Rules → **Lock FINN on this device** removes it.

---

## SEO

FINN is a private, single-page application. Its screens are hash routes (`#/brief`, `#/research/TCS`), which search engines ignore, and their data sits behind the access code. The home page is therefore the one indexable URL, and the SEO setup aims to describe it well and keep crawlers away from the API.

### What is served

| Item | Implementation |
|---|---|
| `robots.txt` | Allows `/`, disallows `/api/`, and links the sitemap when `SITE_URL` is set. Cached for a day. |
| `sitemap.xml` | One `<url>` for the home page, with `lastmod` taken from the build date. Served only when `SITE_URL` is set; otherwise 404. |
| Canonical URL | `<link rel="canonical">` pointing at `SITE_URL/`. |
| Social sharing | Open Graph tags (type, site name, title, description, URL, image, locale) and a Twitter summary card. |
| Structured data | JSON-LD `WebApplication` (finance category, free, any OS). |
| Basics | `lang="en"`, viewport, meta description, theme colour, web manifest, and icons at 192 and 512 px. |

### Audit

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | Title present | Pass | `FINN: Portfolio Filings & Stock Research` in the browser tab and share tags. The installed app keeps the short name `FINN`. |
| 2 | Meta description | Pass | One sentence on what FINN does. |
| 3 | Language and viewport | Pass | `lang="en"`, responsive viewport. |
| 4 | Canonical URL | Pass | Absolute when `SITE_URL` is set, relative otherwise. |
| 5 | robots.txt | Pass | Keeps crawlers out of `/api/`. |
| 6 | sitemap.xml | Pass | Valid XML (checked with `xmllint`), linked from robots.txt. |
| 7 | Open Graph and Twitter tags | Pass | Title, description, URL and image. |
| 8 | Structured data | Pass | JSON-LD parses as valid JSON. Rendering is not blocked by the Content-Security-Policy. |
| 9 | Mobile friendly | Pass | Mobile-first layout, dvh units, installable PWA. |
| 10 | HTTPS | Deployment | Required on the host; also needed for install and notifications. |
| 11 | Indexable content | By design | Data screens are hash routes behind the access code, so they are not indexed. |

### Safety

- **No Host-header echo.** Absolute URLs are built only from `SITE_URL`, and only its origin is used, so a path, query or forged `Host` header can never reach the page or the XML. Verified: a `Host` header carrying `<script>` appears in neither.
- **Service worker.** Never caches `sitemap.xml` or `robots.txt`, and only an HTML response can become the cached app shell. Before this fix, opening the sitemap in a tab could have replaced the offline app with the XML.

---

## Known limitations

- **Filings history.** It is only as deep as the poller has been running, plus the last five BSE announcements per company. A 30-day window on a fresh install is thin.
- **Results first cut.** It uses Screener's standardised quarterly table, not text parsed from the results PDF, and can trail a fresh filing by some hours. The card says when it does.
- **Lenders.** *Financing profit* stands in for EBITDA at banks and lenders.
- **Alerts.** They are evaluated while the app is open. There is no server push to a closed phone.
- **Name matching.** NSE feed names are matched by normalised name and symbol, so an unusual legal name can be missed.
- **Model testing.** The model path was tested live against `hyde/glm-5.3-flash`. Ask answered in under 3 seconds with page-cited quotes. A first full analysis used about 31k fast-tier tokens, and a cached repeat took 12 seconds. Gemini and Groq use the same OpenAI-compatible path but have not been run live.

---

## Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `style`, `chore`, with a scope such as `backend`, `frontend`, `api`, `llm` or `pwa`.
- Keep rules ahead of models: anything that can be computed should not be sent to a model.
- Never commit `.env`. Check `git status` before the first commit on a new machine.
- Run `node --check` on changed server files and `npm run build` in `frontend/` before pushing.
