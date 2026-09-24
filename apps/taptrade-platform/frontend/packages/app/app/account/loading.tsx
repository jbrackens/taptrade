export default function AccountLoading() {
  const blockClass =
    "animate-pulse rounded-[var(--r-rh-lg)] bg-[linear-gradient(90deg,var(--raised)_25%,var(--card)_50%,var(--raised)_75%)] bg-[length:200%_100%]";

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-6 pb-[60px] pt-6">
      {/* Poster title skeleton */}
      <div className={`${blockClass} h-9 w-40`} />
      {/* Identity banner skeleton */}
      <div className={`${blockClass} h-[76px]`} />
      {/* Section blocks skeleton */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`${blockClass} h-[100px]`} />
      ))}
    </div>
  );
}
