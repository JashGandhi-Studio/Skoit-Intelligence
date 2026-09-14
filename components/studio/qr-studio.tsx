"use client";

import { Check, Copy, Download, FileCode2, QrCode, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { downloadGenerated, fileNameFor } from "@/lib/client/download";
import {
  DEFAULT_QR_DESIGN,
  drawQrToCanvas,
  QR_PRESETS,
  type QrDesign,
  type QrFinderStyle,
  type QrModuleStyle,
  qrToSvg,
} from "@/lib/client/qr";
import { cn } from "@/lib/utils";

/**
 * QR Studio — type anything (a link, Wi-Fi credentials, a UPI id, plain text)
 * and get a scannable code in the style you want: module shapes, finder-eye
 * styles, solid or gradient ink, six ready presets. Exports as PNG for chats
 * and SVG for print, drawn locally — nothing is sent anywhere.
 */

const MODULE_STYLES: Array<{ id: QrModuleStyle; label: string }> = [
  { id: "square", label: "Classic" },
  { id: "rounded", label: "Rounded" },
  { id: "dot", label: "Dots" },
  { id: "diamond", label: "Diamond" },
];

const FINDER_STYLES: Array<{ id: QrFinderStyle; label: string }> = [
  { id: "square", label: "Square eye" },
  { id: "rounded", label: "Rounded eye" },
  { id: "circle", label: "Round eye" },
];

const CONTENT_KINDS = [
  { id: "url", label: "Link or text" },
  { id: "wifi", label: "Wi-Fi" },
  { id: "upi", label: "UPI pay" },
  { id: "vcard", label: "Contact card" },
  { id: "phone", label: "Phone call" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "place", label: "Location" },
] as const;

type ContentKind = (typeof CONTENT_KINDS)[number]["id"];

export function QrStudio() {
  const [design, setDesign] = useState<QrDesign>({
    ...DEFAULT_QR_DESIGN,
    text: "https://",
  });
  const [kind, setKind] = useState<ContentKind>("url");
  const [ssid, setSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [upiId, setUpiId] = useState("");
  const [upiName, setUpiName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [phoneNo, setPhoneNo] = useState("");
  const [smsNo, setSmsNo] = useState("");
  const [smsMsg, setSmsMsg] = useState("");
  const [emailAddr, setEmailAddr] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [waNo, setWaNo] = useState("");
  const [waText, setWaText] = useState("");
  const [placeCoords, setPlaceCoords] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  const payload = useMemo(() => {
    if (kind === "wifi") {
      return ssid ? `WIFI:T:WPA;S:${ssid};P:${wifiPassword};;` : "";
    }
    if (kind === "upi") {
      return upiId
        ? `upi://pay?pa=${encodeURIComponent(upiId)}${upiName ? `&pn=${encodeURIComponent(upiName)}` : ""}&cu=INR`
        : "";
    }
    if (kind === "phone") {
      return phoneNo ? `tel:${phoneNo.replace(/\s+/g, "")}` : "";
    }
    if (kind === "sms") {
      return smsNo ? `smsto:${smsNo.replace(/\s+/g, "")}:${smsMsg || ""}` : "";
    }
    if (kind === "email") {
      if (!emailAddr) {
        return "";
      }
      const query = emailSubject ? `?subject=${encodeURIComponent(emailSubject)}` : "";
      return `mailto:${emailAddr}${query}`;
    }
    if (kind === "whatsapp") {
      if (!waNo) {
        return "";
      }
      const digits = waNo.replace(/[^\d]/g, "");
      return `https://wa.me/${digits}${waText ? `?text=${encodeURIComponent(waText)}` : ""}`;
    }
    if (kind === "place") {
      const coords = placeCoords.replace(/\s+/g, "");
      if (!/^[-+]?\d{1,2}(\.\d+)?,[-+]?\d{1,3}(\.\d+)?$/.test(coords)) {
        return "";
      }
      return `geo:${coords}`;
    }
    if (kind === "vcard") {
      return contactName
        ? [
            "BEGIN:VCARD",
            "VERSION:3.0",
            `FN:${contactName}`,
            contactPhone ? `TEL:${contactPhone}` : "",
            "END:VCARD",
          ]
            .filter(Boolean)
            .join("\n")
        : "";
    }
    return design.text;
  }, [
    kind,
    design.text,
    ssid,
    wifiPassword,
    upiId,
    upiName,
    contactName,
    contactPhone,
    phoneNo,
    smsNo,
    smsMsg,
    emailAddr,
    emailSubject,
    waNo,
    waText,
    placeCoords,
  ]);

  const effective: QrDesign = useMemo(
    () => ({ ...design, text: payload || " " }),
    [design, payload],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      drawQrToCanvas(canvas, effective);
      setRendered(true);
    } catch {
      setRendered(false);
    }
  }, [effective]);

  const patch = useCallback((update: Partial<QrDesign>) => {
    setDesign((current) => ({ ...current, ...update }));
  }, []);

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error("The PNG could not be rendered");
        return;
      }
      downloadGenerated(
        fileNameFor(payload.slice(0, 40) || "qr-code", undefined, ".png", "skoit-qr"),
        blob,
      );
      toast.success("QR saved as PNG");
    }, "image/png");
  };

  const downloadSvg = () => {
    try {
      const svg = qrToSvg(effective);
      downloadGenerated(
        fileNameFor(payload.slice(0, 40) || "qr-code", undefined, ".svg", "skoit-qr"),
        svg,
        "image/svg+xml",
      );
      toast.success("QR saved as SVG (print-ready vector)");
    } catch {
      toast.error("The SVG could not be built");
    }
  };

  const copyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob || !("ClipboardItem" in window)) {
        throw new Error("unsupported");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("QR image copied — paste it anywhere");
    } catch {
      toast.error("This browser will not let the console copy images");
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {/* ---------------- controls ---------------- */}
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
            What should it open or say?
          </p>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {CONTENT_KINDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setKind(entry.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all hover:-translate-y-px active:scale-95",
                  kind === entry.id
                    ? "border-primary/50 bg-primary-soft text-primary-strong"
                    : "border-hairline text-muted-foreground hover:bg-surface-2",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {kind === "url" ? (
            <Textarea
              value={design.text}
              onChange={(event) => patch({ text: event.target.value })}
              placeholder="https://example.com — or any text, number, message…"
              rows={3}
              className="text-[13px]"
            />
          ) : null}
          {kind === "wifi" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={ssid}
                onChange={(event) => setSsid(event.target.value)}
                placeholder="Wi-Fi name (SSID)"
              />
              <Input
                value={wifiPassword}
                onChange={(event) => setWifiPassword(event.target.value)}
                placeholder="Password"
                type="text"
              />
              <p className="text-[11px] text-faint-foreground sm:col-span-2">
                Scanning joins the network without typing the password. Generated on this
                device only.
              </p>
            </div>
          ) : null}
          {kind === "upi" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={upiId}
                onChange={(event) => setUpiId(event.target.value)}
                placeholder="name@upi"
              />
              <Input
                value={upiName}
                onChange={(event) => setUpiName(event.target.value)}
                placeholder="Payee name (optional)"
              />
              <p className="text-[11px] text-faint-foreground sm:col-span-2">
                Opens any UPI app with the payee filled in. Double-check the ID before
                sharing.
              </p>
            </div>
          ) : null}
          {kind === "phone" ? (
            <div className="grid gap-2">
              <Input
                value={phoneNo}
                onChange={(event) => setPhoneNo(event.target.value)}
                placeholder="+91 98765 43210"
                inputMode="tel"
              />
              <p className="text-[11px] text-faint-foreground">
                Scanning dials the number — one tap before calling.
              </p>
            </div>
          ) : null}
          {kind === "sms" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={smsNo}
                onChange={(event) => setSmsNo(event.target.value)}
                placeholder="Number, e.g. +91 98765 43210"
                inputMode="tel"
              />
              <Input
                value={smsMsg}
                onChange={(event) => setSmsMsg(event.target.value)}
                placeholder="Prefilled message (optional)"
              />
            </div>
          ) : null}
          {kind === "email" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={emailAddr}
                onChange={(event) => setEmailAddr(event.target.value)}
                placeholder="someone@example.com"
                inputMode="email"
              />
              <Input
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="Subject (optional)"
              />
            </div>
          ) : null}
          {kind === "whatsapp" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={waNo}
                onChange={(event) => setWaNo(event.target.value)}
                placeholder="Number with country code, e.g. 919876543210"
                inputMode="tel"
              />
              <Input
                value={waText}
                onChange={(event) => setWaText(event.target.value)}
                placeholder="Prefilled message (optional)"
              />
              <p className="text-[11px] text-faint-foreground sm:col-span-2">
                Scanning opens the WhatsApp chat with the message typed.
              </p>
            </div>
          ) : null}
          {kind === "place" ? (
            <div className="grid gap-2">
              <Input
                value={placeCoords}
                onChange={(event) => setPlaceCoords(event.target.value)}
                placeholder="Latitude, longitude — e.g. 19.0760, 72.8777"
                inputMode="text"
              />
              <p className="text-[11px] text-faint-foreground">
                Scanning opens the spot in any maps app. Get coordinates from SkOiT&apos;s
                Map &amp; Globe — tap a spot and copy them from the card.
              </p>
            </div>
          ) : null}
          {kind === "vcard" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Full name"
              />
              <Input
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="Phone number"
              />
            </div>
          ) : null}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
            Ready-made styles
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => patch(preset.design)}
                className="flex items-center gap-1.5 rounded-full border border-hairline py-1 pr-2.5 pl-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-surface-2"
              >
                <span
                  className="size-4 rounded-full border border-black/10"
                  style={{
                    background: preset.design.gradient
                      ? `linear-gradient(135deg, ${preset.design.fg}, ${preset.design.gradient})`
                      : preset.design.fg,
                  }}
                />
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Module shape
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MODULE_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => patch({ moduleStyle: style.id })}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-all hover:-translate-y-px active:scale-95",
                    design.moduleStyle === style.id
                      ? "border-primary/50 bg-primary-soft text-primary-strong"
                      : "border-hairline text-muted-foreground hover:bg-surface-2",
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Corner eyes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FINDER_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => patch({ finderStyle: style.id })}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-all hover:-translate-y-px active:scale-95",
                    design.finderStyle === style.id
                      ? "border-primary/50 bg-primary-soft text-primary-strong"
                      : "border-hairline text-muted-foreground hover:bg-surface-2",
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Ink
            </span>
            <input
              type="color"
              value={design.fg}
              onChange={(event) => patch({ fg: event.target.value })}
              className="h-9 w-full cursor-pointer rounded-lg border border-hairline bg-surface p-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Background
            </span>
            <input
              type="color"
              value={design.bg}
              onChange={(event) => patch({ bg: event.target.value })}
              className="h-9 w-full cursor-pointer rounded-lg border border-hairline bg-surface p-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Gradient to
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={design.gradient ?? design.fg}
                onChange={(event) => patch({ gradient: event.target.value })}
                className="h-9 w-full cursor-pointer rounded-lg border border-hairline bg-surface p-1"
              />
              {design.gradient ? (
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label="Remove gradient"
                  onClick={() => patch({ gradient: null })}
                >
                  <RotateCcw />
                </Button>
              ) : null}
            </div>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Error correction — higher survives damage
            </p>
            <div className="flex gap-1.5">
              {(["L", "M", "Q", "H"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => patch({ ecc: level })}
                  className={cn(
                    "size-9 rounded-lg border font-mono text-[12.5px] font-medium transition-colors",
                    design.ecc === level
                      ? "border-primary/50 bg-primary-soft text-primary-strong"
                      : "border-hairline text-muted-foreground hover:bg-surface-2",
                  )}
                  title={{ L: "7% recovery", M: "15%", Q: "25%", H: "30%" }[level]}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Quiet zone — {design.margin} module(s)
            </p>
            <input
              type="range"
              min={1}
              max={6}
              value={design.margin}
              onChange={(event) => patch({ margin: Number(event.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      {/* ---------------- preview ---------------- */}
      <div className="space-y-3 lg:sticky lg:top-0">
        <div className="hover-lift studio-in grid place-items-center rounded-2xl border border-hairline bg-surface-2/60 p-4">
          <canvas
            ref={canvasRef}
            className="h-auto w-full max-w-60 rounded-lg shadow-raise transition-transform duration-300 hover:scale-[1.03]"
            aria-label="QR code preview"
          />
        </div>
        {rendered ? (
          <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-success">
            <Check className="size-3" />
            Scannable · {payload.length} character(s)
          </div>
        ) : (
          <Badge tone="warning">Content too long for one code — shorten it</Badge>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" size="sm" disabled={!rendered} onClick={downloadPng}>
            <Download />
            PNG
          </Button>
          <Button variant="outline" size="sm" disabled={!rendered} onClick={downloadSvg}>
            <FileCode2 />
            SVG
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!rendered}
            onClick={() => void copyImage()}
            className="col-span-2"
          >
            <Copy />
            Copy image
          </Button>
        </div>
        <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint-foreground">
          <QrCode className="mt-0.5 size-3 shrink-0" />
          Everything is drawn on this device — the code never touches a server. SVG stays
          sharp at any print size.
        </p>
      </div>
    </div>
  );
}
