import type { Metadata } from "next";
// AntD v5 is CSS-in-JS. In the App Router this registry handles style
// injection + SSR extraction; without it the cssinjs motion styles
// don't apply and Modal/Drawer enter-leave animations freeze mid-
// transition (rc-motion never sees transitionend). Required for v5.
import { AntdRegistry } from "@ant-design/nextjs-registry";
import AppRouterProviders from "./app-router-providers";
import AntdConfigProvider from "./lib/antd-config-provider";
import AntdPatch from "./lib/antd-patch";
// Display name comes from lib/brand.ts so the tab title, both login screens
// and the header wordmark cannot drift apart at the next rename.
import { brand } from "../lib/brand";
// P8 design tokens — shared with the Pages Router via the same
// stylesheet so /auth/login (App Router) and /prediction-admin/*
// (Pages Router) paint against one palette. See styles/p8-tokens.css.
import "../styles/p8-tokens.css";

export const metadata: Metadata = {
  title: `${brand.name} Backoffice | Admin Panel`,
  description: `Admin and settlement dashboard for the ${brand.name} prediction market`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AntdRegistry>
          <AntdPatch>
            <AntdConfigProvider>
              <AppRouterProviders>{children}</AppRouterProviders>
            </AntdConfigProvider>
          </AntdPatch>
        </AntdRegistry>
      </body>
    </html>
  );
}
