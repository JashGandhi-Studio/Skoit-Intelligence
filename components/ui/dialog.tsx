"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side = "center",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  side?: "center" | "left" | "right" | "bottom";
}) {
  const sideClasses = {
    center:
      "left-1/2 top-1/2 max-h-[88dvh] w-[min(560px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl",
    left: "left-0 top-0 h-full w-[min(320px,86vw)] rounded-r-2xl",
    right: "right-0 top-0 h-full w-[min(400px,92vw)] rounded-l-2xl",
    bottom: "bottom-0 left-0 w-full max-h-[88dvh] rounded-t-2xl",
  } as const;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-hairline bg-surface shadow-pop",
          sideClasses[side],
          side === "center" || side === "bottom" ? "animate-rise" : "animate-fade",
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3.5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-sm font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </header>
        <div className="thin-scroll min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain px-4 py-3.5">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
