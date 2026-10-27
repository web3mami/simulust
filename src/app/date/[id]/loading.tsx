import { Skeleton } from "@/components/ui";

// Opening a conversation: the shape of the chat (list, messages, composer)
// rather than the app-wide card grid.
export default function Loading() {
  return (
    <div className="flex h-full" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the conversation…</span>
      <div className="hidden w-72 shrink-0 flex-col gap-3 border-r border-[var(--line)] p-4 lg:flex">
        <Skeleton className="h-10 rounded-xl" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24 rounded-full" />
              <Skeleton className="h-3 w-40 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-28 rounded-full" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 p-4">
          <Skeleton className="h-12 w-2/3 max-w-md" />
          <Skeleton className="ml-auto h-10 w-1/2 max-w-sm" />
          <Skeleton className="h-16 w-3/4 max-w-lg" />
        </div>
        <div className="border-t border-[var(--line)] p-3">
          <Skeleton className="h-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}
