"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[background,color,border,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 active:translate-y-[0.5px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.18)_inset] hover:bg-primary-strong",
        outline:
          "border border-hairline-strong bg-surface text-foreground hover:bg-surface-2 hover:border-hairline-strong",
        ghost: "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        subtle: "bg-surface-2 text-foreground hover:bg-surface-3",
        danger: "bg-danger text-white hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9.5 px-3.5 text-sm [&_svg]:size-4",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-4.5",
        icon: "size-9 [&_svg]:size-4",
        iconSm: "size-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
