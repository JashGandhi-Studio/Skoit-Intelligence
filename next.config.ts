import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["exifr"],
  // The console is developed through a proxied preview host, so dev asset
  // requests arrive from a different origin than localhost.
  allowedDevOrigins: ["*.e2b.app", "*.vercel.app", "localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
