"use client";

/**
 * MobileTopBarContext — lets a page replace the phone header (below 1024px)
 * with its own: a back button, a short title and the page's actions. The
 * market page uses it for "‹ Politics · share · star · balance" (2026-09-29
 * redesign). Desktop keeps the full TopBar.
 *
 * Two contexts: pages read only the setter (stable), so a page re-rendering
 * with fresh action JSX updates the header without re-rendering itself.
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";

export interface MobileTopBarConfig {
  /** Where back goes when there is no in-app page to return to. */
  fallbackHref: string;
  title: string;
  actions?: ReactNode;
}

const ValueContext = createContext<MobileTopBarConfig | null>(null);
const SetContext = createContext<(config: MobileTopBarConfig | null) => void>(
  () => {},
);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Client navigations seen this session: back returns to the previous
// in-app page when there is one, else goes to the page's fallback (a
// deep link must not bounce the visitor off the site).
let inAppNavigations = 0;

export function hasInAppHistory(): boolean {
  return inAppNavigations > 1;
}

export function MobileTopBarProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MobileTopBarConfig | null>(null);
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the navigation signal being counted
  useEffect(() => {
    inAppNavigations += 1;
  }, [pathname]);
  return (
    <SetContext.Provider value={setConfig}>
      <ValueContext.Provider value={config}>{children}</ValueContext.Provider>
    </SetContext.Provider>
  );
}

export function useMobileTopBarConfig(): MobileTopBarConfig | null {
  return useContext(ValueContext);
}

/** Registers the page's phone header; pass null while it has nothing. */
export function useMobileTopBar(config: MobileTopBarConfig | null): void {
  const setConfig = useContext(SetContext);
  // Every render: the actions are JSX with the page's latest state.
  useIsomorphicLayoutEffect(() => {
    setConfig(config);
  });
  useIsomorphicLayoutEffect(() => () => setConfig(null), [setConfig]);
}
