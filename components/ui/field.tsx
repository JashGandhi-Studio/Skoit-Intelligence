"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9.5 w-full rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-foreground",
          "placeholder:text-faint-foreground focus:border-primary/60 focus:outline-none",
          "disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-[10px] border border-hairline-strong bg-surface p-3 text-sm leading-relaxed text-foreground",
        "placeholder:text-faint-foreground focus:border-primary/60 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});
