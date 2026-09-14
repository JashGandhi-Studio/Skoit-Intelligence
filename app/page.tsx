import { Suspense } from "react";
import { Console } from "@/components/console";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="grid h-dvh place-items-center bg-background text-[13px] text-faint-foreground">
          Loading console…
        </div>
      }
    >
      <Console />
    </Suspense>
  );
}
