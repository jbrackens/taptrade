export function isPredictionTerminalRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith("/event/") ||
    pathname === "/predict" ||
    pathname.startsWith("/predict/") ||
    pathname === "/discover" ||
    pathname.startsWith("/discover/") ||
    pathname.startsWith("/market/")
  );
}
