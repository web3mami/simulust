"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PAGE, PAGE_STACK } from "@/components/home/catalogue";
import { StudioFlow } from "@/components/studio/studio-flow";
import { Skeleton, cx } from "@/components/ui";

function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading the studio">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <AppShell>
      <div className={cx(PAGE, PAGE_STACK)}>
        {/* useSearchParams (?character=) needs a Suspense boundary so the rest prerenders. */}
        <Suspense fallback={<Loading />}>
          <StudioFlow />
        </Suspense>
      </div>
    </AppShell>
  );
}
