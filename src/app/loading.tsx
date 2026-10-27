import { PAGE_GUTTER, Skeleton, cx } from "@/components/ui";

// Shown inside the shell while a page's code or data is on its way: a title
// and a grid of portrait cards, the shape most pages have.
export default function Loading() {
  return (
    <div className={cx("mx-auto w-full max-w-[1600px] pb-12 pt-6 sm:pt-8", PAGE_GUTTER)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56 rounded-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-full" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
