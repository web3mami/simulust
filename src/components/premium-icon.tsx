export function PremiumIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="currentColor" aria-hidden>
      <path d="M12 2.3 15.55 5.55H8.45Z" />
      <path d="M4.45 10.05 8.25 5.75 11.7 9.85Z" />
      <path d="M8.7 5.8H15.3L12 9.65Z" />
      <path d="M15.75 5.75 19.55 10.05 12.3 9.85Z" />
      <path d="M4.45 10.35 11.7 10.35 12 21.4Z" />
      <path d="M12.3 10.35H19.55L12 21.4Z" />
    </svg>
  );
}
