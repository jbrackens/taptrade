export default function Loading() {
  // Minimal skeleton — no logo, no "Loading..." text, no visual disruption.
  // The sidebar and header are already rendered by the layout, so the user
  // sees the full app shell. This skeleton fills the content area silently
  // with flat --surface-2 blocks (DESIGN.md: no decorative shimmer loop —
  // motion is data-driven or feedback, never idle animation).
  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="h-[200px] rounded-[var(--r-rh-lg)] bg-[var(--surface-2)]" />
      <div className="flex gap-4">
        <div className="h-[160px] flex-1 rounded-[var(--r-rh-lg)] bg-[var(--surface-2)]" />
        <div className="h-[160px] flex-1 rounded-[var(--r-rh-lg)] bg-[var(--surface-2)]" />
      </div>
      <div className="h-12 rounded-[var(--r-rh-lg)] bg-[var(--surface-2)]" />
      <div className="h-[120px] rounded-[var(--r-rh-lg)] bg-[var(--surface-2)]" />
    </div>
  );
}
