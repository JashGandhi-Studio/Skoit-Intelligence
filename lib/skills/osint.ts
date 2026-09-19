import { request, source } from "@/lib/net/http";
import { attrs, entity, evidence } from "@/lib/skills/emit";
import type { SkillDefinition } from "@/lib/types";

/**
 * Free OSINT expansion — capabilities that already exist in the wider world
 * but that SkOiT did not have. Every source here is keyless and public:
 *
 *   tech-stack        — what a site is actually built of (own fetch + headers)
 *   flight-tracking   — live aircraft positions (OpenSky Network, anonymous)
 *   public-filings    — company filings from SEC EDGAR's full-text search
 *   historic-imagery  — dated satellite imagery (Esri World Imagery Wayback)
 *
 * Same contract as every other skill: what could not be reached is reported as
 * unreachable, and nothing is asserted that was not collected.
 */

/* ------------------------------------------------------------ tech stack -- */

/** Signatures we can prove from the HTML, its scripts and the response headers. */
const STACK_SIGNATURES: Array<{
  name: string;
  category: string;
  test: (html: string, headers: Headers) => boolean | string;
}> = [
  { name: "Next.js", category: "framework", test: (h) => /\/_next\/|__NEXT_DATA__/i.test(h) },
  { name: "React", category: "library", test: (h) => /react(-dom)?[@./]|data-reactroot|__REACT/i.test(h) },
  { name: "Vue.js", category: "framework", test: (h) => /vue(\.runtime)?[.@-]|data-v-[0-9a-f]{8}/i.test(h) },
  { name: "Angular", category: "framework", test: (h) => /ng-version=|angular[.@]\d/i.test(h) },
  {
    name: "Svelte / SvelteKit",
    category: "framework",
    // The bare word "svelte" appears in blog posts and marketing copy — only a
    // SvelteKit runtime marker or its immutable asset path proves the stack.
    test: (h) => /__sveltekit|\/_app\/immutable\//i.test(h),
  },
  { name: "Nuxt", category: "framework", test: (h) => /__NUXT__|\/_nuxt\//i.test(h) },
  { name: "Astro", category: "framework", test: (h) => /astro-island|data-astro/i.test(h) },
  { name: "jQuery", category: "library", test: (h) => /jquery[-.](\d|min)/i.test(h) },
  { name: "Bootstrap", category: "css", test: (h) => /bootstrap[.@-][\d.]|bootstrap\.min\.css/i.test(h) },
  { name: "Tailwind CSS", category: "css", test: (h) => /tailwind|class="[^"]*\b(?:flex|grid)\b[^"]*\b(?:gap-\d|px-\d|py-\d)/i.test(h) },
  { name: "WordPress", category: "cms", test: (h) => /wp-content|wp-includes|wp-json/i.test(h) },
  { name: "Shopify", category: "ecommerce", test: (h) => /cdn\.shopify\.com|shopify\.theme/i.test(h) },
  { name: "Wix", category: "site builder", test: (h) => /wix\.com|wixstatic/i.test(h) },
  { name: "Squarespace", category: "site builder", test: (h) => /squarespace/i.test(h) },
  { name: "Webflow", category: "site builder", test: (h) => /webflow/i.test(h) },
  { name: "Ghost", category: "cms", test: (h) => /ghost(?:-content|\/assets\/built)/i.test(h) },
  { name: "Drupal", category: "cms", test: (h) => /drupal|sites\/default\/files/i.test(h) },
  { name: "Cloudflare", category: "cdn", test: (_h, hd) => Boolean(hd.get("cf-ray")) },
  { name: "Vercel", category: "hosting", test: (_h, hd) => /vercel/i.test(hd.get("server") ?? "") || Boolean(hd.get("x-vercel-id")) },
  { name: "Netlify", category: "hosting", test: (_h, hd) => /netlify/i.test(hd.get("server") ?? "") || Boolean(hd.get("x-nf-request-id")) },
  { name: "Google Analytics", category: "analytics", test: (h) => /googletagmanager|google-analytics|gtag\(/i.test(h) },
  { name: "Google Tag Manager", category: "analytics", test: (h) => /googletagmanager\.com\/gtm/i.test(h) },
  { name: "Meta Pixel", category: "analytics", test: (h) => /connect\.facebook\.net.*fbevents/i.test(h) },
  { name: "Hotjar", category: "analytics", test: (h) => /hotjar/i.test(h) },
  { name: "Stripe", category: "payments", test: (h) => /js\.stripe\.com|stripe\.js/i.test(h) },
  { name: "Razorpay", category: "payments", test: (h) => /razorpay/i.test(h) },
  { name: "Amazon S3", category: "storage", test: (h) => /\.s3[.-][a-z0-9-]*\.amazonaws\.com/i.test(h) },
  { name: "Cloudinary", category: "media", test: (h) => /res\.cloudinary\.com/i.test(h) },
  { name: "Sentry", category: "monitoring", test: (h) => /sentry(?:\.io|-cdn)/i.test(h) },
  { name: "Algolia", category: "search", test: (h) => /algolia/i.test(h) },
  { name: "OpenStreetMap tiles", category: "maps", test: (h) => /tile\.openstreetmap\.org|cartocdn\.com/i.test(h) },
  { name: "Google Maps", category: "maps", test: (h) => /maps\.google(?:apis)?\.com|google\.com\/maps/i.test(h) },
  { name: "reCAPTCHA", category: "security", test: (h) => /recaptcha/i.test(h) },
  { name: "hCaptcha", category: "security", test: (h) => /hcaptcha/i.test(h) },
  { name: "Apache", category: "server", test: (_h, hd) => /apache/i.test(hd.get("server") ?? "") },
  { name: "Nginx", category: "server", test: (_h, hd) => /nginx/i.test(hd.get("server") ?? "") },
  { name: "IIS", category: "server", test: (_h, hd) => /iis|microsoft-httpapi/i.test(hd.get("server") ?? "") },
  { name: "PHP", category: "language", test: (_h, hd) => /php/i.test(hd.get("x-powered-by") ?? "") },
  { name: "ASP.NET", category: "language", test: (_h, hd) => /asp\.net/i.test(hd.get("x-powered-by") ?? "") },
  { name: "HTTP/2", category: "protocol", test: (h) => /h2|http\/2/i.test(h) },
];

/** Interesting response headers: often the highest-signal thing a site leaks. */
const HEADER_OF_INTEREST = [
  "server",
  "x-powered-by",
  "x-generator",
  "x-aspnet-version",
  "x-drupal-cache",
  "x-shopify-stage",
  "x-vercel-id",
  "x-nf-request-id",
  "cf-ray",
  "via",
  "x-cache",
  "x-backend-server",
  "x-amz-cf-id",
];

export const techStack: SkillDefinition = {
  id: "tech-stack",
  name: "Website technology fingerprint",
  short: "Tech stack",
  description:
    "Fetches a site the way a browser does and fingerprints what it is actually built from — framework, CMS, analytics, payment processor, CDN, hosting and server software — from the page source, its script tags and its own response headers. Keyless, from a single public request.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["domain", "url"],
  produces: ["technology", "headers"],
  keywords: [
    "tech stack",
    "technology stack",
    "what is this site built with",
    "what technology",
    "built with",
    "powered by",
    "frameworks",
    "cms",
    "web technology",
    "what runs on",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "tech-stack";
    const host = target.value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    const url = target.kind === "url" ? target.value : `https://${host}`;
    ctx.log(`Fingerprinting ${host}`);

    const src = source("tech-stack", "Site's own response", url, "api");
    const response = await request<string>(url, ctx, {
      parse: "text",
      timeoutMs: 12_000,
      accept: "text/html,application/xhtml+xml",
    });

    if (!response.ok) {
      return {
        status: "unreachable" as const,
        summary: `${host} could not be fetched (${response.error?.message ?? "no response"}).`,
        evidence: [
          evidence(skill, "Fetch", "unreachable", {
            detail: response.error?.message,
            source: src,
            kind: "warning",
          }),
        ],
        entities: [],
        sources: [src],
        error: response.error,
      };
    }

    const html = typeof response.data === "string" ? response.data : "";
    const headers = response.headers ?? new Headers();
    const found = STACK_SIGNATURES.filter((sig) => {
      try {
        return Boolean(sig.test(html, headers));
      } catch {
        return false;
      }
    });

    const byCategory = new Map<string, string[]>();
    for (const item of found) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item.name);
      byCategory.set(item.category, list);
    }

    const evidenceItems = [...byCategory.entries()].map(([category, names]) =>
      evidence(skill, category, names.join(", "), {
        source: src,
        detail: `${names.length} match(es) in the page source and headers`,
      }),
    );

    const interesting = HEADER_OF_INTEREST.map((key) => [key, headers.get(key)] as const)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) =>
        evidence(skill, `Header · ${key}`, String(value), { source: src }),
      );
    evidenceItems.push(...interesting);

    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim();
    const generator = html.match(
      /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,120})["']/i,
    )?.[1];

    const entityAttributes = attrs({
      url,
      title,
      generator,
      server: headers.get("server") ?? undefined,
      technologies: found.length,
    });

    const summary =
      found.length === 0
        ? `${host} answered, but nothing in its public source or headers identifies its stack. Many hardened sites strip exactly this.`
        : `${host} runs: ${[...byCategory.entries()]
            .map(([category, names]) => `${category} — ${names.join(", ")}`)
            .join("; ")}.`;

    return {
      status: "ok" as const,
      summary,
      evidence: evidenceItems,
      entities: [
        entity(skill, "domain", host, "Fingerprinted site", entityAttributes),
      ],
      sources: [src],
    };
  },
};

/* -------------------------------------------------------- flight tracking -- */

/**
 * OpenSky returns state vectors as positional arrays — index 8 is the
 * on-ground flag, 9 is ground speed, 10 is true track. Indexing beat guessing
 * at named fields, which do not exist in this response.
 */
type OpenSkyRow = Array<string | number | boolean | null>;

export const flightTracking: SkillDefinition = {
  id: "flight-tracking",
  name: "Live aircraft tracking",
  short: "Flights",
  description:
    "Reads the OpenSky Network's open, keyless state vectors to show which aircraft are airborne inside a bounding box — callsign, country of registration, altitude, ground speed and heading. Free and anonymous; the network is crowd-sourced, so coverage thins away from populated regions.",
  category: "retrieval",
  runtime: "live",
  accepts: ["coordinate", "text"],
  produces: ["aircraft", "positions"],
  keywords: [
    "aircraft",
    "airplane",
    "aeroplane",
    "flight",
    "flights",
    "plane",
    "planes",
    "flightradar",
    "air traffic",
    "in the sky",
    "overhead",
    "ads-b",
    "adsb",
    "planes over",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "flight-tracking";
    const coordinates = target.meta?.lat && target.meta?.lon
      ? { lat: Number(target.meta.lat), lon: Number(target.meta.lon) }
      : { lat: 19.0896, lon: 72.8656 }; // Mumbai — the console's home audience

    // OpenSky wants a bounding box; ~2.2° each way is a city and its approach
    // corridors without asking for half a continent.
    const span = 2.2;
    const box = {
      lamin: coordinates.lat - span,
      lamax: coordinates.lat + span,
      lomin: coordinates.lon - span,
      lomax: coordinates.lon + span,
    };
    const ctxQuery = target.meta?.coordinatesQuery
      ? decodeURIComponent(target.meta.coordinatesQuery)
      : `${coordinates.lat.toFixed(3)},${coordinates.lon.toFixed(3)}`;
    ctx.log(`Checking live aircraft near ${ctxQuery}`);

    const url = `https://opensky-network.org/api/states/all?lamin=${box.lamin.toFixed(4)}&lomin=${box.lomin.toFixed(4)}&lamax=${box.lamax.toFixed(4)}&lomax=${box.lomax.toFixed(4)}`;
    const src = source("opensky", "OpenSky Network", "https://opensky-network.org", "api");

    const response = await request<{ time?: number; states?: OpenSkyRow[] }>(url, ctx, {
      timeoutMs: 15_000,
      retries: 1,
    });

    if (!response.ok) {
      const rateLimited = response.error?.code === "rate_limited";
      return {
        status: rateLimited ? ("partial" as const) : ("unreachable" as const),
        summary: rateLimited
          ? "OpenSky is rate-limiting anonymous requests right now — the network allows only a few hundred reads a day without an account, so try again shortly."
          : `Live aircraft data could not be reached (${response.error?.message ?? "no response"}).`,
        evidence: [
          evidence(skill, "OpenSky Network", "unreachable", {
            detail: response.error?.message,
            source: src,
            kind: "warning",
          }),
        ],
        entities: [],
        sources: [src],
        error: response.error,
      };
    }

    const states = (response.data?.states ?? []).filter(
      (row): row is OpenSkyRow => Array.isArray(row) && row.length > 10,
    );
    const airborne = states.filter((row) => row[8] !== true);

    if (states.length === 0) {
      return {
        status: "ok" as const,
        summary: `OpenSky answered from ${ctxQuery}: no aircraft are being tracked inside this box right now. Over ocean and in less-watched airspace that is normal, not a fault.`,
        evidence: [
          evidence(skill, "Aircraft tracked", "0", {
            source: src,
            detail: "The network returned an empty state vector for this bounding box.",
          }),
        ],
        entities: [],
        sources: [src],
      };
    }

    const rows = states
      .map((row) => ({
        icao24: String(row[0] ?? ""),
        callsign: String(row[1] ?? "").trim(),
        country: String(row[2] ?? ""),
        lon: Number(row[5]),
        lat: Number(row[6]),
        altitude: Number(row[7] ?? row[13]),
        onGround: row[8] === true,
        velocity: Number(row[9]),
        heading: Number(row[10]),
        lastContact: Number(row[3]),
      }))
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon))
      .sort((a, b) => (b.altitude || 0) - (a.altitude || 0));

    const evidenceItems = rows.slice(0, 12).map((row) =>
      evidence(
        skill,
        row.callsign || row.icao24 || "Unknown aircraft",
        `${row.altitude ? `${Math.round(row.altitude)} m` : "altitude n/a"} · ${row.velocity ? `${Math.round(row.velocity * 3.6)} km/h` : "speed n/a"} · heading ${Number.isFinite(row.heading) ? Math.round(row.heading) : "n/a"}°`,
        {
          source: src,
          detail: `${row.country || "origin unknown"} · ICAO24 ${row.icao24} · position ${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}${row.onGround ? " · on the ground" : ""}`,
        },
      ),
    );

    const countries = [...new Set(rows.map((row) => row.country).filter(Boolean))];

    return {
      status: "ok" as const,
      summary: `${rows.length} aircraft currently tracked near ${ctxQuery}${airborne.length !== rows.length ? ` (${rows.length - airborne.length} on the ground)` : ""} — highest at ${rows[0]?.altitude ? `${Math.round(rows[0].altitude)} m` : "unknown altitude"}${countries.length ? `, registrations from ${countries.slice(0, 4).join(", ")}${countries.length > 4 ? ` and ${countries.length - 4} more` : ""}` : ""}.`,
      evidence: evidenceItems,
      entities: rows.slice(0, 8).map((row) =>
        entity(
          skill,
          "aircraft",
          row.callsign || row.icao24,
          row.callsign ? `Flight ${row.callsign}` : `Aircraft ${row.icao24}`,
          attrs({
            country: row.country,
            altitudeMetres: row.altitude ? Math.round(row.altitude) : undefined,
            speedKmh: row.velocity ? Math.round(row.velocity * 3.6) : undefined,
            headingDegrees: Number.isFinite(row.heading) ? Math.round(row.heading) : undefined,
            latitude: row.lat.toFixed(4),
            longitude: row.lon.toFixed(4),
            onGround: row.onGround,
          }),
        ),
      ),
      sources: [src],
    };
  },
};

/* --------------------------------------------------------- public filings -- */

interface EdgarHit {
  _id?: string;
  _source?: {
    display_names?: string[];
    file_date?: string;
    form_type?: string;
    file_type?: string;
    root_forms?: string[];
    entity_name?: string;
    file_num?: string[];
    period_ending?: string;
  };
}

export const publicFilings: SkillDefinition = {
  id: "public-filings",
  name: "Company filings (SEC EDGAR)",
  short: "Filings",
  description:
    "Full-text searches the U.S. Securities and Exchange Commission's EDGAR archive — every filing a listed company has made, with form type, filing date and a direct link to the document. Free, keyless and authoritative: this is the regulator's own index, not a scraped copy.",
  category: "knowledge",
  runtime: "live",
  accepts: ["text", "domain"],
  produces: ["filings", "documents"],
  keywords: [
    "sec filing",
    "sec filings",
    "edgar",
    "annual report",
    "10-k",
    "10-q",
    "8-k",
    "proxy statement",
    "filings",
    "company filing",
    "investor relations filing",
    "public filing",
    "regulatory filing",
    "stock filing",
  ],
  clientFallback: false,
  async run(target, ctx) {
    const skill = "public-filings";
    const query = (target.meta?.query ?? target.value)
      .replace(/^https?:\/\//i, "")
      .replace(/\b(?:sec|edgar|filings?|filing|of|for|the|company|annual|report)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s.&'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    if (!query) {
      return {
        status: "partial" as const,
        summary:
          "Name a company to search — e.g. “Apple 10-K filings” or “Tesla annual report”. Full-text search needs a company name or a phrase from the document.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }

    ctx.log(`Full-text searching EDGAR for “${query}”`);
    const src = source("sec-edgar", "SEC EDGAR full-text search", "https://efts.sec.gov", "api");
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&forms=10-K,10-Q,8-K,20-F,6-K,DEF 14A`;

    // EDGAR asks for a descriptive UA and throttles bursts; one polite call.
    const response = await request<{ hits?: { hits?: EdgarHit[]; total?: { value?: number } } }>(
      url,
      ctx,
      {
        timeoutMs: 15_000,
        retries: 0,
        headers: {
          "user-agent": "SkOiT OSINT console (open-source research; contact via repository)",
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return {
        status: "unreachable" as const,
        summary: `SEC EDGAR could not be reached (${response.error?.message ?? "no response"}). EDGAR throttles heavy or anonymous bursts.`,
        evidence: [
          evidence(skill, "SEC EDGAR", "unreachable", {
            detail: response.error?.message,
            source: src,
            kind: "warning",
          }),
        ],
        entities: [],
        sources: [src],
        error: response.error,
      };
    }

    const hits = (response.data?.hits?.hits ?? [])
      .slice()
      // EDGAR ranks by relevance; a person asking about a company wants the
      // most recent filings first, so the order is corrected here.
      .sort((a, b) =>
        String(b._source?.file_date ?? "").localeCompare(String(a._source?.file_date ?? "")),
      );
    if (hits.length === 0) {
      return {
        status: "ok" as const,
        summary: `EDGAR returned no filings matching “${query}”. Full-text search only covers 2001 onwards, and only documents filed by companies registered with the SEC — a private or non-U.S. company will not appear.`,
        evidence: [
          evidence(skill, "Search", "0 filings matched", { source: src, detail: `query: ${query}` }),
        ],
        entities: [],
        sources: [src],
      };
    }

    const evidenceItems = hits.slice(0, 12).map((hit) => {
      const s = hit._source ?? {};
      const accession = String(hit._id ?? "");
      const [adsh] = accession.split(":");
      const link = adsh
        ? `https://www.sec.gov/Archives/edgar/data/${adsh.replace(/-/g, "")}`
        : "https://www.sec.gov/edgar/search/";
      return evidence(
        skill,
        `${s.form_type ?? "Filing"} · ${s.entity_name ?? (s.display_names ?? [])[0] ?? query}`,
        s.file_date ?? "date not stated",
        {
          source: src,
          detail: `${(s.display_names ?? []).join("; ") || "filer unnamed"}${s.period_ending ? ` · period ending ${s.period_ending}` : ""} · ${link}`,
        },
      );
    });

    const filers = [
      ...new Set(
        hits
          .map((hit) => (hit._source?.display_names ?? [])[0] ?? hit._source?.entity_name)
          .filter(Boolean) as string[],
      ),
    ];

    return {
      status: "ok" as const,
      summary: `${hits.length} filing(s) matching “${query}”${response.data?.hits?.total?.value ? ` of ${response.data.hits.total.value} total` : ""}${filers.length ? `, led by ${filers.slice(0, 3).join(", ")}` : ""}. Newest: ${hits[0]?._source?.form_type ?? "filing"} on ${hits[0]?._source?.file_date ?? "unknown date"}.`,
      evidence: evidenceItems,
      entities: filers.slice(0, 6).map((name) =>
        entity(skill, "company", name, "SEC filer", attrs({ source: "SEC EDGAR" })),
      ),
      sources: [src],
    };
  },
};

/* -------------------------------------------------------- historic imagery -- */

/**
 * The archive's config file has no `releaseDate`: each entry is
 *   { itemTitle: "World Imagery (Wayback 2026-08-05)", itemURL: "<tile service>" }
 * so the edition date has to be read out of the title.
 */
interface WaybackRelease {
  releaseNum?: number;
  itemTitle?: string;
  itemURL?: string;
  layerIdentifier?: string;
}

/** Edition date from "World Imagery (Wayback 2026-08-05)" → "2026-08-05". */
function releaseDateOf(entry: WaybackRelease): string | undefined {
  const match = String(entry.itemTitle ?? "").match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

export const historicImagery: SkillDefinition = {
  id: "historic-imagery",
  name: "Historical satellite imagery",
  short: "Historic imagery",
  description:
    "Lists the dated editions of Esri's World Imagery basemap — the free archive of satellite and aerial imagery the map industry uses — so you can see what a place looked like in different years. Keyless: it hands back the exact dated tile service and a link that opens that year's imagery.",
  category: "retrieval",
  runtime: "live",
  accepts: ["coordinate", "text"],
  produces: ["imagery", "dates"],
  keywords: [
    "historic imagery",
    "historical imagery",
    "satellite imagery",
    "old satellite",
    "imagery over the years",
    "before and after",
    "how did it look",
    "wayback imagery",
    "aerial imagery",
    "google earth",
    "earth view",
    "zoom from space",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "historic-imagery";
    const coordinates =
      target.meta?.lat && target.meta?.lon
        ? { lat: Number(target.meta.lat), lon: Number(target.meta.lon) }
        : undefined;
    const place = (target.meta?.query ?? target.value).slice(0, 120);
    ctx.log("Checking the dated satellite imagery archive");

    const src = source(
      "esri-wayback",
      "Esri World Imagery Wayback",
      "https://livingatlas.arcgis.com/wayback/",
      "api",
    );
    const url =
      "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

    const response = await request<Record<string, WaybackRelease>>(url, ctx, {
      timeoutMs: 15_000,
      retries: 1,
    });

    if (!response.ok) {
      return {
        status: "unreachable" as const,
        summary: `The imagery archive index could not be reached (${response.error?.message ?? "no response"}).`,
        evidence: [
          evidence(skill, "Esri Wayback", "unreachable", {
            detail: response.error?.message,
            source: src,
            kind: "warning",
          }),
        ],
        entities: [],
        sources: [src],
        error: response.error,
      };
    }

    const releases = Object.entries(response.data ?? {})
      .map(([num, entry]) => ({
        num: Number(entry.releaseNum ?? num),
        date: releaseDateOf(entry) ?? "",
        title: String(entry.itemTitle ?? ""),
        tiles: String(entry.itemURL ?? ""),
      }))
      .filter((entry) => entry.date)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (releases.length === 0) {
      return {
        status: "partial" as const,
        summary: "The archive answered but listed no dated imagery editions.",
        evidence: [],
        entities: [],
        sources: [src],
      };
    }

    const newest = releases[0];
    const oldest = releases[releases.length - 1];
    // One representative edition per year: these archives publish several
    // editions a year, and a per-year list is what a person actually reads.
    const byYear = new Map<string, (typeof releases)[number]>();
    for (const release of releases) {
      const year = release.date.slice(0, 4);
      if (!byYear.has(year)) {
        byYear.set(year, release);
      }
    }
    const years = [...byYear.values()];

    const linkFor = (release: { date: string }) => {
      const stamp = release.date.replace(/-/g, "");
      const centre = coordinates
        ? `&center=${coordinates.lon.toFixed(5)},${coordinates.lat.toFixed(5)}&scale=12000`
        : "";
      return `https://livingatlas.arcgis.com/wayback/#active=${stamp}${centre}`;
    };

    const evidenceItems = years.slice(0, 10).map((entry) =>
      evidence(skill, `Imagery edition ${entry.date.slice(0, 4)}`, entry.date, {
        source: src,
        detail: `${entry.title || "World Imagery"} · tile service: ${entry.tiles || "n/a"}`,
      }),
    );

    evidenceItems.push(
      evidence(skill, "Latest edition", `${newest.date} (release ${newest.num})`, {
        source: src,
        detail: `Newest imagery edition on record · ${linkFor(newest)}`,
      }),
    );

    return {
      status: "ok" as const,
      summary: `${releases.length} dated imagery editions are archived${place ? ` — for ${place}` : ""}, from ${oldest.date} to ${newest.date}${coordinates ? ` · centred on ${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}` : ""}. Pick a year to open that edition in the imagery viewer.`,
      evidence: evidenceItems,
      entities: coordinates
        ? [
            entity(
              skill,
              "place",
              `${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}`,
              "Imagery centre",
              attrs({ editions: releases.length, oldest: oldest.date, newest: newest.date }),
            ),
          ]
        : [],
      sources: [src],
    };
  },
};

export const osintSkills: SkillDefinition[] = [
  techStack,
  flightTracking,
  publicFilings,
  historicImagery,
];

/* ------------------------------------------------------------ dork builder -- */

/**
 * Search engine operators, grouped by what an investigator is actually trying
 * to find. These are plain public query syntaxes — free, keyless, and the same
 * thing a person types into a search box. SkOiT only *builds* the queries and
 * hands them to the open-web search it already has; it does not scrape a search
 * engine's results for these, which would breach their terms.
 */
const DORK_CATALOGUE: Array<{
  id: string;
  label: string;
  why: string;
  query: (target: string) => string;
}> = [
  {
    id: "indexof",
    label: "Open directory listings",
    why: "Misconfigured servers sometimes list every file in a folder. This finds those pages when they exist.",
    query: (t) => `site:${t} intitle:"index of"`,
  },
  {
    id: "exposed-docs",
    label: "Exposed documents",
    why: "PDFs, spreadsheets and slide decks that were published but never linked from the site.",
    query: (t) => `site:${t} (ext:pdf OR ext:doc OR ext:xls OR ext:ppt OR ext:csv)`,
  },
  {
    id: "config-files",
    label: "Config and backup files",
    why: "Old config or backup files left on a web root can expose settings, hosts or credentials.",
    query: (t) => `site:${t} (ext:env OR ext:yml OR ext:yaml OR ext:ini OR ext:conf OR ext:bak OR ext:sql)`,
  },
  {
    id: "logins",
    label: "Login portals",
    why: "Maps the sign-in surfaces of a domain — useful before an assessment, and to spot forgotten portals.",
    query: (t) => `site:${t} (inurl:login OR inurl:signin OR inurl:admin OR inurl:dashboard OR intitle:"sign in")`,
  },
  {
    id: "subdomains",
    label: "Subdomain hints",
    why: "Surfaces subdomains that are indexed but not linked from the main page.",
    query: (t) => `site:*.${t} -site:www.${t}`,
  },
  {
    id: "directory-list",
    label: "Upload and admin paths",
    why: "Commonly forgotten paths: uploads, temporary and admin folders.",
    query: (t) => `site:${t} (inurl:upload OR inurl:tmp OR inurl:files OR inurl:private OR inurl:backup)`,
  },
  {
    id: "emails",
    label: "Addresses published on the site",
    why: "Any address a company has chosen to publish, found in one query.",
    query: (t) => `site:${t} ("@${t}" OR "email" OR "contact us")`,
  },
  {
    id: "government",
    label: "Official notices",
    why: "Tenders, notices and circulars that live in a government subdomain of the domain.",
    query: (t) => `site:${t} (tender OR notice OR circular OR notification OR gazette) filetype:pdf`,
  },
  {
    id: "exposed-cameras",
    label: "Publicly exposed cameras",
    why: "Some live camera pages are indexed by mistake. Presence here means it is public — check the law before looking.",
    query: (t) => `site:${t} (inurl:viewer OR inurl:camera OR inurl:webcam OR intitle:"live view")`,
  },
  {
    id: "job-roles",
    label: "Staffing and tech hints",
    why: "Careers pages leak internal tooling: what a company runs is often in its own job ads.",
    query: (t) => `site:${t} (careers OR jobs) (engineer OR developer OR analyst OR intern)`,
  },
];

export const dorkBuilder: SkillDefinition = {
  id: "dork-builder",
  name: "Advanced search query builder",
  short: "Search queries",
  description:
    "Builds the advanced search operators (“dorks”) that investigators use to surface exposed documents, open directory listings, admin paths, published addresses and official notices on a domain — each with a plain-English reason, plus a one-tap run through the console's own open-web search. Free and keyless.",
  category: "tradecraft",
  runtime: "live",
  accepts: ["domain", "url", "text"],
  produces: ["queries", "dorks"],
  keywords: [
    "dork",
    "dorks",
    "google dork",
    "google dorks",
    "advanced search operators",
    "search operators",
    "exposed files",
    "index of",
    "find exposed documents",
    "leaked files on site",
    "shodan query",
    "advanced query",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "dork-builder";
    const host = (target.meta?.query ?? target.value)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host)) {
      return {
        status: "partial" as const,
        summary:
          "Give me a domain to build queries for — e.g. “dorks for example.com”. The operators need a real host to aim at.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }

    ctx.log(`Building search operators for ${host}`);

    const src = source(
      "dork-builder",
      "Search operator reference",
      "https://osintframework.com/",
      "document",
    );

    const queries = DORK_CATALOGUE.map((entry) => ({
      ...entry,
      q: entry.query(host),
    }));

    const evidenceItems = queries.map((entry) =>
      evidence(skill, entry.label, entry.q, {
        source: src,
        detail: entry.why,
      }),
    );

    return {
      status: "ok" as const,
      summary: `${queries.length} ready-made queries for ${host} — exposed documents, open directory listings, config and backup files, admin and upload paths, subdomain hints, published addresses, official notices and camera pages. Each one carries the reason it exists; run any of them through the console's open-web search.`,
      evidence: evidenceItems,
      entities: [
        entity(skill, "domain", host, "Query target", attrs({ queries: queries.length })),
      ],
      sources: [src],
    };
  },
};

export const osintSkillsExtra: SkillDefinition[] = [dorkBuilder];

// One exported list the registry consumes, declared after every member exists.
export const allOsintSkills: SkillDefinition[] = [...osintSkills, ...osintSkillsExtra];
