"use client";

import { Cpu, KeyRound, Loader2, Server, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Skeleton, Tab, TabContent, TabList, Tabs } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

interface KeyRow {
  key: string;
  configured: boolean;
  origin: "environment" | "stored" | "none";
  masked?: string;
}

interface CapabilityResponse {
  runtime: string;
  dataDir: string;
  egress: boolean;
  skills: { total: number; live: number; local: number; keyed: number };
  providers: Array<{
    id: string;
    label: string;
    configured: boolean;
    envVar: string;
    model: string;
  }>;
  keyedSources: Array<{ key: string; configured: boolean }>;
  manifest: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    runtime: string;
    requiresKey?: string[];
  }>;
  notes: string[];
}

const KEY_LABELS: Record<string, string> = {
  SARVAM_API_KEY: "Sarvam AI — powers Indus/Sarvam-M briefings",
  OPENAI_API_KEY: "OpenAI — model-written briefings",
  ANTHROPIC_API_KEY: "Anthropic — model-written briefings",
  GOOGLE_GENERATIVE_AI_API_KEY: "Google Gemini — model-written briefings",
  COMPATIBLE_API_KEY: "Local OpenAI-compatible server (Ollama, LM Studio)",
  HIBP_API_KEY: "Have I Been Pwned — account-level breach lookup",
  SEARCH_API_KEY: "Brave Search — open-web and news queries",
  OPENSANCTIONS_API_KEY: "OpenSanctions — sanctions and PEP screening",
  VIRUSTOTAL_API_KEY: "VirusTotal — hash reputation",
};

export function SettingsDialog({
  children,
  onCapabilities,
  open: controlledOpen,
  onOpenChange,
}: {
  children?: React.ReactNode;
  onCapabilities?: (capabilities: CapabilityResponse) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [capResponse, keyResponse] = await Promise.all([
      fetch("/api/capabilities").then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/keys").then((response) => (response.ok ? response.json() : null)),
    ]);
    if (capResponse) {
      setCapabilities(capResponse as CapabilityResponse);
      onCapabilities?.(capResponse as CapabilityResponse);
    }
    if (keyResponse) {
      setKeys((keyResponse as { keys: KeyRow[] }).keys);
    }
  }, [onCapabilities]);

  useEffect(() => {
    if (open && !capabilities) {
      void load();
    }
  }, [open, capabilities, load]);

  const saveKeys = async (entries: Record<string, string | null>) => {
    setSaving(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: entries }),
      });
      if (!response.ok) {
        throw new Error("The console rejected those keys");
      }
      const data = (await response.json()) as { keys: KeyRow[] };
      setKeys(data.keys);
      setDrafts({});
      toast.success("Keys stored locally with owner-only permissions");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not store keys");
    } finally {
      setSaving(false);
    }
  };

  const selectProvider = async (providerId: string) => {
    setActiveProvider(providerId);
    try {
      const response = await fetch("/api/provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const data = (await response.json()) as { error?: string; note?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Provider rejected");
      }
      toast.success(data.note ?? "Provider selected");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch provider");
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent
        title="Console settings"
        description="Keys live in a local config file with owner-only permissions. They are never sent to the browser and never leave this machine."
        side="bottom"
      >
        <Tabs defaultValue="keys">
          <TabList className="mb-3.5 w-full justify-between">
            <Tab value="keys">Keys</Tab>
            <Tab value="model">Briefing model</Tab>
            <Tab value="capabilities">Capabilities</Tab>
          </TabList>

          <TabContent value="keys">
            {keys === null ? (
              <div className="space-y-2">
                {["a", "b", "c", "d"].map((slot) => (
                  <Skeleton key={`key-slot-${slot}`} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <ul className="space-y-2">
                {keys.map((row) => (
                  <li
                    key={row.key}
                    className="rounded-xl border border-hairline bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                          <KeyRound className="size-3.5 text-faint-foreground" />
                          {row.key}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {KEY_LABELS[row.key] ?? "Unlocks a keyed source"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {row.configured ? (
                          <Badge
                            tone={row.origin === "environment" ? "info" : "success"}
                            mono
                          >
                            {row.origin === "environment" ? "env" : "saved"}
                          </Badge>
                        ) : (
                          <Badge tone="neutral" mono>
                            absent
                          </Badge>
                        )}
                        {row.configured && row.origin === "stored" ? (
                          <Button
                            variant="ghost"
                            size="iconSm"
                            onClick={() => saveKeys({ [row.key]: null })}
                            aria-label={`Clear ${row.key}`}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {row.configured && row.masked ? (
                      <p className="data-mono mt-2 text-faint-foreground">{row.masked}</p>
                    ) : row.origin === "environment" ? (
                      <p className="mt-2 text-[11.5px] text-faint-foreground">
                        Provided by the server environment — change it there, not here.
                      </p>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={`Paste ${row.key}`}
                          value={drafts[row.key] ?? ""}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.key]: event.target.value,
                            }))
                          }
                          className="h-9"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={saving || !(drafts[row.key] ?? "").trim()}
                          onClick={() => saveKeys({ [row.key]: drafts[row.key] ?? "" })}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabContent>

          <TabContent value="model">
            <div className="mb-3 rounded-xl border border-hairline bg-surface-2/60 p-3">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Skills run with or without a model. When a provider is configured, the
                model rewrites the briefing from the collected evidence — it is instructed
                never to add facts of its own. Without one, the deterministic analyst
                write-up is used, which is fully functional.
              </p>
            </div>
            <ul className="space-y-2">
              {(capabilities?.providers ?? []).map((provider) => (
                <li
                  key={provider.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                      <Cpu className="size-3.5 text-faint-foreground" />
                      {provider.label}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {provider.model} · needs {provider.envVar}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {provider.configured ? (
                      <Badge tone="success" mono>
                        ready
                      </Badge>
                    ) : (
                      <Badge tone="neutral" mono>
                        no key
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={provider.configured ? "primary" : "outline"}
                      disabled={!provider.configured || activeProvider === provider.id}
                      onClick={() => selectProvider(provider.id)}
                    >
                      {activeProvider === provider.id ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      Use
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {!capabilities ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : null}
          </TabContent>

          <TabContent value="capabilities">
            {capabilities ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Skills", value: capabilities.skills.total },
                    { label: "Live sources", value: capabilities.skills.live },
                    { label: "Offline", value: capabilities.skills.local },
                    { label: "Need keys", value: capabilities.skills.keyed },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-xl border border-hairline bg-surface px-3 py-2.5"
                    >
                      <div className="tabular text-[18px] font-semibold text-foreground">
                        {stat.value}
                      </div>
                      <div className="mt-0.5 text-[11px] tracking-wide text-faint-foreground uppercase">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-hairline bg-surface p-3">
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                    <Server className="size-3.5 text-faint-foreground" /> Runtime
                  </p>
                  <dl className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-faint-foreground">Engine</dt>
                      <dd className="data-mono">{capabilities.runtime}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-faint-foreground">Egress</dt>
                      <dd
                        className={cn(
                          capabilities.egress ? "text-success" : "text-warning",
                        )}
                      >
                        {capabilities.egress
                          ? "server can reach public sources"
                          : "server has no egress — the browser will run collection instead"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-faint-foreground">Data dir</dt>
                      <dd className="data-mono break-all">{capabilities.dataDir}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-hairline bg-surface p-3">
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                    <ShieldCheck className="size-3.5 text-success" /> Method
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {capabilities.notes.map((note) => (
                      <li
                        key={note}
                        className="text-[11.5px] leading-relaxed text-muted-foreground"
                      >
                        · {note}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-hairline bg-surface p-3">
                  <p className="mb-2 text-[12px] font-medium tracking-tight text-muted-foreground">
                    Installed skills
                  </p>
                  <ul className="space-y-1">
                    {capabilities.manifest.map((skill) => (
                      <li
                        key={skill.id}
                        className="flex items-start justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] text-foreground">{skill.name}</p>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {skill.description}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge
                            tone={skill.runtime === "live" ? "info" : "neutral"}
                            mono
                          >
                            {skill.runtime}
                          </Badge>
                          {skill.requiresKey?.length ? (
                            <Badge tone="warning" mono>
                              key
                            </Badge>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </TabContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
