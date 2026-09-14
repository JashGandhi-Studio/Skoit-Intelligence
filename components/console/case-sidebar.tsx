"use client";

import {
  BookOpen,
  FileJson,
  FileStack,
  FileText,
  Plus,
  QrCode,
  Search,
  Settings,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SkoitWordmark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ScrollArea, Tip } from "@/components/ui/misc";
import { caseToMarkdown, exportCase } from "@/lib/client/cases";
import type { CaseFile } from "@/lib/types";
import { cn, download, formatRelative, slugify } from "@/lib/utils";

export function CaseSidebar({
  cases,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onTogglePin,
  onImport,
  onOpenSettings,
  onOpenWorkshop,
  onOpenQr,
  onOpenGuide,
  onClose,
  egress,
  skillCount,
}: {
  cases: CaseFile[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (caseFile: CaseFile) => void;
  onImport: (caseFile: CaseFile) => void;
  onOpenSettings: () => void;
  onOpenWorkshop?: () => void;
  onOpenQr?: () => void;
  onOpenGuide?: () => void;
  onClose?: () => void;
  egress: boolean | null;
  skillCount: number;
}) {
  const [query, setQuery] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...cases].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    );
    if (!needle) {
      return sorted;
    }
    return sorted.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.turns.some((turn) => turn.question.toLowerCase().includes(needle)),
    );
  }, [cases, query]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-hairline bg-surface">
      <header className="flex items-center justify-between px-3.5 py-3.5">
        <SkoitWordmark />
        <div className="flex items-center gap-1">
          <Tip label="What SkOiT can do — the guided tour">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onOpenGuide}
              aria-label="Guide"
            >
              <BookOpen />
            </Button>
          </Tip>
          <Tip label="Console settings, keys and capabilities">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onOpenSettings}
              aria-label="Settings"
            >
              <Settings />
            </Button>
          </Tip>
          {onClose ? (
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onClose}
              className="lg:hidden"
              aria-label="Close"
            >
              <span className="text-[11px]">esc</span>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="space-y-1.5 px-3.5">
        <Button variant="primary" size="md" className="w-full" onClick={onCreate}>
          <Plus /> New case file
        </Button>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" className="w-full" onClick={onOpenWorkshop}>
            <FileStack className="text-primary" /> Documents
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={onOpenQr}>
            <QrCode className="text-primary" /> QR Studio
          </Button>
        </div>
      </div>

      <div className="relative px-3.5 pt-3">
        <Search className="pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2 text-faint-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search cases and prompts"
          className="h-9 pl-8 text-[13px]"
        />
      </div>

      <div className="mt-3 flex items-center justify-between px-4">
        <span className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
          {query
            ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
            : "Saved cases"}
        </span>
        <div className="flex items-center gap-1">
          <Tip label="Import a case file (.json)">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => importRef.current?.click()}
              aria-label="Import case"
            >
              <Upload />
            </Button>
          </Tip>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              try {
                const parsed = JSON.parse(await file.text()) as CaseFile;
                if (
                  !parsed ||
                  typeof parsed.title !== "string" ||
                  !Array.isArray(parsed.turns)
                ) {
                  throw new Error("Not a case file");
                }
                onImport(parsed);
                toast.success(`Imported “${parsed.title}”`);
              } catch {
                toast.error("That file is not a valid SkOiT case export");
              } finally {
                if (importRef.current) {
                  importRef.current.value = "";
                }
              }
            }}
          />
        </div>
      </div>

      <ScrollArea className="mt-1.5 min-h-0 flex-1">
        <ul className="space-y-0.5 px-2 pb-3">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-[12.5px] leading-relaxed text-faint-foreground">
              {cases.length === 0
                ? "No cases yet. A case file holds every prompt, finding and source for one investigation — it is saved on this machine and can be exported at any time."
                : "Nothing matches that search."}
            </li>
          ) : null}
          {filtered.map((caseFile) => {
            const isActive = caseFile.id === activeId;
            const flagged = caseFile.turns
              .flatMap((turn) => turn.evidence)
              .filter((item) => item.severity && item.severity !== "info").length;
            return (
              <li key={caseFile.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(caseFile.id)}
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-2 pr-14 text-left transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary-soft"
                      : "border-transparent hover:border-hairline hover:bg-surface-2",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {caseFile.pinned ? (
                      <Star className="size-3 fill-primary text-primary" />
                    ) : null}
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {caseFile.title}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] text-faint-foreground">
                      {caseFile.turns.length} run{caseFile.turns.length === 1 ? "" : "s"}{" "}
                      · {formatRelative(caseFile.updatedAt)}
                    </span>
                    {flagged > 0 ? (
                      <Badge tone="warning" mono>
                        {flagged} flagged
                      </Badge>
                    ) : null}
                  </span>
                </button>

                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Tip label={caseFile.pinned ? "Unpin" : "Pin to top"}>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => onTogglePin(caseFile)}
                      aria-label="Pin case"
                    >
                      <Star
                        className={cn(caseFile.pinned && "fill-primary text-primary")}
                      />
                    </Button>
                  </Tip>
                  <Tip label="Export as markdown report">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        download(
                          `${slugify(caseFile.title)}-report.md`,
                          caseToMarkdown(caseFile),
                          "text/markdown",
                        );
                        toast.success("Report exported");
                      }}
                      aria-label="Export report"
                    >
                      <FileText />
                    </Button>
                  </Tip>
                  <Tip label="Export case data (.json)">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => exportCase(caseFile)}
                      aria-label="Export case"
                    >
                      <FileJson />
                    </Button>
                  </Tip>
                  <Tip label="Delete this case">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        onDelete(caseFile.id);
                        toast.success("Case deleted");
                      }}
                      aria-label="Delete case"
                    >
                      <Trash2 />
                    </Button>
                  </Tip>
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <footer className="border-t border-hairline px-4 py-3">
        <div className="flex items-center justify-between text-[11px] text-faint-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                egress === null
                  ? "bg-hairline-strong"
                  : egress
                    ? "bg-success"
                    : "bg-warning",
              )}
            />
            {egress === null
              ? "checking egress"
              : egress
                ? "sources reachable"
                : "no egress here"}
          </span>
          <span className="tabular">{skillCount} skills</span>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint-foreground">
          Runs on public sources only, on your own machine. Cases stay local unless you
          export them.
        </p>
      </footer>
    </aside>
  );
}
