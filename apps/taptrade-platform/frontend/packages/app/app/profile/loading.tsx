export default function ProfileLoading() {
  const blockClass =
    "animate-pulse bg-[linear-gradient(90deg,var(--raised)_25%,var(--card)_50%,var(--raised)_75%)] bg-[length:200%_100%]";

  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-5 px-4 py-6">
      {/* Poster title skeleton */}
      <div className={`${blockClass} h-8 w-48 rounded-[var(--r-rh-md)]`} />
      {/* Tab pills skeleton */}
      <div className={`${blockClass} h-10 w-full rounded-[var(--r-pill)]`} />
      {/* Card skeleton */}
      <div className={`${blockClass} h-[220px] rounded-[var(--r-rh-lg)]`} />
    </div>
  );
}
