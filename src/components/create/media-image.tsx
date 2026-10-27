"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useAuthHeaders } from "@/lib/api";

// /api/media URLs authenticate with the session cookie. If the browser didn't
// send one, fetch the image with the bearer token instead.
export function MediaImage({ url, alt = "", className }: { url: string; alt?: string; className: string }) {
  const authHeaders = useAuthHeaders();
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    if (!src.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  const retry = useCallback(async () => {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    try {
      const response = await fetch(url, { headers: await authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setSrc(URL.createObjectURL(await response.blob()));
    } catch {
      setFailed(true);
    }
  }, [url, authHeaders]);

  if (failed) {
    return (
      <div
        className={cx(
          className,
          "flex items-center justify-center border border-[var(--line)] bg-[var(--surface)] px-6 text-center text-sm text-[var(--muted)]",
        )}
      >
        The portrait was made but won&apos;t load. Refresh the page to try again.
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => void retry()} />;
}
