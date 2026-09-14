import { NextResponse } from "next/server";
import { dataDir, runtimeEnv } from "@/lib/server/config";
import { KEYED_SOURCES, providerReport } from "@/lib/server/provider";
import { describeSkillCoverage, manifest } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkEgress(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const [egress, providers] = await Promise.all([checkEgress(), providerReport()]);
  const keyed = await Promise.all(
    KEYED_SOURCES.map(async (key) => ({
      key,
      configured: Boolean(await runtimeEnv(key)),
    })),
  );
  const coverage = describeSkillCoverage();

  return NextResponse.json({
    runtime: `node ${process.version}`,
    dataDir,
    egress,
    checkedAt: Date.now(),
    skills: { total: coverage.live + coverage.local, ...coverage },
    providers,
    keyedSources: keyed,
    manifest: manifest(),
    notes: [
      "Local skills run entirely inside this process or the browser and never touch the network.",
      "Live skills call documented public endpoints, each under its own timeout, and report failure honestly.",
      "Keyed sources are listed even when unconfigured; they report themselves as unavailable instead of returning invented data.",
      "Image, video and news search runs against keyless libraries by default (Wikimedia Commons, Openverse, NASA, Internet Archive, GDELT, Hacker News, Wikipedia) and adds Pexels, Pixabay and Unsplash when keyed.",
      "Media results keep the licence the source states, link straight to the original file, and are never rehosted by this console.",
    ],
  });
}
