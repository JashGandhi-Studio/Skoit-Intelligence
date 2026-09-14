import type { NextRequest } from "next/server";

/**
 * GET /api/download?url=…&filename=…
 *
 * The console never rehosts anything, but plenty of publishers refuse
 * cross-origin reads, so a plain `fetch()` from the browser cannot save their
 * files. This route is the honest escape hatch: it streams the file straight
 * from its publisher with a Content-Disposition attachment header, so the
 * analyst's own browser saves it. Nothing is stored, nothing is modified, and
 * the source URL travels with the request.
 *
 * Guardrails: public http(s) URLs only (loopback/private ranges refused), a
 * size ceiling, and an external-host allow-by-behaviour that simply streams
 * bytes without executing anything.
 */

const MAX_STREAM_BYTES = 250 * 1024 * 1024; // generous: licence-free video clips

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  // Literal IPs in private / link-local ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

function safeFilename(raw: string | null, url: URL): string {
  const fromParam = raw?.trim();
  const base = (fromParam && fromParam.length > 0 ? fromParam : "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  if (base) {
    return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.bin`;
  }
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return /^[^/\\]+$/.test(last) && last.length > 0 ? last.slice(0, 120) : "skoit-file";
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const rawUrl = params.get("url");
  if (!rawUrl) {
    return Response.json({ error: "A url parameter is required." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return Response.json(
      { error: "The url parameter is not a valid URL." },
      { status: 400 },
    );
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol) || !isPublicHost(target.hostname)) {
    return Response.json(
      { error: "Only public http(s) URLs can be streamed." },
      { status: 403 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "*/*",
        referer: `${target.protocol}//${target.hostname}/`,
      },
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `The source answered ${upstream.status}.` },
        { status: 502 },
      );
    }

    const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_STREAM_BYTES) {
      return Response.json(
        { error: "The file is too large to stream." },
        { status: 413 },
      );
    }

    const filename = safeFilename(params.get("filename"), target);
    const mime =
      upstream.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";

    return new Response(upstream.body, {
      headers: {
        "content-type": mime,
        "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(declaredLength > 0 ? { "content-length": String(declaredLength) } : {}),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.name === "AbortError"
            ? "The source took too long to answer."
            : "The file could not be reached from the server.",
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
