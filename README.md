# SkOiT — an OSINT analyst console

A working open-source-intelligence workbench that runs on your own machine. It collects from real
public sources, shows exactly what it could **not** verify, scores the gaps as well as the findings,
and saves every run as a case file you own.

No accounts. No cloud database. No telemetry. 40 skills — 29 live against public endpoints, 11 offline
validators — and one rule enforced throughout: **nothing is asserted that was not collected.**

```
 ┌──────────────┬────────────────────────────────────────────┬─────────────────────┐
 │ Case files   │ Plan → skill runs → evidence → briefing    │ Findings            │
 │ search       │                                            │ Media & reporting   │
 │ pin          │ Ask in Hinglish or English, attach a photo │ Pivots              │
 │ export       │ or a PDF, dictate the question             │ Sources             │
 │ import       │                                            │ Risk read           │
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
`encyclopedia` (keyless Wikipedia lookup in the language of the question, licence and attribution stated) ·
`audio-search` (Internet Archive, Wikimedia Commons and Openverse for downloadable audio; Jamendo in full with a free client id; official 30-second catalogue previews with store links for released music) ·

**Everyday retrieval** — `music-saavn` (the JioSaavn catalogue: full-length songs, precision-ranked to the song you
named, played and downloadable in-app; catalogue streams for personal listening, labelled as such) · `video-youtube`
(YouTube search played through the official nocookie embed inside the console; downloads are deliberately not offered)
· `news-google` (Google News per-country editions, newest first, publisher links resolved for in-app reading; the
country is asked once, remembered, and can be switched by saying "news from …") · `open-web` (keyless DuckDuckGo/Bing
search with four structured modes: exam papers with direct PDFs, study material, website discovery including fresh
Vercel/Netlify projects, and product offer hunting across stores from a pasted Amazon/Flipkart link) ·
`article-reader` (pulls any article out of its page, extracts key points, and feeds the in-app reader) ·
`vehicle-registration` (state, RTO zone, series decode — plus a plain statement that owner data is not
publicly obtainable)

**Retrieval** — `image-search` (Wikimedia Commons, Openverse, NASA, plus Pexels/Pixabay/Unsplash when
keyed) · `video-search` (Commons video, NASA assets, Internet Archive footage, stock libraries) ·
`news-search` (GDELT news index, Hacker News, Wikipedia — each result corroborated across independent
domains before it is called anything more than single-source) · `image-provenance` (hashes an image
from a URL, matches it against Commons by SHA-1, shows perceptual hashes and names the keyed reverse
searches it could not run instead of guessing)

**Knowledge** — `text-intelligence` (entities, dates, indicators, PII flags in pasted text) ·
`coordinate-intelligence` (DMS, geodesic distance to a bundled city index) · `web-search` ·
`sanctions-screening` (OpenSanctions)

**Media & tradecraft** — `attachment-review` (EXIF, GPS, camera serial, timestamp tampering, entropy,
hashes, PDF structure — parsed in your browser) · `hash-intel` (algorithm ID, strength, VirusTotal when
keyed) · `reference-lab` (JWT claims, ObjectId/UUIDv7 timestamps, Unix time, base64) ·
`url-structure` (userinfo tricks, punycode, impostor brands, shorteners) · `typosquat-watch`
(permutations, then **DNS-verified** so you see which lookalikes actually resolve) · `dns-posture`
(SPF, DMARC, DKIM selectors, CAA, security.txt)

## Images, articles, video and news

Ask for a picture, a clip or a story and that is what comes back — a gallery of images with the licence
each source states, downloadable video and B-roll, and reporting with its corroboration counted. Ask for
one thing and one thing returns; ask for a domain and the full sweep runs. Depth is yours to set.

- **Focused** answers exactly what was asked. **Standard** adds background. **Deep** sweeps every
  relevant skill, documents included. Set it in Settings → Answers.
- Media toggles decide what is searched by default; **an explicit ask always wins** — switching video
  off does not refuse a video request.
- The licence filter defaults to items cleared for reuse. Items with no stated licence are still shown
  when you ask for any licence, flagged, never quietly presented as free.
- Every result carries its source library, author, dimensions/duration where the source gives them, a
  direct download link, and a link to the source page. Nothing is rehosted or proxied — the console
  never becomes a mirror of other people's media.
- News is corroborated by clustering headlines across independent domains: you see `+N independent`
  or `single source`, and syndicated copies are labelled as copies.

## The honesty model

This is the part that matters, and it is structural rather than a prompt instruction.

- Every skill returns `{ status, summary, evidence[], entities[], sources[], error? }`. Unreachable,
  blocked, partial and error are first-class outcomes that appear in the coverage table of every
  briefing — not swallowed. A media search that could not reach its sources says which ones failed.
- The risk score is arithmetic. Critical/high/medium findings add weight; **unreachable sources and
  unconsulted keyed sources add weight too**, capped, because a blind spot is not an all-clear. A run
  that collected nothing says the band reflects verifiability, not a finding against the target.
- A skill that needs a key reports `requires_key` with instructions. It never returns a fake "no match",
  and image search names the libraries it could not query.
- When a model is configured it receives the evidence JSON and is instructed to cite collected sources
  and to never add facts of its own; an empty or failed model response falls back to the deterministic
  write-up with a warning. With no model configured, briefings are deterministic and fully functional.
- **Two registers, one set of evidence.** *Plain* (the default) writes for a general reader with the
  technical terms kept and explained; *Analyst* writes the structured dossier with the coverage table and
  risk factors. Both render exactly the evidence that was collected.
- **The free browser model is opt-in.** With no key of your own, `ai: "auto"` may load Puter.js in the
  browser and let a free model write the briefing over the collected evidence only. `ai: "off"` never
  loads it. If the script cannot load, the built-in writer answers and the run says why.
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
to `~/.skoit/config.json` with owner-only permissions and never sent back to the browser (the API
reports presence only).

| Purpose | Variables |
| --- | --- |
| Briefing models | `SARVAM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `COMPATIBLE_BASE_URL` (local Ollama/LM Studio, loopback only) |
| Keyed sources | `HIBP_API_KEY`, `SEARCH_API_KEY`, `OPENSANCTIONS_API_KEY`, `VIRUSTOTAL_API_KEY` |
| Keyed media libraries | `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY` |
| Keyed music library | `JAMENDO_CLIENT_ID` (free) — full Creative Commons tracks as downloadable files |

Song requests are answered with something you can actually use: full files with their licence from
Internet Archive, Wikimedia Commons, Openverse and (when keyed) Jamendo, played in place and linked for
download; released commercial recordings come back as the store's own 30-second preview with a link to
buy or stream the whole thing. Nothing is rehosted and no copyright is bypassed.

Images support Sarvam (`sarvam-m`), OpenAI, Anthropic, Google Gemini and any OpenAI-compatible local
server; `SKOIT_MODEL_PROVIDER` forces a choice and `<PROVIDER>_MODEL` overrides the default. Model calls
are plain `fetch` — no model SDK is bundled. Answer settings live under `~/.skoit/config.json` too, so
the server pass and the browser pass plan from identical rules.

## Case files

A case holds every prompt, plan, skill outcome, finding, pivot, source, risk history, briefing, and the
images/clips/reporting that were returned — with their licences. Cases are stored server-side in
`~/.skoit/cases.json` and mirrored in the browser (`localStorage`) for instant reads, searchable by
prompt text, pinnable, and exportable as JSON (re-importable) or as a markdown report that lists the
files found for printing or PDF.

Data written under the old `~/.indus` directory and the old browser storage key is migrated on first
run.

## Third-party notices

`THIRD-PARTY-NOTICES.md` lists every bundled library with the licence its own
`package.json` declares, plus the public sources the skills query and the terms
each one carries.

## Legal and ethical scope

This tool queries public registries, transparency logs and public APIs. It does not bypass
authentication, scrape private data, or emit identity claims it cannot verify. It deliberately refuses
to infer caste, religion or community from names, and it states plainly which data — subscriber
identity, vehicle ownership, unmasked government identifiers — is only obtainable through lawful
authority. Media stays where it was published: licences are quoted, attribution is shown, and using a
tool like this to profile, harass or surveil individuals may be unlawful. Under the DPDP Act 2023 and
the IT Act, that responsibility is yours.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 with a custom token
layer · Radix primitives · react-markdown · exifr · libphonenumber-js · Biome · heavy computation done
over DoH and plain `fetch`, so nothing in the collection path depends on a vendor SDK.
