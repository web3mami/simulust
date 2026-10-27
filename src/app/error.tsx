"use client";

import { useEffect } from "react";
import { AlertIcon } from "@/components/account/account-icons";
import { Button, ButtonLink, EmptyState, PAGE_GUTTER, PAGE_PAD_Y, cx } from "@/components/ui";

// A page that crashed shows this inside the shell, so the menu still works.
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={cx("mx-auto w-full max-w-3xl", PAGE_GUTTER, PAGE_PAD_Y)} role="alert">
      <EmptyState
        icon={<AlertIcon className="h-7 w-7" />}
        title="Something went wrong"
        body="This page hit a problem. Try again, and if it keeps happening, come back in a minute."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button size="lg" onClick={() => retry()}>
              Try again
            </Button>
            <ButtonLink href="/" variant="secondary" size="lg">
              Back to home
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
