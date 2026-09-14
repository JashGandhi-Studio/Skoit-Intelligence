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

// ---- places: local news scoping ----
import {
  detectPlaceInText,
  labelOfPlace,
  stripPlaceFromTopic,
} from "@/lib/news-places";
{
  const mumbai = detectPlaceInText("Mumbai news today");
  check("mumbai detected", mumbai?.place.name === "mumbai" && mumbai.place.feed === "geo");
  check("mumbai label", mumbai?.label === "Mumbai · Maharashtra · India");

  const state = detectPlaceInText("news from Maharashtra");
  check("state uses search feed", state?.place.feed === "search");

  const nyc = detectPlaceInText("headlines for new york");
  check("new york", nyc?.place.name === "new york" && nyc.place.country === "us");
  check("nyc alias", detectPlaceInText("NYC headlines")?.place.name === "new york");

  check("no false positive", detectPlaceInText("explain total quality management") === undefined);
  check("strip place", stripPlaceFromTopic("mumbai news today").toLowerCase().includes("today"));
}

// ---- forward checker ----
import {
  claimQueryOf,
  cleanForwardText,
  type ForwardCandidate,
  verdictForForward,
} from "@/lib/verify-values";
{
  const raw = "Forwarded as received!! DEAR ALL - RBI is giving every citizen Rs 5 lakh under the new scheme. Please forward to all.";
  const cleaned = cleanForwardText(raw);
  check("forward noise stripped", !/forwarded as received/i.test(cleaned) && !/dear all/i.test(cleaned));
  const query = claimQueryOf(cleaned);
  check("claim query has content words", query.split(" ").length >= 3 && /rbi/i.test(query));

  const fake: ForwardCandidate[] = [
    { title: "PIB Fact Check: No such RBI scheme", url: "https://pib.gov.in/fc1", snippet: "The claim is false — RBI has announced no such deposit scheme.", host: "pib.gov.in" },
    { title: "AltNews debunks viral RBI message", url: "https://altnews.com/fc2", snippet: "The viral message is fake and misleading.", host: "altnews.com" },
    { title: "BOOM: RBI ₹5 lakh claim is fake", url: "https://boomlive.in/fc3", snippet: "This is a hoax circulating on WhatsApp.", host: "boomlive.in" },
  ];
  const verdict = verdictForForward(cleaned, fake);
  check("fake → dont", verdict.verdict === "dont");
  check("dont headline", /don.?t/i.test(verdict.headline));
  check("fact checks counted", verdict.factChecks.length === 3);

  const real: ForwardCandidate[] = [
    { title: "ISRO confirms Chandrayaan success", url: "https://isro.gov.in/a", snippet: "Confirmed: the lander achieved soft landing.", host: "isro.gov.in", publishedAt: Date.now() - 8e8 },
    { title: "Chandrayaan lands, reports Times of India", url: "https://timesofindia.indiatimes.com/b", snippet: "India lands on the moon.", host: "timesofindia.indiatimes.com" },
    { title: "The Hindu: soft landing achieved", url: "https://thehindu.com/c", snippet: "Historic soft landing.", host: "thehindu.com" },
    { title: "Indian Express coverage", url: "https://indianexpress.com/d", snippet: "Chandrayaan soft landing.", host: "indianexpress.com" },
  ];
  const realVerdict = verdictForForward("chandrayaan soft landing success", real);
  check("3+ domains → forward", realVerdict.verdict === "forward" && realVerdict.corroborations >= 3);
  check("first seen oldest", realVerdict.firstSeen !== undefined);

  const nothing = verdictForForward("some random chain about a miracle", [
    { title: "Miracle video", url: "https://youtube.com/x", snippet: "", host: "youtube.com" },
  ]);
  check("nothing → caution", nothing.verdict === "caution");
}

// ---- GSTIN checksum + receipt parsing ----
import { gstinCheckDigit, gstinLooksValid, priceFromSnippet, readReceiptText } from "@/lib/verify-values";
{
  const base = "27AAPFU0939F1Z";
  const digit = gstinCheckDigit(base);
  check("gstin digit produced", /^[0-9A-Z]$/.test(digit));
  check("gstin valid roundtrip", gstinLooksValid(`${base}${digit}`));
  check("gstin tampered rejected", !gstinLooksValid(`${base}${digit === "V" ? "W" : "V"}`));

  const bill = `SHREE ELECTRONICS
  123 Laxmi Road, Pune 411002
  GSTIN: 27AAPFU0939F1Z${gstinCheckDigit("27AAPFU0939F1Z")}
  Invoice No: INV/2026/007
  Date: 12/09/2026
  Item 1 x 2,499.00
  CGST 6% 149.94
  SGST 6% 149.94
  Grand Total: ₹2,798.88`;
  const finding = readReceiptText(bill);
  check("receipt gstin", finding.gstin?.checksumValid === true && finding.gstin.stateCode === "Maharashtra");
  check("receipt amount", finding.amount?.value === 2798.88);
  check("receipt date", finding.date?.iso === "2026-09-12");
  check("receipt invoice", finding.invoiceNo === "INV/2026/007");
  check("receipt vendor", /shree electronics/i.test(finding.vendorGuess ?? ""));

  const price = priceFromSnippet("Buy Foo Bar 5G online at ₹64,999. MRP ₹72,000. Free delivery.");
  check("snippet price picks selling figure", price?.value === 64999);
  check("snippet price none", priceFromSnippet("great phone with amazing camera") === undefined);
}

// ---- translator module shape (pure parts) ----
import { scriptOf } from "@/lib/client/translate";
{
  check("devanagari script", scriptOf("यह एक टेस्ट है") === "hi");
  check("latin script", scriptOf("this is a test") === "en");
}

// ---- everyday skills: calculators & parsers ----
import {
  emiFor,
  gstBreakup,
  parseCurrencyAsk,
  parseDefineAsk,
  parseHolidayYear,
  parseIndianAmount,
  parseRatePercent,
  parseTenureMonths,
  sipFutureValue,
} from "@/lib/skills/everyday";
{
  check("amount 25 lakh", parseIndianAmount("EMI for 25 lakh home loan") === 2_500_000);
  check("amount 1.5 crore", parseIndianAmount("1.5 crore at 9%") === 15_000_000);
  check("amount ₹4,999", parseIndianAmount("GST on ₹4,999") === 4_999);
  check("amount 25k", parseIndianAmount("25k car loan") === 25_000);
  check("rate 8.5%", parseRatePercent("at 8.5% for 20 years") === 8.5);
  check("tenure years", parseTenureMonths("for 20 years") === 240);
  check("tenure months", parseTenureMonths("18 months") === 18);

  const emi = emiFor(2_500_000, 8.5, 240);
  check("emi magnitude", emi > 21_600 && emi < 21_800);
  check("sip value", Math.abs(sipFutureValue(5_000, 12, 60) - 412_432) < 300);

  const ex = gstBreakup(4_999, 18, false);
  check("gst exclusive", Math.round(ex.gross) === 5_899 && Math.round(ex.tax) === 900);
  const inc = gstBreakup(4_999, 18, true);
  check("gst inclusive", Math.round(inc.net) === 4_236 && Math.round(inc.tax) === 763);

  check("currency ask", JSON.stringify(parseCurrencyAsk("convert 100 usd to inr")) === '{"amount":100,"from":"USD","to":"INR"}');
  check("currency bare", parseCurrencyAsk("usd to inr")?.amount === 1);
  check("define meaning of", parseDefineAsk("meaning of serendipity") === "serendipity");
  check("define what does", parseDefineAsk("what does gregarious mean") === "gregarious");
  check("holiday year default", parseHolidayYear("holidays in india") === new Date().getFullYear());
}

// ---- planner: everyday routing, no hijacking ----
import { everydaySkillFor } from "@/lib/agent/plan";
{
  check("route emi", everydaySkillFor("calculate emi for 25 lakh at 8.5% for 20 years") === "calc-emi");
  check("route sip", everydaySkillFor("sip of 5000 per month at 12% for 10 years") === "calc-sip");
  check("route gst", everydaySkillFor("gst on 4999 at 18%") === "calc-gst");
  check("no hijack gstin", everydaySkillFor("verify 27AAPFU0939F1ZV") === null);
  check("no hijack news", everydaySkillFor("show the latest news") === null);
  check("no hijack plain", everydaySkillFor("who is the chief minister of Maharashtra") === null);
  check("route currency", everydaySkillFor("convert 250 usd to inr") === "currency-convert");
  check("route define", everydaySkillFor("what does ephemeral mean") === "word-define");
  check("route holidays", everydaySkillFor("holidays in india 2026") === "holiday-list");
}

// ---- free AI guards ----
import { buildFreeAiUrl, isPlausiblePolish } from "@/lib/client/free-ai";
{
  const original =
    "Found 3 independent reports. The claim first appeared on 12 March 2026 on example.com. Fact-checkers flagged it: 2 false, 1 misleading. Verdict: don't forward.";
  const good = original.replace("Verdict: don't forward.", "The verdict is: don't forward this.");
  const bad = "I am sorry, I cannot help with that request.";
  const drifted = "Totally unrelated text about cricket scores.";
  check("free-ai url shape", buildFreeAiUrl("x y").startsWith("https://text.pollinations.ai/"));
  check("free-ai guard passes rewrite", isPlausiblePolish(original, good));
  check("free-ai guard blocks refusal", !isPlausiblePolish(original, bad));
  check("free-ai guard blocks drift", !isPlausiblePolish(original, drifted));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
