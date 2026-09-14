"use client";

import {
  BadgeCheck,
  Calculator,
  FileStack,
  Forward,
  Globe2,
  Image as ImageIcon,
  Languages,
  Music2,
  Newspaper,
  QrCode,
  Receipt,
  ScrollText,
  Search,
  Smartphone,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { copyText } from "@/lib/utils";

/**
 * The guided tour — what SkOiT can do and exactly how to ask for it. Written
 * as copy-paste prompts so every capability is one tap away from working.
 */

const SECTIONS: Array<{
  icon: typeof Music2;
  title: string;
  items: Array<{ say: string; note: string }>;
}> = [
  {
    icon: Music2,
    title: "Songs & music (JioSaavn)",
    items: [
      {
        say: "Play the song Kesariya",
        note: "Full song from JioSaavn — plays right here, download button included. Ask for that exact song: you get that song, not a pile of lookalikes.",
      },
      {
        say: "Tum Hi Ho by Arijit Singh",
        note: "Name the song, add the artist if the title is common.",
      },
    ],
  },
  {
    icon: Video,
    title: "Videos (YouTube, in-app)",
    items: [
      {
        say: "Videos of Chandrayaan 3 landing",
        note: "Plays inside the console through YouTube's official player.",
      },
      {
        say: "Licence-free b-roll of Mumbai local trains",
        note: "That routes to the licence-clear libraries instead — those come with real download rights.",
      },
    ],
  },
  {
    icon: Newspaper,
    title: "News — country, state, your city",
    items: [
      {
        say: "Latest news",
        note: "The first time, SkOiT asks which country you're in, remembers it, and from then on always shows your country's freshest headlines.",
      },
      {
        say: "Mumbai news",
        note: "City and state editions too — “Maharashtra news”, “New York news”. Every result is clearly labelled: Mumbai · Maharashtra · India.",
      },
      {
        say: "News from Japan",
        note: "Switches your country any time. Tap any headline to read it in the built-in reader — and save it as a clean PDF.",
      },
    ],
  },
  {
    icon: Languages,
    title: "Instant translation",
    items: [
      {
        say: "Translate to मराठी (after a news run)",
        note: "The translate strip converts headlines and summaries instantly — हिन्दी, मराठी, தமிழ், తెలుగు, বাংলা, ગુજરાતી, English — always labelled as machine translation.",
      },
    ],
  },
  {
    icon: Forward,
    title: "Before you forward (WhatsApp checker)",
    items: [
      {
        say: "Check this forward: <paste the whole message>",
        note: "SkOiT strips the “forwarded many times” noise, finds where the claim first appeared, counts independent outlets, consults fact-checkers — and shows one big screen: forward this, hold, or don't.",
      },
    ],
  },
  {
    icon: Receipt,
    title: "Receipt scanner",
    items: [
      {
        say: "Attach a photo of a shop bill + “check the GST”",
        note: "On-device OCR reads the bill; GSTIN checksum, amount and date come back as copyable cards. It says plainly what was pattern-checked — it never claims the department verified anything.",
      },
    ],
  },
  {
    icon: BadgeCheck,
    title: "Answers with copyable cards",
    items: [
      {
        say: "Verify 27AAPFU0939F1ZV",
        note: "GSTIN, UPI ids, IFSC, vehicle plates and PINs come back as one-tap copy cards above the briefing — not buried in the text.",
      },
      {
        say: "MH12AB1234 / SBIN0001234 / 400001",
        note: "Plates, IFSC and PINs work the same way — instant pattern checks with the state and bank spelled out.",
      },
    ],
  },
  {
    icon: Search,
    title: "Search jobs (papers, study, sites, prices)",
    items: [
      {
        say: "ICSE class 10 physics specimen paper",
        note: "The Papers shelf: board (ICSE/CBSE/state), year and subject on every row — direct PDF, open in-app or download.",
      },
      {
        say: "Study material for class 10 science chapter electricity",
        note: "Finds notes, explainers and revision material.",
      },
      {
        say: "Good free websites for AI image prompts",
        note: "Website discovery — fresh projects on Vercel/Netlify included.",
      },
      {
        say: "Paste an Amazon/Flipkart link + “find the lowest price”",
        note: "The price-hunt table: store by store, sorted cheapest first — every figure honestly labelled as coming from the search snippet, open the store to confirm.",
      },
    ],
  },
  {
    icon: ImageIcon,
    title: "Images & answers",
    items: [
      {
        say: "Find photos of Charminar at dusk",
        note: "Licence-carrying sources (Wikimedia, Openverse, NASA…), full-size view and direct downloads.",
      },
      {
        say: "Who is the chief minister of Maharashtra?",
        note: "Answered from the encyclopaedia with the source cited — plus greetings, small talk and follow-ups.",
      },
      {
        say: "Summarise this article: <link>",
        note: "Pulls the article out of the page and gives the key points.",
      },
    ],
  },
  {
    icon: Calculator,
    title: "Everyday tools",
    items: [
      {
        say: "EMI for 25 lakh at 8.5% for 20 years",
        note: "Loan EMI, total interest, total payable — instant, offline arithmetic. SIP projections and GST splits (inclusive or exclusive) work the same way.",
      },
      {
        say: "Convert 100 usd to inr",
        note: "Live ECB reference rates, no key. Also: “meaning of serendipity” and “holidays in india 2026”.",
      },
    ],
  },
  {
    icon: Globe2,
    title: "Map & Globe",
    items: [
      {
        say: "Where is the Taj Mahal",
        note: "The globe opens and flies straight there, then tells you what the place is — a real 3D globe you can spin and pinch-zoom from orbit to street level.",
      },
      {
        say: "Tap any spot on the map",
        note: "Every spot answers back: its name, its area, a short Wikipedia summary. One tap flips between globe and flat map; the locate button drops you where you stand.",
      },
    ],
  },
  {
    icon: FileStack,
    title: "Document Workshop (in the left panel)",
    items: [
      {
        say: "Text → PDF",
        note: "Paste an article or notes: real headings, bullets, page numbers, and every link organised in a Links appendix — not a raw copy-paste.",
      },
      {
        say: "Merge · Split · Rotate/Delete · Watermark · Page numbers · Images → PDF",
        note: "All of it runs inside your browser; files never leave your machine.",
      },
      {
        say: "N-up · Normalise A4 · Cover page · Details",
        note: "Handout grids (2 or 4 per sheet), even out odd page sizes, give a PDF a proper cover, edit its title/author details.",
      },
    ],
  },
  {
    icon: QrCode,
    title: "QR Studio (in the left panel)",
    items: [
      {
        say: "Any link, text, Wi-Fi password, UPI id or contact card",
        note: "Styled QR codes: shapes, colours, gradients, six presets. PNG for sharing, SVG for print.",
      },
    ],
  },
  {
    icon: ScrollText,
    title: "Case files",
    items: [
      {
        say: "Everything you run is saved into a case file",
        note: "Rename, pin, search, export as markdown or JSON — all local to your device.",
      },
    ],
  },
  {
    icon: Smartphone,
    title: "An app on your home screen",
    items: [
      {
        say: "Install it",
        note: "The banner appears on first open — after that SkOiT runs full-screen and keeps working on a bad train network: your last cases, papers, QR codes and briefings still open with no signal.",
      },
      {
        say: "Dictate and listen",
        note: "The mic answers in your language (हिन्दी, मराठी, தமிழ்…), and the speaker button on any briefing reads it aloud in the same language.",
      },
    ],
  },
];

export function Guide() {
  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-primary/25 bg-primary-soft/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground">
        <strong>Ask like you'd ask a person.</strong> SkOiT plans which sources to run for
        every request, shows what it could and could not verify, and opens everything —
        songs, videos, news, PDFs — right here in the console.
      </p>
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-foreground">
            <section.icon className="size-4 text-primary" />
            {section.title}
          </h3>
          <ul className="space-y-1.5">
            {section.items.map((item) => (
              <li
                key={item.say}
                className="rounded-xl border border-hairline bg-surface px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge tone="neutral" mono className="mt-0.5 shrink-0">
                    say
                  </Badge>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText(item.say).then((ok) =>
                        toast[ok ? "success" : "error"](
                          ok
                            ? "Prompt copied — paste it into the console"
                            : "Clipboard blocked",
                        ),
                      );
                    }}
                    className="min-w-0 flex-1 text-left text-[12.5px] leading-snug text-foreground hover:text-primary-strong"
                    title="Copy this prompt"
                  >
                    “{item.say}”
                  </button>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {item.note}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="border-t border-hairline pt-3 text-[10.5px] leading-relaxed text-faint-foreground">
        No accounts, no telemetry: cases, keys and preferences stay on this machine.
        Sources are free public ones. The briefing is always written from the collected
        evidence: with no key the built-in analyst writes it, and SkOiT's free AI (no
        signup, no key) can reword it with every fact locked — the original is one tap
        away. A personal model key in Settings upgrades the writing further.
      </p>
    </div>
  );
}
