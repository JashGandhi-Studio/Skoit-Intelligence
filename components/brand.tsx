import { cn } from "@/lib/utils";

/**
 * The SkOiT reticle: an aperture inside a sighting ring. Drawn from geometry so
 * every tick stays pixel-crisp at any size, and it inherits currentColor so the
 * mark works on both themes.
 */

const TICK_ANGLES = Array.from({ length: 12 }, (_, index) => index * 30);
const BLADE_ANGLES = [0, 120, 240];

export function SkoitMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      role="img"
      aria-label="SkOiT"
      fill="none"
    >
      <circle cx="16" cy="16" r="14.5" stroke="currentColor" strokeOpacity="0.28" />
      {TICK_ANGLES.map((degrees) => {
        const angle = (degrees * Math.PI) / 180;
        const long = degrees % 90 === 0;
        const inner = long ? 10.4 : 11.6;
        const outer = long ? 13.6 : 13.2;
        return (
          <line
            key={`tick-${degrees}`}
            x1={16 + Math.cos(angle) * inner}
            y1={16 + Math.sin(angle) * inner}
            x2={16 + Math.cos(angle) * outer}
            y2={16 + Math.sin(angle) * outer}
            stroke="currentColor"
            strokeOpacity={long ? 0.5 : 0.35}
            strokeWidth={long ? 1.1 : 0.9}
          />
        );
      })}
      {/* iris blades */}
      {BLADE_ANGLES.map((degrees) => {
        const angle = ((degrees - 90) * Math.PI) / 180;
        const cx = 16 + Math.cos(angle) * 3.1;
        const cy = 16 + Math.sin(angle) * 3.1;
        const start = ((degrees + 150) * Math.PI) / 180;
        const end = ((degrees + 390) * Math.PI) / 180;
        const radius = 6.4;
        const x1 = cx + Math.cos(start) * radius;
        const y1 = cy + Math.sin(start) * radius;
        const x2 = cx + Math.cos(end) * radius;
        const y2 = cy + Math.sin(end) * radius;
        return (
          <path
            key={`blade-${degrees}`}
            d={`M${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`}
            stroke="currentColor"
            strokeOpacity="0.85"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="16" cy="16" r="2.2" fill="currentColor" fillOpacity="0.95" />
      <circle cx="15.1" cy="15.1" r="0.8" fill="var(--surface)" fillOpacity="0.8" />
    </svg>
  );
}

export function SkoitWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <SkoitMark className="size-7 text-primary" />
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-[0.12em] text-foreground">
          Sk<span className="text-primary">O</span>iT
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
