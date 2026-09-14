import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkOiT · OSINT analyst console",
  description:
    "An open-source-intelligence console: it collects from real public sources, shows its coverage honestly, and saves every case file locally.",
  applicationName: "SkOiT",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/icon.svg" }],
    shortcut: ["/icon.svg"],
  },
  openGraph: {
    title: "SkOiT · OSINT analyst console",
    description:
      "Find images, video, music, news and answers from real public sources — with the sources attached. Cases stay on your machine.",
    siteName: "SkOiT",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#16181d" },
  ],
  viewportFit: "cover",
};

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("skoit-theme") ?? localStorage.getItem("indus-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: theme flash prevention
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="top-center" toastOptions={{ className: "text-sm" }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
