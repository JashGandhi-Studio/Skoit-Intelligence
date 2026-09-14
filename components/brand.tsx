import { cn } from "@/lib/utils";

const TICK_ANGLES = Array.from({ length: 12 }, (_, index) => index * 30);

export function IndusMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      role="img"
      aria-label="INDUS"
      fill="none"
    >
      <circle cx="16" cy="16" r="14.5" stroke="currentColor" strokeOpacity="0.28" />
      {TICK_ANGLES.map((degrees) => {
        const angle = (degrees * Math.PI) / 180;
        const x1 = 16 + Math.cos(angle) * 11.5;
        const y1 = 16 + Math.sin(angle) * 11.5;
        const x2 = 16 + Math.cos(angle) * 13.5;
        const y2 = 16 + Math.sin(angle) * 13.5;
        return (
          <line
            key={`tick-${degrees}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1"
          />
        );
      })}
      <path
        d="M16 7.5c2.6 3 4 6 4 8.5s-1.4 5.5-4 8.5c-2.6-3-4-6-4-8.5s1.4-5.5 4-8.5Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <circle cx="16" cy="16" r="2.4" fill="var(--surface)" />
    </svg>
  );
}

export function IndusWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <IndusMark className="size-7 text-primary" />
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-[0.14em] text-foreground">
          INDUS
        </div>
        {compact ? null : (
          <div className="mt-1 text-[10.5px] font-medium tracking-[0.12em] text-faint-foreground uppercase">
            open-source intelligence
          </div>
        )}
      </div>
    </div>
  );
}
