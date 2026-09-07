const path = require("path");
// i18n config removed — incompatible with Next.js 13.5 App Router
// const { i18n } = require("./next-i18next.config");

const chatOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_CHAT_PUBLIC_URL || "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();
const realtimeOrigin = (() => {
  const raw =
    process.env.NEXT_PUBLIC_WS_URL ||
    (process.env.NODE_ENV !== "production" ? "ws://localhost:18080/ws" : "");
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();

const frameSrc = ["'self'"];
const connectSrc = ["'self'"];
// Tag Manager and Analytics origins were dropped alongside the inherited
// GTM container removed in the 2026-09 brand migration (see app/layout.tsx).
// Re-add them only if a Tap Trade-owned container is introduced.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
];
if (chatOrigin) {
  frameSrc.push(chatOrigin);
  connectSrc.push(chatOrigin, chatOrigin.replace(/^http/, "ws"));
}
if (apiOrigin) {
  connectSrc.push(apiOrigin);
}
if (realtimeOrigin) {
  connectSrc.push(realtimeOrigin);
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      `frame-src ${frameSrc.join(" ")}`,
      `connect-src ${connectSrc.join(" ")}`,
    ].join("; "),
  },
];

module.exports = {
  output: "standalone",
  // Visual-regression builds (FRONTEND_POLISH_PLAN.md P0) set
  // NEXT_DIST_DIR=.next-visual so `next build`/`next start` for baseline
  // capture never fight a concurrently running `next dev` over .next —
  // dev boot clobbers prod artifacts in a shared dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compress: true,
  images: {
    qualities: [75, 90],
  },
  allowedDevOrigins: ["127.0.0.1"],
  // isomorphic-dompurify instantiates a JSDOM window at module load on the
  // server. Bundling it into .next/server chunks breaks jsdom's on-disk
  // asset lookup (ENOENT .next/browser/default-stylesheet.css) as soon as a
  // content page actually prerenders — which they do since P12 removed the
  // i18n blank-render gate. jsdom is already on Next's default external
  // list; the wrapper package has to stay external with it so the require
  // resolves from node_modules where the asset exists.
  serverExternalPackages: ["isomorphic-dompurify"],
  // Transpile workspace packages that expose raw TypeScript source
  // NOTE: @taptrade-ui/design-system removed — all imports replaced with inline components
  transpilePackages: ["@taptrade-ui/utils", "@taptrade-ui/api-client"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // Proxy API requests to Go backend (for development, avoids CORS issues)
        {
          source: "/api/v1/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080"}/api/v1/:path*`,
        },
        // Proxy admin requests to Go backend
        {
          source: "/admin/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080"}/admin/:path*`,
        },
      ],
    };
  },
  webpack: (config, options) => {
    if (!options.isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        bufferutil: false,
        "utf-8-validate": false,
      };
    } else {
      config.externals = config.externals || [];
      config.externals.push({
        bufferutil: "commonjs bufferutil",
        "utf-8-validate": "commonjs utf-8-validate",
      });
    }
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve.alias,
          "@taptrade-ui/utils$": path.resolve(__dirname, "../utils/src"),
        },
      },
    };
  },
  trailingSlash: true,
};
