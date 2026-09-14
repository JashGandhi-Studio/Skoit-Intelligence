"use client";

import {
  BadgeCheck,
  Ban,
  CheckCheck,
  Copy,
  Landmark,
  Receipt,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { TurnView } from "@/lib/client/cases";
import type { Evidence } from "@/lib/types";
import { cn, copyText, truncate } from "@/lib/utils";
import { GSTIN_PATTERN } from "@/lib/verify-values";

/**
 * First-class answer surfaces: the numbers people actually copy — UPI ids,
 * GSTINs, IFSC codes, PIN codes, plates — as tappable cards above the
 * briefing, and the forward-check verdict as one honest, unmissable screen.
 */

interface QuickCard {
  key: string;
  label: string;
  value: string;
  detail?: string;
}

const UPI_HANDLES =
  /@(okaxis|oksbi|okhdfcbank|okicici|paytm|ybl|apl|ibl|axl|upi|bhim|fastag|fbl|ikwik|axisbank|payzapp|aubank|timecosmos|jio| slice|indus)\b/i;
const IFSC_PATTERN = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;
const PLATE_PATTERN = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})\b/g;

function cardsForTurn(turn: TurnView): QuickCard[] {
  const cards = new Map<string, QuickCard>();
  const add = (label: string, value: string, detail?: string) => {
    const key = `${label}:${value}`;
    if (!cards.has(key) && value.length <= 42) {
      cards.set(key, { key, label, value, detail });
    }
  };

  for (const item of turn.entities) {
    const label = item.label.toLowerCase();
    if (/gstin/.test(label)) {
      add("GSTIN", item.value, item.attributes.find((a) => a.key === "state")?.value);
    } else if (/ifsc/.test(label)) {
      add("IFSC", item.value);
    } else if (/upi|vpa/.test(label)) {
      add("UPI", item.value);
    } else if (/pin|pincode/.test(label) && /^\d{6}$/.test(item.value)) {
      add("PIN code", item.value);
    } else if (/plate|rto|vehicle/.test(label)) {
      add("Plate", item.value);
    }
  }

  const haystacks = [turn.answer ?? "", ...turn.evidence.map((item) => item.value)];
  for (const text of haystacks) {
    for (const match of text.matchAll(GSTIN_PATTERN)) {
      add("GSTIN", match[1].toUpperCase());
    }
    for (const match of text.matchAll(IFSC_PATTERN)) {
      add("IFSC", match[1]);
    }
    for (const match of text.matchAll(/([a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,})/g)) {
      if (UPI_HANDLES.test(match[1])) {
        add("UPI", match[1]);
      }
    }
    for (const match of text.matchAll(PLATE_PATTERN)) {
      add("Plate", match[1].replace(/\s+/g, " "));
    }
  }
  // PINs and plates are too noisy to regex out of prose — entities only.
  return [...cards.values()].slice(0, 8);
}

export function QuickCards({ turn }: { turn: TurnView }) {
  const cards = useMemo(() => cardsForTurn(turn), [turn]);
  if (cards.length === 0) {
    return null;
  }
  const icons: Record<string, typeof Wallet> = {
    UPI: Wallet,
    GSTIN: Receipt,
    IFSC: Landmark,
    "PIN code": Landmark,
    Plate: BadgeCheck,
  };
  return (
    <div className="animate-rise space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
        <BadgeCheck className="size-3.5 text-primary" />
        Tap to copy
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = icons[card.label] ?? BadgeCheck;
          return (
            <button
              key={card.key}
              type="button"
              onClick={async () => {
                const ok = await copyText(card.value);
                toast[ok ? "success" : "error"](
                  ok ? `${card.label} copied` : "Clipboard blocked",
                );
              }}
              className="group flex items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
            >
              <Icon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] font-medium text-foreground">
                  {card.value}
                </span>
                <span className="block text-[10.5px] text-faint-foreground">
                  {card.label}
                  {card.detail ? ` · ${truncate(card.detail, 30)}` : ""}
                </span>
              </span>
              <Copy className="size-3.5 shrink-0 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- forward verdict -- */

export function ForwardVerdictCard({ evidence }: { evidence: Evidence[] }) {
  const verdictItem = evidence.find(
    (item) => item.skillId === "forward-check" && item.label === "Verdict",
  );
  if (!verdictItem) {
    return null;
  }
  const value = verdictItem.value.toUpperCase();
  const verdict =
    value.includes("DON'T") || value.includes("DONT")
      ? "dont"
      : value.includes("HOLD")
        ? "caution"
        : "forward";

  const reasons = evidence
    .filter((item) => item.skillId === "forward-check" && item.label.startsWith("Why "))
    .map((item) => item.value);
  const factChecks = evidence.filter(
    (item) => item.skillId === "forward-check" && item.label.startsWith("Fact-check"),
  );

  const theme = {
    forward: {
      bar: "border-success/45 bg-success/10",
      text: "text-success",
      icon: CheckCheck,
      title: "Forward this",
      sub: "It traces to real reporting — sources below",
    },
    caution: {
      bar: "border-warning/50 bg-warning/10",
      text: "text-warning",
      icon: ShieldAlert,
      title: "Hold on",
      sub: "Could not be verified — don't be the first believer",
    },
    dont: {
      bar: "border-danger/50 bg-danger/10",
      text: "text-danger",
      icon: Ban,
      title: "Don't forward",
      sub: "Fact-checkers flag this as false or misleading",
    },
  }[verdict];
  const Icon = theme.icon;

  return (
    <div className={cn("animate-rise overflow-hidden rounded-2xl border", theme.bar)}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl border bg-background",
            theme.text,
            theme.bar,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[16px] font-semibold tracking-tight", theme.text)}>
            {theme.title}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{theme.sub}</p>
          <ul className="mt-2 space-y-1">
            {reasons.map((reason) => (
              <li key={reason} className="text-[12px] leading-relaxed text-foreground">
                · {reason}
              </li>
            ))}
          </ul>
          {factChecks.length > 0 ? (
            <p className="mt-2.5 text-[11px] text-faint-foreground">
              {factChecks.length} fact-check source{factChecks.length === 1 ? "" : "s"} in
              the list below — open them before believing either way.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
