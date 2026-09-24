export function isPredictionTerminalRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    // The home page is the market board (Kalshi-style), not a separate
    // marketing page.
    pathname === "/" ||
    pathname.startsWith("/event/") ||
    pathname === "/predict" ||
    pathname.startsWith("/predict/") ||
    pathname === "/discover" ||
    pathname.startsWith("/discover/") ||
    pathname.startsWith("/market/")
  );
}
