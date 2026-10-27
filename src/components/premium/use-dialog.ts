"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// What a modal sheet needs to behave: focus moves in and stays in (Tab cycles
// inside it), Escape closes it, the page behind doesn't scroll, and focus goes
// back to whatever opened it. Used by the checkout and the creator's summary.
export function useDialog(panel: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const node = panel.current;
    if (!active || !node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const before = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    // Keep the page from shifting sideways when its scrollbar goes away.
    if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    node.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (!node) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        node.focus();
      } else if (event.shiftKey && (at === first || at === node || !node.contains(at))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === last || !node.contains(at))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = before.overflow;
      root.style.scrollbarGutter = before.gutter;
      // Only take focus back if nothing else claimed it while closing (the
      // creator focuses the new step's heading, for example).
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || node.contains(now))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [panel, active]);
}

// Whether the viewer asked for less motion. Read at the moment it's needed.
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
