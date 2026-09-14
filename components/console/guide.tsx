"use client";

import {
  FileStack,
  Globe2,
  Image as ImageIcon,
  Music2,
  QrCode,
  ScrollText,
  Search,
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
    icon: Globe2,
    title: "News — for your country",
    items: [
      {
        say: "Latest news",
        note: "The first time, SkOiT asks which country you're in, remembers it, and from then on always shows your country's freshest headlines.",
      },
      {
        say: "News from Japan",
        note: "Switches your country any time. Tap any headline to read it in the built-in reader — and save it as a clean PDF.",
      },
    ],
  },
  {
    icon: Search,
    title: "Search jobs (papers, study, sites, prices)",
    items: [
      {
        say: "ICSE class 10 physics specimen paper",
        note: "Finds the actual paper as a PDF — open it in-app or download it directly.",
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
        note: "Reads the product, then hunts the same product across other stores so you can compare prices.",
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
        Sources are free public ones; the optional AI briefing model is configured in
        Settings when you add a key — otherwise the built-in analyst writer answers from
        the collected evidence alone.
      </p>
    </div>
  );
}
