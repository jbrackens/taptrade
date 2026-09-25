"use client";

/**
 * AppShell — root client boundary for the prediction player app.
 *
 * Layout (Liquid Glass shell, DESIGN.md §6):
 *   [TopBar]                ← sticky 64px glass-med strip
 *   [ChatSidebar][content]  ← app-level shell body on desktop
 *
 * BackdropScene is mounted higher up in layout.tsx so it sits behind every
 * route. Chat remains a leaf panel so provider failures cannot block markets.
 */

import type React from "react";
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import StoreProvider from "../lib/store/StoreProvider";
import { QueryProvider } from "../lib/query/QueryProvider";
import { I18nProvider } from "../lib/i18n/I18nProvider";
import { AuthProvider } from "./AuthProvider";
import { ToastProvider } from "./ToastProvider";
import { TopBar } from "./prediction/TopBar";
import { PredictFooter } from "./prediction/PredictFooter";
import { BackendStatusBanner } from "./BackendStatusBanner";
import MobileTabBar from "./MobileTabBar";
import { ChatSidebar } from "./chat/ChatSidebar";
import { isPredictionTerminalRoute } from "../lib/prediction-terminal";

const AUTH_LAYOUT_CLASS = "min-h-screen overflow-y-auto bg-transparent";

// `isolate` gives the page content its own stacking context so nothing
// inside it can z-fight portalled overlays (Base UI root requirement);
// overlays layer between the TopBar (z-[100]) and toasts (z-[9999]) via
// the OVERLAY_Z band in components/ui.
const APP_SHELL_CLASS = "isolate min-h-screen bg-transparent";

const APP_SHELL_BODY_CLASS =
  "flex items-start w-full max-w-[1588px] min-h-[calc(100vh_-_66px)] mx-auto gap-4 px-6 bg-transparent";

const APP_SHELL_CONTENT_CLASS = "flex-[1_1_1280px] min-w-0";

const APP_SHELL_MAIN_CLASS =
  "max-w-[1280px] mx-auto my-0 pt-7 px-0 pb-20 max-[899px]:pb-[calc(108px_+_env(safe-area-inset-bottom))]";

const TERMINAL_SHELL_BODY_CLASS =
  "flex w-full min-h-[calc(100vh_-_64px)] items-start bg-transparent";

const TERMINAL_SHELL_CONTENT_CLASS = "min-w-0 flex-1";

const TERMINAL_SHELL_MAIN_CLASS =
  "m-0 max-w-none p-0 pb-0 max-[899px]:pb-[calc(64px_+_env(safe-area-inset-bottom))]";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/auth/");
  // /welcome is the campaign landing page: full-bleed, with its own
  // header and footer instead of the app chrome.
  const isMarketingRoute =
    pathname === "/welcome" || pathname?.startsWith("/welcome/");
  const isPredictTerminal = isPredictionTerminalRoute(pathname);

  // Mirror the route theme onto <html> so PORTALLED UI (dialogs, sheets,
  // toasts render into document.body — outside the .predict-terminal
  // wrapper) resolves the same tokens (globals.css pairs the selectors).
  // The SSR'd wrapper class still owns first paint: portals only open
  // after hydration, by which time this layout effect has run.
  useLayoutEffect(() => {
    if (isPredictTerminal) {
      document.documentElement.dataset.theme = "terminal";
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [isPredictTerminal]);

  return (
    <StoreProvider>
      <QueryProvider>
        <I18nProvider>
          <ToastProvider>
            <AuthProvider>
              {isAuthRoute ? (
                <div className={AUTH_LAYOUT_CLASS}>{children}</div>
              ) : isMarketingRoute ? (
                children
              ) : (
                <div
                  className={`${APP_SHELL_CLASS} ${
                    isPredictTerminal ? "predict-terminal" : ""
                  }`}
                >
                  <TopBar />
                  <BackendStatusBanner />
                  <div
                    className={
                      isPredictTerminal
                        ? TERMINAL_SHELL_BODY_CLASS
                        : APP_SHELL_BODY_CLASS
                    }
                  >
                    {!isPredictTerminal && <ChatSidebar />}
                    <div
                      className={
                        isPredictTerminal
                          ? TERMINAL_SHELL_CONTENT_CLASS
                          : APP_SHELL_CONTENT_CLASS
                      }
                    >
                      <main
                        className={
                          isPredictTerminal
                            ? TERMINAL_SHELL_MAIN_CLASS
                            : APP_SHELL_MAIN_CLASS
                        }
                      >
                        {children}
                      </main>
                      {!isPredictTerminal && <PredictFooter />}
                    </div>
                  </div>
                  <MobileTabBar />
                </div>
              )}
            </AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </QueryProvider>
    </StoreProvider>
  );
}
