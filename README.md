# INDUS — an OSINT analyst console

A working open-source-intelligence workbench that runs on your own machine. It collects from real
public sources, shows exactly what it could **not** verify, scores the gaps as well as the findings,
and saves every run as a case file you own.

No accounts. No cloud database. No telemetry. 29 skills — 18 live against public endpoints, 11 offline
validators — and one rule enforced throughout: **nothing is asserted that was not collected.**

```
 ┌──────────────┬────────────────────────────────────────────┬─────────────────────┐
 │ Case files   │ Plan → skill runs → evidence → briefing    │ Findings            │
 │ search       │                                            │ Pivots              │
 │ pin          │ Ask in Hinglish or English, attach a photo │ Sources             │
 │ export       │ or a PDF, dictate the question             │ Risk read           │
 │ import       │                                            │ Coverage            │
 └──────────────┴────────────────────────────────────────────┴─────────────────────┘
```

## Run it

```bash
pnpm install
pnpm dev                 # http://localhost:3000
pnpm build && pnpm start # production
pnpm typecheck           # tsc --noEmit
pnpm lint                # biome check
```

Node 20.9+. Nothing has to be configured: with no keys and no internet, the offline skills still work,
live skills report themselves unreachable, and the briefing says so plainly.

## What it does

Every run: the question is scanned for targets (domain, IP, email, phone, username, URL, hash, crypto
address, IBAN, coordinates, text), a plan is built from those targets, each skill returns evidence with
a source and a confidence level, a risk band is computed arithmetically, and a briefing is written over
that evidence only.

**Network** — `dns-intel` (A/AAAA/MX/NS/TXT/CAA via DoH) · `ip-geolocation` · `reverse-dns` (+ /24 sweep)
· `bulk-ip` (multi-address triage) · `host-resolution-sweep`

**Infrastructure** — `domain-registration` (RDAP: registrar, lifecycle, EPP status, DNSSEC) ·
`certificate-transparency` (crt.sh subdomain discovery + issuers) · `ip-registry` (RIR RDAP) ·
`ip-services` (Shodan InternetDB passive exposure + CVEs) · `archive-history` (Wayback CDX first/last
capture, active years, non-200 windows)

**Identity** — `email-intelligence` (MX reality, provider class, disposable/role detection, Gravatar
hash) · `breach-exposure` (Have I Been Pwned) · `username-footprint` (GitHub, GitLab, Codeberg,
Hacker News, Keybase, Reddit) · `crypto-address` (Base58Check / Bech32 checksum verification) ·
`identity-documents` (Aadhaar Verhoeff, GSTIN mod-36, PAN holder type, IFSC, UPI, EPIC, passport —
values masked by default) · `name-conventions` (scripts, honorifics, transliterations, and an explicit
refusal to infer caste, religion or community)

**Comms** — `phone-intelligence` (libphonenumber: country, line type, VoIP flag) ·
`pincode-intelligence` (PIN circles and states, live delivery-office data when reachable) ·
`vehicle-registration` (state, RTO zone, series decode — plus a plain statement that owner data is not
publicly obtainable)

**Knowledge** — `text-intelligence` (entities, dates, indicators, PII flags in pasted text) ·
`coordinate-intelligence` (DMS, geodesic distance to a bundled city index) · `web-search` ·
`sanctions-screening` (OpenSanctions)

**Media & tradecraft** — `attachment-review` (EXIF, GPS, camera serial, timestamp tampering, entropy,
hashes, PDF structure — parsed in your browser) · `hash-intel` (algorithm ID, strength, VirusTotal when
keyed) · `reference-lab` (JWT claims, ObjectId/UUIDv7 timestamps, Unix time, base64) ·
`url-structure` (userinfo tricks, punycode, impostor brands, shorteners) · `typosquat-watch`
(permutations, then **DNS-verified** so you see which lookalikes actually resolve) · `dns-posture`
(SPF, DMARC, DKIM selectors, CAA, security.txt)

## The honesty model

This is the part that matters, and it is structural rather than a prompt instruction.

- Every skill returns `{ status, summary, evidence[], entities[], sources[], error? }`. Unreachable,
  blocked, partial and error are first-class outcomes that appear in the coverage table of every
  briefing — not swallowed.
- The risk score is arithmetic. Critical/high/medium findings add weight; **unreachable sources and
  unconsulted keyed sources add weight too**, capped, because a blind spot is not an all-clear. A run
  that collected nothing says the band reflects verifiability, not a finding against the target.
- A skill that needs a key reports `requires_key` with instructions. It never returns a fake "no match".
- When a model is configured it receives the evidence JSON and is instructed to cite collected sources
  and to never add facts of its own; an empty or failed model response falls back to the deterministic
  write-up with a warning. With no model configured, briefings are deterministic and fully functional.
- The console shows whether the **server** has egress. When it does not, the browser becomes the
  collection path for CORS-capable public endpoints, and the merged result is re-scored and rewritten
  with a labelled addendum — never silently blended.
- Files never leave the browser: EXIF, hashing, entropy and PDF structure are parsed locally, and only
  the derived findings travel with the request.

## Files, PDFs and voice

Attach up to 6 files (8 MB each). Images are parsed for EXIF — device, serial, lens, timestamps, GPS —
and flags such as "modified after capture" or "metadata stripped". PDFs are parsed for the metadata
that leaks: author, title, authoring toolchain, creation/modification times, encryption, digital
signatures, embedded JavaScript, embedded files and incremental edits after the first save. If the
dictionary is compressed or stripped, it says that instead of guessing. Dictation uses the browser's
speech recogniser (en-IN, hi-IN, mr-IN, ta-IN, te-IN, bn-IN, gu-IN, kn-IN, ml-IN, en-US).

## Keys and models

Everything is optional. Keys can be set in `.env` or entered in Settings → Keys, where they are written
to `~/.indus/config.json` with owner-only permissions and never sent back to the browser (the API
reports presence only).

| Purpose | Variables |
| --- | --- |
| Briefing models | `SARVAM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `COMPATIBLE_BASE_URL` (local Ollama/LM Studio, loopback only) |
| Keyed sources | `HIBP_API_KEY`, `SEARCH_API_KEY`, `OPENSANCTIONS_API_KEY`, `VIRUSTOTAL_API_KEY` |

Images support Sarvam (`sarvam-m`), OpenAI, Anthropic, Google Gemini and any OpenAI-compatible local
server; `INDUS_MODEL_PROVIDER` forces a choice and `<PROVIDER>_MODEL` overrides the default. Model calls
are plain `fetch` — no model SDK is bundled.

## Case files

A case holds every prompt, plan, skill outcome, finding, pivot, source, risk history and briefing.
Cases are stored server-side in `~/.indus/cases.json` and mirrored in the browser (`localStorage`) for
instant reads, searchable by prompt text, pinnable, and exportable as JSON (re-importable) or as a
markdown report for printing or PDF.

## Legal and ethical scope

This tool queries public registries, transparency logs and public APIs. It does not bypass
authentication, scrape private data, or emit identity claims it cannot verify. It deliberately refuses
to infer caste, religion or community from names, and it states plainly which data — subscriber
identity, vehicle ownership, unmasked government identifiers — is only obtainable through lawful
authority. Using a tool like this to profile, harass or surveil individuals may be unlawful; under the
DPDP Act 2023 and the IT Act, that responsibility is yours.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 with a custom token
layer · Radix primitives · react-markdown · exifr · libphonenumber-js · Biome · heavy computation done
over DoH and plain `fetch`, so nothing in the collection path depends on a vendor SDK.
