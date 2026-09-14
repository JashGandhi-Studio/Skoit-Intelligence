import { detectCountryStatement, editionByCode } from "@/lib/news-editions";
import { scoreTrack, normalizeForMatch, decryptMediaUrlSync } from "@/lib/client/saavn";
import { parseItems, splitTitle } from "@/lib/client/google-news";
import { parseDdgHtml as parseDdgHtmlTest } from "@/lib/client/ddg-parse";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

// --- country detection ---
check("india statement", detectCountryStatement("I am from India")?.code === "in");
check("japan statement", detectCountryStatement("news from Japan")?.code === "jp");
check("uae alias", detectCountryStatement("set my country to UAE")?.code === "ae");
check("usa alias", detectCountryStatement("latest news for the US")?.code === "us");
check("no false positive", detectCountryStatement("explain the theory of relativity") === undefined);
check("edition lookup", editionByCode("gb")?.label === "United Kingdom");

// --- saavn precision ---
const track = { id: "1", title: "Kesariya", artist: "Arijit Singh", album: "Brahmastra", durationSec: 268, via: "test" };
const wrong = { id: "2", title: "Kesariya Balam" , artist: "folk", durationSec: 300, via: "test" };
check("exact title scores 100", scoreTrack("Kesariya", track) === 100);
check("artist boosts", scoreTrack("Kesariya Arijit", track) >= 95);
check("wrong song kept out when exact exists", scoreTrack("Kesariya", wrong) < 60);
check("normalize strips noise", normalizeForMatch("Kesariya (From \"Brahmastra\")") === "kesariya");

// --- DES decrypt ---
const key = "38346591";
const CryptoJS = (await import("crypto-js")).default;
const enc = CryptoJS.DES.encrypt("https://aac.saavncdn.com/744/test_96.mp4", CryptoJS.enc.Utf8.parse(key), { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
check("des decrypts", decryptMediaUrlSync(enc) === "https://aac.saavncdn.com/744/test_96.mp4");
check("des garbage safe", decryptMediaUrlSync("not-base64-!!") === undefined);

// --- google news RSS parsing ---
const sampleXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Top stories</title><item>
<title>Big cyclone heads for Mumbai - Times of India</title>
<link>https://news.google.com/rss/articles/CBMi</link>
<pubDate>Sun, 14 Sep 2026 09:12:00 GMT</pubDate>
<source url="https://timesofindia.indiatimes.com">Times of India</source>
<description>&lt;a href="https://timesofindia.indiatimes.com/city/mumbai/cyclone/story.html"&gt;Big cyclone heads for Mumbai&lt;/a&gt;&amp;nbsp;&amp;nbsp;&amp;nbsp;&lt;a href="https://timesofindia.indiatimes.com"&gt;TOI&lt;/a&gt;</description>
<media:content url="https://img.example.com/cyclone.jpg" medium="image"/>
</item><item>
<title>Markets rally on rate cut hopes - Reuters</title>
<link>https://news.google.com/rss/articles/CBMj</link>
<pubDate>Sun, 14 Sep 2026 10:40:00 GMT</pubDate>
<source url="https://reuters.com">Reuters</source>
<description>&lt;a href="https://reuters.com/markets/rally.html"&gt;Markets rally&lt;/a&gt;</description>
</item></channel></rss>`;
const items = parseItems(sampleXml);
check("rss items parsed", items.length === 2);
check("publisher link extracted", items[0].articleUrl === "https://timesofindia.indiatimes.com/city/mumbai/cyclone/story.html");
check("source name parsed", items[0].sourceName === "Times of India");
check("media parsed", items[0].imageUrl === "https://img.example.com/cyclone.jpg");
check("title split", splitTitle("Big cyclone heads for Mumbai - Times of India", "Times of India").headline === "Big cyclone heads for Mumbai");
check("date parsed", items[0].pubDate !== undefined && items[0].pubDate! < Date.now());

// --- DDG html parsing (via shared helper export) ---
const ddgHtml = `<div class="result results_links"><div class="links_main"><div class="result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcisce.org%2Fspecimen.pdf&amp;rut=abc">ICSE Class 10 Physics Specimen Paper</a></h2>
<a class="result__snippet" href="#">The official specimen paper for ICSE Class 10 Physics 2026 examination.</a>
</div></div></div><h2 class="result__title"><a class="result__a" href="https://example.org/paper2">Second paper</a></h2>`;
const ddg = parseDdgHtmlTest(ddgHtml) as Array<{ title: string; url: string; snippet: string; host: string }>;
check("ddg unwrap + parse", ddg.length === 2 && ddg[0].url === "https://cisce.org/specimen.pdf");
check("ddg snippet", ddg[0].snippet.includes("official specimen paper"));

// --- qr matrix ---
const QR = (await import("qrcode")).default;
const qr = QR.create("https://example.com", { errorCorrectionLevel: "M" });
check("qr modules exist", qr.modules.size >= 21 && qr.modules.data.length === qr.modules.size ** 2);

import { buildStyledPdf, type BuiltPdf } from "@/lib/client/pdf-make";
async function textToPdfRoundtrip(text: string): Promise<BuiltPdf> {
  return buildStyledPdf({ title: text, sections: [{ paragraphs: ["Hello from the workshop engine."] }] });
}

// ---- PDF workshop engine ----
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  mergePdfs,
  numberPdf,
  removePages,
  rotatePdf,
  splitPdf,
  watermarkPdf,
} from "@/lib/client/pdf-tools";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([300, 300]);
    page.drawText(`page ${index + 1}`, { x: 40, y: 150, size: 18, font });
  }
  return doc.save();
}

{
  const five = await makePdf(5);

  const extracted = await splitPdf({ name: "book.pdf", bytes: five }, "2-3");
  check("split range", extracted.length === 1 && (await PDFDocument.load(extracted[0].bytes)).getPageCount() === 2);

  const burst = await splitPdf({ name: "book.pdf", bytes: five }, "all");
  check("split all", burst.length === 5);

  const rotated = await rotatePdf({ name: "book.pdf", bytes: five }, "1", 90);
  const rotatedDoc = await PDFDocument.load(rotated);
  check("rotate page 1", rotatedDoc.getPage(0).getRotation().angle === 90 && rotatedDoc.getPage(1).getRotation().angle === 0);

  const trimmed = await removePages({ name: "book.pdf", bytes: five }, "1,5");
  check("remove pages", (await PDFDocument.load(trimmed)).getPageCount() === 3);

  const stamped = await watermarkPdf({ name: "book.pdf", bytes: five }, "CONFIDENTIAL");
  check("watermark survives", (await PDFDocument.load(stamped)).getPageCount() === 5);

  const numbered = await numberPdf({ name: "book.pdf", bytes: five });
  check("numbering survives", (await PDFDocument.load(numbered)).getPageCount() === 5);

  const two = await makePdf(2);
  const three = await makePdf(3);
  const merged = await mergePdfs([
    { name: "a.pdf", bytes: two },
    { name: "b.pdf", bytes: three },
  ]);
  check("merge 2+3", (await PDFDocument.load(merged)).getPageCount() === 5);

  try {
    await splitPdf({ name: "book.pdf", bytes: five }, "9-12");
    check("bad range rejected", false);
  } catch (error) {
    check("bad range rejected", error instanceof Error && error.message.includes("outside this document"));
  }

  const tiny = await makePdf(3);
  const text = await textToPdfRoundtrip("SkOiT text → PDF engine");
  check("jsPDF builds a document", text.pages >= 1);
}
// ---- planner wiring (the "AI" routing) ----
import { buildPlan } from "@/lib/agent/plan";
import { DEFAULT_ANSWER_PREFERENCES, type AnswerPreferences } from "@/lib/types";

function planOf(message: string, preferences?: Partial<AnswerPreferences>) {
  return buildPlan({
    message,
    preferences: { ...DEFAULT_ANSWER_PREFERENCES, ...preferences },
  });
}

{
  const greet = planOf("hello");
  check("greeting is conversation", greet.smallTalk === "greet" && greet.steps.length === 0);

  const newsNoCountry = planOf("show the latest news");
  check("news asks the country first", newsNoCountry.countryAsk === true && newsNoCountry.steps.length === 0);

  const newsWithCountry = planOf("show the latest news", { country: "in" });
  check(
    "stored country plans google news",
    newsWithCountry.steps.some((step) => step.skillId === "news-google") &&
      newsWithCountry.steps.every((step) => step.skillId !== "news-search") &&
      newsWithCountry.steps.find((step) => step.skillId === "news-google")?.meta?.country === "in",
  );

  const newsSwitch = planOf("news from Japan");
  const japanStep = newsSwitch.steps.find((step) => step.skillId === "news-google");
  check("news from <country> scopes the edition", japanStep?.meta?.country === "jp");

  const song = planOf("play the song Kesariya by Arijit Singh");
  check(
    "song ask runs jiosaavn first",
    song.steps[0]?.skillId === "music-saavn" &&
      song.steps.some((step) => step.skillId === "audio-search"),
  );

  const video = planOf("videos of Chandrayaan 3 landing");
  check(
    "video ask runs youtube + footage",
    video.steps.some((step) => step.skillId === "video-youtube") &&
      video.steps.some((step) => step.skillId === "video-search"),
  );

  const paper = planOf("icse class 10 physics specimen paper");
  check(
    "paper ask routes to open-web in papers mode",
    paper.steps[0]?.skillId === "open-web" && paper.steps[0]?.meta?.webTask === "papers",
  );

  const study = planOf("study material for class 10 science chapter electricity");
  check("study ask routes to study mode", study.steps[0]?.meta?.webTask === "study");

  const sites = planOf("good free websites for AI image prompts");
  check("sites ask routes to sites mode", sites.steps[0]?.meta?.webTask === "sites");

  const price = planOf("https://www.amazon.in/dp/B0CHX1W1XY find the lowest price");
  check(
    "price ask with a link routes to offers",
    price.steps[0]?.skillId === "open-web" && price.steps[0]?.meta?.webTask === "offers",
  );

  const summarise = planOf("summarise this article: https://en.wikipedia.org/wiki/Chandrayaan-3");
  check("summarise runs the reader on the link", summarise.steps[0]?.skillId === "article-reader");

  const image = planOf("find photos of Charminar at dusk");
  check("image ask unchanged", image.steps[0]?.skillId === "image-search");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
