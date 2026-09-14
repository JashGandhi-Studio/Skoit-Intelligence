"use client";

import {
  ArrowDownToLine,
  FileImage,
  FilePlus2,
  FileStack,
  Files,
  FileText,
  Hash,
  LoaderCircle,
  RotateCw,
  Scissors,
  Stamp,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Tab, TabList, Tabs } from "@/components/ui/misc";
import { downloadGenerated, fileNameFor } from "@/lib/client/download";
import { buildStyledPdf, markdownishToInput } from "@/lib/client/pdf-make";
import {
  imagesToPdf,
  mergePdfs,
  type NamedBytes,
  numberPdf,
  PdfToolError,
  removePages,
  rotatePdf,
  splitPdf,
  watermarkPdf,
} from "@/lib/client/pdf-tools";
import { cn, formatBytes, truncate } from "@/lib/utils";

/**
 * Document Workshop — the PDF toolbox. Every tool runs entirely in this
 * browser tab: files are read locally, processed with pdf-lib/jsPDF, and the
 * result is handed straight back as a download. Nothing is uploaded anywhere,
 * and tools that cannot be done honestly in a browser (Word/Excel conversion,
 * password removal) are simply not offered.
 */

type ToolId =
  | "create"
  | "images"
  | "merge"
  | "split"
  | "organize"
  | "watermark"
  | "numbers";

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof FileText; blurb: string }> =
  [
    {
      id: "create",
      label: "Text → PDF",
      icon: FileText,
      blurb:
        "Paste an article or notes; get a properly headed document with its links organised at the back.",
    },
    {
      id: "images",
      label: "Images → PDF",
      icon: FileImage,
      blurb: "Turn JPG/PNG photos or scans into one tidy PDF, in your chosen order.",
    },
    {
      id: "merge",
      label: "Merge",
      icon: Files,
      blurb: "Combine PDFs into one file, in order.",
    },
    {
      id: "split",
      label: "Split / extract",
      icon: Scissors,
      blurb: "Pull out page ranges, or burst every page into its own file.",
    },
    {
      id: "organize",
      label: "Rotate / delete",
      icon: RotateCw,
      blurb: "Straighten scans or drop pages you do not need.",
    },
    {
      id: "watermark",
      label: "Watermark",
      icon: Stamp,
      blurb:
        "Stamp a diagonal watermark across every page — great for drafts and confidentiality.",
    },
    {
      id: "numbers",
      label: "Page numbers",
      icon: Hash,
      blurb: "Add “Page x of y” to the bottom of every page.",
    },
  ];

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function DropZone({
  accept,
  multiple,
  files,
  onFiles,
  onRemove,
  hint,
}: {
  accept: string;
  multiple: boolean;
  files: File[];
  onFiles: (incoming: File[]) => void;
  onRemove: (index: number) => void;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = Array.from(event.dataTransfer.files ?? []);
          if (dropped.length > 0) {
            onFiles(dropped);
          }
        }}
        className={cn(
          "grid w-full place-items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          dragging
            ? "border-primary/60 bg-primary-soft"
            : "border-hairline-strong bg-surface-2/40 hover:bg-surface-2",
        )}
      >
        <FilePlus2 className="size-5 text-primary" />
        <span className="text-[13px] font-medium text-foreground">
          Tap to choose {multiple ? "files" : "a file"} — or drop{" "}
          {multiple ? "them" : "it"} here
        </span>
        <span className="text-[11px] text-faint-foreground">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          if (picked.length > 0) {
            onFiles(picked);
          }
          event.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5"
            >
              {multiple ? (
                <span className="font-mono text-[10.5px] text-faint-foreground">
                  {index + 1}.
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                {file.name}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-faint-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
                className="grid size-6 place-items-center rounded-md text-faint-foreground transition-colors hover:bg-surface-2 hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RunButton({
  running,
  disabled,
  onClick,
  children,
}: {
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="primary"
      size="md"
      disabled={running || disabled}
      onClick={onClick}
      className="w-full sm:w-auto"
    >
      {running ? <LoaderCircle className="animate-spin" /> : <ArrowDownToLine />}
      {running ? "Working…" : children}
    </Button>
  );
}

function explain(error: unknown): string {
  if (error instanceof PdfToolError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "something went wrong";
}

export function DocumentWorkshop() {
  const [tool, setTool] = useState<ToolId>("create");
  const [running, setRunning] = useState(false);

  // create
  const [docTitle, setDocTitle] = useState("");
  const [docText, setDocText] = useState("");

  // file-based tools
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [splitSpec, setSplitSpec] = useState("1-2");
  const [rotateSpec, setRotateSpec] = useState("");
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);
  const [deleteSpec, setDeleteSpec] = useState("");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");

  const addImages = useCallback((incoming: File[]) => {
    setImageFiles((current) => [
      ...current,
      ...incoming.filter(
        (file) =>
          /image\/(jpeg|png)/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name),
      ),
    ]);
  }, []);
  const addPdfs = useCallback((incoming: File[]) => {
    setPdfFiles((current) => [
      ...current,
      ...incoming.filter(
        (file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf",
      ),
    ]);
  }, []);
  const addSingle = useCallback((incoming: File[]) => {
    const pdf = incoming.find(
      (file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf",
    );
    if (pdf) {
      setSingleFile(pdf);
    } else {
      toast.error("That is not a PDF file");
    }
  }, []);

  const withBytes = async (file: File): Promise<NamedBytes> => ({
    name: file.name,
    bytes: await fileBytes(file),
  });

  const run = async (action: () => Promise<void>) => {
    setRunning(true);
    try {
      await action();
    } catch (error) {
      toast.error(explain(error));
    } finally {
      setRunning(false);
    }
  };

  const blurb = TOOLS.find((entry) => entry.id === tool)?.blurb;

  return (
    <div className="space-y-4">
      <Tabs value={tool} onValueChange={(value) => setTool(value as ToolId)}>
        <TabList className="flex-wrap">
          {TOOLS.map((entry) => (
            <Tab key={entry.id} value={entry.id}>
              <entry.icon className="size-3.5" />
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>

      {blurb ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">{blurb}</p>
      ) : null}

      {/* ------------------------------------------------ text → pdf ---- */}
      {tool === "create" ? (
        <div className="space-y-2.5">
          <Input
            value={docTitle}
            onChange={(event) => setDocTitle(event.target.value)}
            placeholder="Document title (optional — a heading in the text becomes the title)"
          />
          <Textarea
            value={docText}
            onChange={(event) => setDocText(event.target.value)}
            placeholder={
              "Paste anything here…\n\n# A line starting with # becomes a heading\n## and ## a sub-heading\n- lines starting with - become bullet points\nLinks like https://example.com are numbered and collected in a Links page at the back."
            }
            rows={10}
            className="text-[13px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-faint-foreground">
              {docText.trim()
                ? `${docText.trim().split(/\s+/).length} word(s) — formatted with title block, headings and a links appendix`
                : "Nothing pasted yet"}
            </p>
            <RunButton
              running={running}
              disabled={docText.trim().length < 4}
              onClick={() =>
                void run(async () => {
                  const input = markdownishToInput(
                    docText,
                    docTitle.trim() || "Document",
                  );
                  const built = await buildStyledPdf(input);
                  downloadGenerated(built.filename, built.blob);
                  toast.success(
                    `PDF ready — ${built.pages} page(s)${built.unicodeNote ? " · note: use Print for full Devanagari/emoji" : ""}`,
                  );
                  if (built.unicodeNote) {
                    toast.message(built.unicodeNote, { duration: 8000 });
                  }
                  setDocText("");
                  setDocTitle("");
                })
              }
            >
              Build the PDF
            </RunButton>
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------- images → pdf ---- */}
      {tool === "images" ? (
        <div className="space-y-2.5">
          <DropZone
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            multiple
            files={imageFiles}
            onFiles={addImages}
            onRemove={(index) =>
              setImageFiles((current) =>
                current.filter((_, position) => position !== index),
              )
            }
            hint="JPG or PNG — each becomes one page, in this order"
          />
          <RunButton
            running={running}
            disabled={imageFiles.length === 0}
            onClick={() =>
              void run(async () => {
                const inputs = await Promise.all(
                  imageFiles.map(async (file) => ({
                    name: file.name,
                    bytes: await fileBytes(file),
                    mime:
                      file.type ||
                      (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg"),
                  })),
                );
                const bytes = await imagesToPdf(inputs);
                downloadGenerated(
                  fileNameFor("images", undefined, ".pdf", "skoit-doc"),
                  bytes,
                  "application/pdf",
                );
                toast.success(`PDF built from ${imageFiles.length} image(s)`);
                setImageFiles([]);
              })
            }
          >
            Build the PDF ({imageFiles.length} image{imageFiles.length === 1 ? "" : "s"})
          </RunButton>
        </div>
      ) : null}

      {/* ----------------------------------------------------- merge ---- */}
      {tool === "merge" ? (
        <div className="space-y-2.5">
          <DropZone
            accept="application/pdf,.pdf"
            multiple
            files={pdfFiles}
            onFiles={addPdfs}
            onRemove={(index) =>
              setPdfFiles((current) =>
                current.filter((_, position) => position !== index),
              )
            }
            hint="Two or more PDFs — they merge in the order listed"
          />
          <RunButton
            running={running}
            disabled={pdfFiles.length < 2}
            onClick={() =>
              void run(async () => {
                const inputs = await Promise.all(pdfFiles.map(withBytes));
                const bytes = await mergePdfs(inputs);
                downloadGenerated("merged.pdf", bytes, "application/pdf");
                toast.success(`Merged ${pdfFiles.length} files into merged.pdf`);
                setPdfFiles([]);
              })
            }
          >
            Merge {pdfFiles.length >= 2 ? `${pdfFiles.length} PDFs` : "PDFs"}
          </RunButton>
        </div>
      ) : null}

      {/* ----------------------------------------------------- split ---- */}
      {tool === "split" && singleFile ? (
        <div className="space-y-2.5">
          <DropZone
            accept="application/pdf,.pdf"
            multiple={false}
            files={singleFile ? [singleFile] : []}
            onFiles={addSingle}
            onRemove={() => setSingleFile(null)}
            hint="The PDF to cut"
          />
          <Input
            value={splitSpec}
            onChange={(event) => setSplitSpec(event.target.value)}
            placeholder="Pages like 1-3, 7 — or “all” for one file per page"
          />
          <RunButton
            running={running}
            onClick={() =>
              void run(async () => {
                const input = await withBytes(singleFile);
                const results = await splitPdf(input, splitSpec);
                for (const result of results) {
                  downloadGenerated(result.name, result.bytes, "application/pdf");
                }
                toast.success(
                  results.length > 1
                    ? `${results.length} PDFs saved`
                    : `${results[0].name} saved`,
                );
              })
            }
          >
            Cut it
          </RunButton>
        </div>
      ) : null}
      {tool === "split" && !singleFile ? (
        <DropZone
          accept="application/pdf,.pdf"
          multiple={false}
          files={[]}
          onFiles={addSingle}
          onRemove={() => undefined}
          hint="Choose the PDF to split or extract pages from"
        />
      ) : null}

      {/* -------------------------------------------------- organize ---- */}
      {tool === "organize" ? (
        <div className="space-y-2.5">
          {singleFile ? (
            <>
              <DropZone
                accept="application/pdf,.pdf"
                multiple={false}
                files={[singleFile]}
                onFiles={addSingle}
                onRemove={() => setSingleFile(null)}
                hint="The PDF to organise"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-hairline bg-surface-2/40 p-3">
                  <p className="text-[12px] font-medium text-foreground">Rotate</p>
                  <div className="flex gap-1.5">
                    {[90, 180, 270].map((angle) => (
                      <button
                        key={angle}
                        type="button"
                        onClick={() => setRotateAngle(angle as 90 | 180 | 270)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                          rotateAngle === angle
                            ? "border-primary/50 bg-primary-soft text-primary-strong"
                            : "border-hairline text-muted-foreground hover:bg-surface-2",
                        )}
                      >
                        {angle}°
                      </button>
                    ))}
                  </div>
                  <Input
                    value={rotateSpec}
                    onChange={(event) => setRotateSpec(event.target.value)}
                    placeholder="Pages (blank = all), e.g. 1,3-4"
                  />
                  <RunButton
                    running={running}
                    onClick={() =>
                      void run(async () => {
                        const input = await withBytes(singleFile);
                        const bytes = await rotatePdf(input, rotateSpec, rotateAngle);
                        downloadGenerated(
                          `${truncate(singleFile.name.replace(/\.pdf$/i, ""), 40)}-rotated.pdf`,
                          bytes,
                          "application/pdf",
                        );
                        toast.success("Rotated copy saved");
                      })
                    }
                  >
                    Rotate & save
                  </RunButton>
                </div>
                <div className="space-y-1.5 rounded-xl border border-hairline bg-surface-2/40 p-3">
                  <p className="text-[12px] font-medium text-foreground">Delete pages</p>
                  <Input
                    value={deleteSpec}
                    onChange={(event) => setDeleteSpec(event.target.value)}
                    placeholder="Pages to delete, e.g. 2, 5-7"
                  />
                  <RunButton
                    running={running}
                    disabled={deleteSpec.trim().length === 0}
                    onClick={() =>
                      void run(async () => {
                        const input = await withBytes(singleFile);
                        const bytes = await removePages(input, deleteSpec);
                        downloadGenerated(
                          `${truncate(singleFile.name.replace(/\.pdf$/i, ""), 40)}-trimmed.pdf`,
                          bytes,
                          "application/pdf",
                        );
                        toast.success("Trimmed copy saved");
                      })
                    }
                  >
                    Delete & save
                  </RunButton>
                </div>
              </div>
            </>
          ) : (
            <DropZone
              accept="application/pdf,.pdf"
              multiple={false}
              files={[]}
              onFiles={addSingle}
              onRemove={() => undefined}
              hint="Choose the PDF to rotate or trim"
            />
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------- watermark ---- */}
      {tool === "watermark" ? (
        <div className="space-y-2.5">
          {singleFile ? (
            <>
              <DropZone
                accept="application/pdf,.pdf"
                multiple={false}
                files={[singleFile]}
                onFiles={addSingle}
                onRemove={() => setSingleFile(null)}
                hint="The PDF to stamp"
              />
              <Input
                value={watermarkText}
                onChange={(event) => setWatermarkText(event.target.value)}
                placeholder="Watermark text — e.g. CONFIDENTIAL or DRAFT"
              />
              <RunButton
                running={running}
                disabled={watermarkText.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    const input = await withBytes(singleFile);
                    const bytes = await watermarkPdf(input, watermarkText);
                    downloadGenerated(
                      `${truncate(singleFile.name.replace(/\.pdf$/i, ""), 40)}-stamped.pdf`,
                      bytes,
                      "application/pdf",
                    );
                    toast.success("Watermarked copy saved");
                  })
                }
              >
                Stamp & save
              </RunButton>
            </>
          ) : (
            <DropZone
              accept="application/pdf,.pdf"
              multiple={false}
              files={[]}
              onFiles={addSingle}
              onRemove={() => undefined}
              hint="Choose the PDF to watermark"
            />
          )}
        </div>
      ) : null}

      {/* --------------------------------------------- page numbers ---- */}
      {tool === "numbers" ? (
        <div className="space-y-2.5">
          {singleFile ? (
            <>
              <DropZone
                accept="application/pdf,.pdf"
                multiple={false}
                files={[singleFile]}
                onFiles={addSingle}
                onRemove={() => setSingleFile(null)}
                hint="The PDF to number"
              />
              <RunButton
                running={running}
                onClick={() =>
                  void run(async () => {
                    const input = await withBytes(singleFile);
                    const bytes = await numberPdf(input, { format: "x-of-y" });
                    downloadGenerated(
                      `${truncate(singleFile.name.replace(/\.pdf$/i, ""), 40)}-numbered.pdf`,
                      bytes,
                      "application/pdf",
                    );
                    toast.success("Numbered copy saved");
                  })
                }
              >
                Add page numbers
              </RunButton>
            </>
          ) : (
            <DropZone
              accept="application/pdf,.pdf"
              multiple={false}
              files={[]}
              onFiles={addSingle}
              onRemove={() => undefined}
              hint="Choose the PDF to number"
            />
          )}
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 border-t border-hairline pt-3 text-[10.5px] leading-relaxed text-faint-foreground">
        <FileStack className="mt-0.5 size-3 shrink-0" />
        Files are processed inside this browser tab — nothing is uploaded. Word/Excel/PPT
        conversion and password removal need server tools SkOiT deliberately does not run;
        everything offered here is real and local.
      </p>
    </div>
  );
}
