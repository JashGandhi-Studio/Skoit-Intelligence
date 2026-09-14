"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Client-side safety net: if the console throws, the analyst still sees what
 * happened, and their case files (stored outside the React tree) are untouched.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-hairline bg-surface p-5 shadow-raise">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
          <span className="grid size-7 place-items-center rounded-full bg-danger/12 text-danger">
            !
          </span>
          The console stopped rendering
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Nothing was lost: case files live in this browser and on the local data
          directory, not inside the view that failed.
        </p>
        <pre className="mt-3 max-h-[180px] overflow-auto rounded-lg border border-hairline bg-surface-2 p-2.5 text-[11px] leading-relaxed text-foreground-muted thin-scroll">
          {error.message}
          {error.digest ? `\n(digest ${error.digest})` : ""}
        </pre>
        <div className="mt-4 flex gap-2">
          <Button onClick={reset} variant="primary" size="sm">
            <RotateCcw />
            Reload the console
          </Button>
        </div>
      </div>
    </div>
  );
}
