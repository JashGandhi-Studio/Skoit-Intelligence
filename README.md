# INDUS — an OSINT analyst console

A working open-source-intelligence console: it collects from real public sources, shows exactly what it
could and could not verify, and saves every investigation as a case file you own.

Built as a single Next.js application that runs on your own machine. No accounts, no telemetry, no
database server, no cloud storage. Case files and API keys stay in `~/.indus/` unless you export them.

```
┌─────────────┬────────────────────────────────────────┬──────────────────┐
│ Case files  │  Collection plan → skill runs →        │  Findings        │
│ search /    │  evidence → analyst briefing           │  Pivots          │
│ pin / export│                                        │  Sources         │
│             │  composer: target detection, EXIF-     │  Risk read       │
│             │  aware attachments, dictation          │  Coverage        │
└─────────────┴────────────────────────────────────────┴──────────────────┘
```

## What it actually does

29 skills — **18 live** against documented public endpoints, **11 offline** validators. Every finding is
evidence with a source, a confidence level (`confirmed` / `probable` / `possible` / `unknown`) and, where
relevant, a severity.

**Network & infrastructure**
`dns-intel` (A/AAAA/MX/NS/TXT/CAA/SOA over DoH) · `domain-registration` (RDAP: registrar, lifecycle events,
EPP status, DNSSEC) · `certificate-transparency` (crt.sh subdomain enumeration + issuing CAs) ·
`ip-geolocation` (ipwho.is, with ip-api as a documented fallback) · `ip-services` (Shodan InternetDB passive
scan noise, CVE flags) · `reverse-dns` (+ /24 PTR sweep) · `ip-registry` (RIR RDAP) · `bulk-ip` (batch
triage) · `archive-history` (Wayback CDX: first/last capture, active years, non-200 windows)

**Identity & communications**
`email-intelligence` (MX reality, provider class, disposable/role detection, Gravatar hash) ·
`breach-exposure` (Have I Been Pwned; domain listing works unauthenticated, account lookups need a key) ·
`username-footprint` (GitHub, GitLab, Codeberg, Hacker News, Keybase, Reddit profile APIs) ·
`phone-intelligence` (libphonenumber: country, line type, VoIP flag, validity) · `crypto-address`
(Base58Check + bech32 checksum verification, mempool.space chain stats)

**India-first**
`pincode-intelligence` (PIN prefix scheme → circle/state, live delivery-office data when reachable) ·
`vehicle-registration` (state + RTO zone + series decode, and a plain statement that owner data is not
publicly obtainable) · `identity-documents` (Aadhaar Verhoeff checksum, GSTIN mod-36 check digit, PAN holder
type, IFSC, UPI handle, EPIC/passport structure — values masked by default) · `coordinate-intelligence`
(DMS conversion, geodesic distance to a bundled city index) · `name-conventions` (scripts, honorifics,
transliteration variants — and a refusal, by design, to infer caste or religion)

**Tradecraft & media**
`url-structure` (userinfo tricks, punycode, deep subdomains, brand impersonation, shorteners, tracking
params) · `typosquat-watch` (omission/transposition/homoglyph/TLD-swap permutations, then **DNS-verified** —
it tests which lookalikes are actually registered) · `attachment-review` (EXIF, GPS, camera serial,
timestamp tampering, entropy, hashes — parsed in your browser) · `hash-intel` (algorithm identification,
strength notes, VirusTotal when keyed) · `reference-lab` (JWT claims, MongoDB ObjectId and UUID v1/v7
embedded timestamps, Unix time, base64/URL decoding) · `dns-posture` (SPF/DMARC/DKIM/CAA/security.txt) ·
`host-resolution-sweep` (triage a host list down to what is live) · `web-search` (keyed) ·
`sanctions-screening` (keyed, OpenSanctions)

## How it stays honest

The rule that shapes the whole codebase: **prose may only render data that was collected.**

- Skills return `SkillOutcome { status, summary, evidence[], entities[], sources[], error? }`. Statuses
  include `unreachable`, `blocked` and `partial`, and they are shown, counted and scored.
- The risk score is arithmetic, not vibes: critical/high/medium evidence weights **plus penalties for
  unreachable sources and unconsulted keyed sources**. Blind spots raise the score instead of disappearing.
- A skill that needs an API key returns `blocked` with instructions — never a fake "no match".
- When a model is configured it receives the evidence JSON and is instructed never to add facts of its own,
  to cite source numbers inline, and to name every gap. Without a model, the deterministic analyst write-up
  is used and is fully functional.
- The console tells you whether *the server* has egress. If it does not (common in sandboxes), the browser
  becomes the collection path for CORS-capable public endpoints, and the merged result recomputes the risk
  band and briefing.

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm build && pnpm start   # production
pnpm typecheck
```

Node 20.9+. No environment variables are required. Optional keys live in `.env.example` and can also be
entered in the UI (Settings → Keys), where they are stored in `~/.indus/config.json` with `0600`
permissions and never returned to the browser — the API reports presence only.

Briefing models: Sarvam (`sarvam-m`), OpenAI, Anthropic, Google Gemini, or any local OpenAI-compatible
server (Ollama, LM Studio — loopback endpoints only, enforced server-side to prevent SSRF).

## Cases

A case file holds prompts, plans, per-skill evidence, entities, sources, risk history and briefings. It is
saved to `~/.indus/cases.json`, mirrored in the browser for instant reads, searchable in the sidebar by
prompt text, pinnable, and exportable as JSON (re-importable) or as a markdown report for printing/PDF.

## Browser fallback

Only skills flagged `clientFallback` run in the browser, using the same code as the server. EXIF parsing,
hashing and entropy happen entirely locally — files are never uploaded. If the browser cannot reach a
source either (CORS), that is recorded as an unreachable source, not as an absence of findings.

## Legal and ethical scope

This tool queries public registries, transparency logs and public APIs. It does **not** bypass
authentication, scrape private data, or emit identity claims it cannot verify. It deliberately refuses to
infer caste, religion or community from names, and it states plainly which data (subscriber identity,
vehicle ownership, unmasked government IDs) is only obtainable through lawful authority. Using it to
profile, harass or surveil individuals may be unlawful — DPDP Act 2023 and IT Act obligations are yours.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 with a custom token layer ·
Radix primitives · react-markdown + remark-gfm · exifr · libphonenumber-js · Biome. Model APIs are called
over plain `fetch` — no model SDK in the bundle.
