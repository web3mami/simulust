import { CompassIcon } from "@/components/icons";
import { ButtonLink, EmptyState, PAGE_GUTTER, PAGE_PAD_Y, cx } from "@/components/ui";

// A bad link lands inside the app, with a way back.
export default function NotFound() {
  return (
    <div className={cx("mx-auto w-full max-w-3xl", PAGE_GUTTER, PAGE_PAD_Y)}>
      <EmptyState
        icon={<CompassIcon className="h-7 w-7" />}
        title="This page doesn't exist"
        body="The link may be old or mistyped."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/" size="lg">
              Back to home
            </ButtonLink>
            <ButtonLink href="/discover" variant="secondary" size="lg">
              Discover characters
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
