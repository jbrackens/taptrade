const path = require("path");
// i18n config removed — incompatible with Next.js 13.5 App Router
// const { i18n } = require("./next-i18next.config");

const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
];

module.exports = {
  output: "standalone",
  // Transpile workspace packages that expose raw TypeScript source
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@taptrade-ui/design-system",
    "@taptrade-ui/utils",
    "@taptrade-ui/api-client",
    "@taptrade-api/client",
  ],
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
  // Redirect the entire legacy /risk-management subtree to /dashboard.
  // Those retired Pages Router screens render pre-Tap Trade operations
  // widgets that don't exist in the prediction-market product. Visible
  // under the prediction brand they read as a credibility leak.
  //
  // The page files stay on disk (deleting them is a separate cleanup
  // PR — they share legacy state that needs an audit
  // first); the redirect just makes sure no operator can land on them.
  // When PR #48 (feat/risk-dashboard-v1) merges, change the destination
  // to /prediction-admin/risk so the redirect lands on the real
  // prediction-native dashboard.
  async redirects() {
    return [
      {
        source: "/risk-management/:path*",
        destination: "/prediction-admin/risk",
        permanent: false,
      },
    ];
  },
  webpack: (config, options) => {
    if (!options.isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    // AntD v5 is natively React-19 compatible (+ @ant-design/v5-patch-for-
    // react-19 for the static Modal/message/notification APIs). The old
    // react-dom-react19-shim alias (AntD 4.x stopgap) is removed — it
    // would now double-patch react-dom and break v5's render path.
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve.alias,
          i18n: path.resolve(__dirname, "i18n.js"),
          "next/config$": path.resolve(__dirname, "lib/next-runtime-config.js"),
        },
      },
    };
  },
  experimental: {
    optimizePackageImports: [],
  },
  trailingSlash: true,
  // Without `skipTrailingSlashRedirect`, Next.js auto-308s `/foo` → `/foo/`
  // before applying the `/api/v1/:path*` rewrite. That breaks admin GETs
  // like `GET /api/v1/admin/punters`: the gateway has a prefix handler at
  // `/api/v1/admin/punters/` that treats an empty subpath as "detail with
  // no id" and returns 404. With this flag, `/api/v1/admin/punters` flows
  // straight through to the list handler and the no-slash URL is honored
  // both for page routes and api proxies. Pages still resolve under either
  // form because Next's pages router accepts both.
  skipTrailingSlashRedirect: true,
  // Suppress React 18 hydration mismatch overlay in dev mode.
  // SSR/client differences from localStorage-dependent UI (menus, profile)
  // cause benign text mismatches that don't affect runtime behavior.
  reactStrictMode: false,
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};
