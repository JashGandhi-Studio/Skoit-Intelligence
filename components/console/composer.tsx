"use client";

import {
  ArrowUp,
  Crop,
  Languages,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Switch, Tip } from "@/components/ui/misc";
import { analyseAttachment, releasePreview } from "@/lib/client/attachments";
import { useSpeech } from "@/lib/client/speech";
import type { SkillManifestEntry } from "@/lib/skills";
import { detectTargets, targetLabel } from "@/lib/skills/identify";
import type { AttachmentPayload, SkillCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<SkillCategory, string> = {
  network: "Network",
  infrastructure: "Infrastructure",
  identity: "Identity",
  comms: "Communications",
  media: "Media & files",
  retrieval: "Find images, video & news",
  knowledge: "Knowledge",
  tradecraft: "Tradecraft",
};

export interface ComposerSubmission {
  message: string;
  skillIds?: string[];
  attachments?: Array<AttachmentPayload & { previewUrl?: string }>;
}

export function Composer({
  onSubmit,
  onStop,
  busy,
  manifest,
  className,
}: {
  onSubmit: (submission: ComposerSubmission) => void;
  onStop: () => void;
  busy: boolean;
  manifest: SkillManifestEntry[];
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<
    Array<AttachmentPayload & { previewUrl?: string }>
  >([]);
  const [analysing, setAnalysing] = useState(false);
  const [deep, setDeep] = useState(false);
  const [manualSkills, setManualSkills] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const speech = useSpeech((transcript) => {
    setValue(
      (current) =>
        `${current}${current.endsWith(" ") || current === "" ? "" : " "}${transcript}`,
    );
  });

  const detected = useMemo(
    () => (value.trim().length > 2 ? detectTargets(value, 4) : []),
    [value],
  );

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 208)}px`;
  }, []);

  const submit = () => {
    const message = value.trim();
    if (!message || busy) {
      return;
    }
    const skillIds = manualSkills.length > 0 ? manualSkills : undefined;
    onSubmit({
      message: deep ? `${message} (full sweep)` : message,
      skillIds,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    setValue("");
    speech.stop();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setAnalysing(true);
    try {
      const analysed: Array<AttachmentPayload & { previewUrl?: string }> = [];
      for (const file of Array.from(files).slice(0, 4)) {
        const payload = await analyseAttachment(file);
        analysed.push(payload);
        if (payload.exifErrors?.length) {
          toast.info(`${file.name}: ${payload.exifErrors[0]}`);
        }
      }
      setAttachments((current) => [...current, ...analysed].slice(0, 6));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the file");
    } finally {
      setAnalysing(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const removeAttachment = (name: string, previewUrl?: string) => {
    releasePreview(previewUrl);
    setAttachments((current) => current.filter((item) => item.name !== name));
  };

  const grouped = useMemo(() => {
    const map = new Map<SkillCategory, SkillManifestEntry[]>();
    for (const skill of manifest) {
      const list = map.get(skill.category) ?? [];
      list.push(skill);
      map.set(skill.category, list);
    }
    return Array.from(map.entries());
  }, [manifest]);

  return (
    <div className={cn("safe-b", className)}>
      <div className="rounded-2xl border border-hairline bg-surface p-2 shadow-raise">
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1 pt-1">
            {attachments.map((file) => (
              <span
                key={file.name}
                className="group flex items-center gap-2 rounded-lg border border-hairline bg-surface-2 py-1 pr-1 pl-1.5"
              >
                {file.previewUrl ? (
                  // biome-ignore lint/performance/noImgElement: local blob preview of the analyst's own file
                  <img
                    src={file.previewUrl}
                    alt={`Preview of ${file.name}`}
                    className="size-7 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="size-3.5 text-faint-foreground" />
                )}
                <span className="max-w-[150px] truncate text-[11.5px] text-foreground">
                  {file.name}
                </span>
                {file.coordinates ? (
                  <Badge tone="warning" mono>
                    gps
                  </Badge>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAttachment(file.name, file.previewUrl)}
                  className="rounded p-0.5 text-faint-foreground hover:bg-surface-3 hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask for an image, a clip, the latest news — or paste a domain, IP, email, phone, plate, PIN or hash."
          className="thin-scroll max-h-52 w-full resize-none bg-transparent px-2.5 pt-2 pb-1.5 text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-faint-foreground"
        />

        {detected.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-1.5">
            {detected.map((target) => (
              <Badge key={`${target.kind}-${target.value}`} tone="primary" mono>
                {targetLabel(target)} ·{" "}
                {target.value.length > 34
                  ? `${target.value.slice(0, 32)}…`
                  : target.value}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-0.5 pt-1">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,text/*,.json,.csv,.log,.md,.eml,.pdf"
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <Tip label="Attach a file — EXIF, hashes and entropy are read locally in this browser">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileRef.current?.click()}
                disabled={analysing}
                aria-label="Attach file"
              >
                {analysing ? <Loader2 className="animate-spin" /> : <Paperclip />}
              </Button>
            </Tip>

            <Tip
              label={
                speech.supported
                  ? `Dictate with the browser speech engine (${speech.language})`
                  : "Speech recognition is not available in this browser"
              }
            >
              <Button
                variant={speech.listening ? "primary" : "ghost"}
                size="icon"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                disabled={!speech.supported}
                aria-label="Dictate"
              >
                {speech.listening ? <MicOff /> : <Mic />}
              </Button>
            </Tip>

            {speech.listening ? (
              <span className="live-dot ml-1 text-[11px] text-primary">listening</span>
            ) : null}

            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <Tip label="Choose exactly which skills run">
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Select skills">
                    <Crop />
                  </Button>
                </DialogTrigger>
              </Tip>
              <DialogContent
                title="Skill selection"
                description="Auto mode lets the planner pick the chain from the identifiers it finds. Selecting skills overrides that."
                side="bottom"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-hairline bg-surface-2 px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-medium">Auto-plan</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {manualSkills.length === 0
                          ? "Enabled — the planner decides per request."
                          : `${manualSkills.length} skill(s) pinned manually.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {manualSkills.length > 0 ? (
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => setManualSkills([])}
                        >
                          Reset
                        </Button>
                      ) : null}
                      <Switch
                        checked={deep}
                        onCheckedChange={setDeep}
                        label="Deep sweep"
                      />
                      <span className="text-[12px] text-muted-foreground">Deep</span>
                    </div>
                  </div>

                  {grouped.map(([category, skills]) => (
                    <div key={category}>
                      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
                        {CATEGORY_LABEL[category]}
                      </p>
                      <div className="grid gap-1.5">
                        {skills.map((skill) => {
                          const selected = manualSkills.includes(skill.id);
                          return (
                            <button
                              key={skill.id}
                              type="button"
                              onClick={() =>
                                setManualSkills((current) =>
                                  current.includes(skill.id)
                                    ? current.filter((id) => id !== skill.id)
                                    : [...current, skill.id],
                                )
                              }
                              className={cn(
                                "flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                                selected
                                  ? "border-primary/50 bg-primary-soft"
                                  : "border-hairline bg-surface hover:bg-surface-2",
                              )}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 size-3.5 shrink-0 rounded-[4px] border",
                                  selected
                                    ? "border-primary bg-primary"
                                    : "border-hairline-strong",
                                )}
                              />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[12.5px] font-medium text-foreground">
                                    {skill.name}
                                  </span>
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
                                </span>
                                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                                  {skill.description}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            <Tip
              label={
                speech.supported
                  ? `Dictation language: ${speech.language}`
                  : "Language selector"
              }
            >
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-[11.5px]"
                onClick={speech.cycleLanguage}
                disabled={!speech.supported}
              >
                <Languages className="size-3.5" />
                {speech.language.split("-")[0]}
              </Button>
            </Tip>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-faint-foreground sm:block">
              Enter to run · Shift+Enter for a new line
            </span>
            {busy ? (
              <Button variant="subtle" size="icon" onClick={onStop} aria-label="Stop">
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                onClick={submit}
                disabled={!value.trim() || analysing}
                aria-label="Run analysis"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-faint-foreground">
        <Settings2 className="size-3" />
        Collection runs on real public sources. Anything that needs a key says so instead
        of guessing.
      </p>
    </div>
  );
}
