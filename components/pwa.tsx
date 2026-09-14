"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Two small app-feel pieces: silent service-worker registration, and the
 * first-open install banner ("Add to home screen") using the browser's own
 * beforeinstallprompt where available — with honest manual instructions where
 * the platform does not fire it (iOS Safari).
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaProvider() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline shell is a bonus, never a requirement */
      });
    }
  }, []);
  return null;
}

const DISMISS_KEY = "skoit-install-dismissed";
const INSTALLED_KEY = "skoit-install-thanks";

export function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode: just show it once per visit */
    }
    if (dismissed || window.localStorage.getItem(INSTALLED_KEY) === "1") {
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        /* ignore */
      }
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // If the platform fired beforeinstallprompt, show the banner shortly
    // after first paint. On platforms that never fire it (iOS), offer the
    // manual instructions once, on the second visit only.
    const timer = window.setTimeout(() => {
      if (promptEvent || (!dismissed && !sessionStorage.getItem("skoit-visited"))) {
        try {
          sessionStorage.setItem("skoit-visited", "1");
        } catch {
          /* ignore */
        }
        setVisible(true);
      } else if (!promptEvent) {
        try {
          if (sessionStorage.getItem("skoit-visited")) {
            setVisible(true);
            setShowManual(true);
          }
        } catch {
          /* ignore */
        }
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [promptEvent]);

  if (!visible) {
    return null;
  }

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        try {
          window.localStorage.setItem(INSTALLED_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      setVisible(false);
    } else {
      setShowManual(true);
    }
  };

  const isIos =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  return (
    <div className="animate-rise fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-primary/35 bg-surface p-3 shadow-pop sm:inset-x-auto sm:right-4">
      <div className="flex items-start gap-3">
        {/* biome-ignore lint/performance/noImgElement: local icon asset */}
        <img src="/icon-192.png" alt="" className="size-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">
            Install SkOiT on your home screen
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {showManual && isIos
              ? "In Safari: tap Share, then “Add to Home Screen”. Works offline from there."
              : showManual
                ? "In your browser menu choose “Install app” / “Add to Home screen”."
                : "Full-screen app, opens instantly, and your last case still works with no signal."}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <Button variant="primary" size="sm" onClick={() => void install()}>
              <Download />
              Install
            </Button>
            <Button variant="ghost" size="sm" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <Button variant="ghost" size="iconSm" aria-label="Dismiss" onClick={dismiss}>
          <X />
        </Button>
      </div>
    </div>
  );
}
