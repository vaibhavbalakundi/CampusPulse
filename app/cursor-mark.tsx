"use client";

import { useEffect, useRef } from "react";

export function CursorMark() {
  const mark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduce.matches) return;

    let x = 0;
    let y = 0;
    let drawnX = 0;
    let drawnY = 0;
    let hover = false;
    let frame = 0;
    let visible = false;

    const node = mark.current;
    if (!node) return;

    const bringToFront = (restack = false) => {
      // Stay in the top layer above modal dialogs so the same cursor is always visible.
      if (typeof node.showPopover !== "function") return;
      try {
        if (restack && node.matches(":popover-open")) {
          node.hidePopover();
        }
        if (!node.matches(":popover-open")) {
          node.showPopover();
        }
      } catch {
        /* ignore unsupported or closed document cases */
      }
    };

    const draw = () => {
      frame = 0;
      drawnX += (x - drawnX) * 0.35;
      drawnY += (y - drawnY) * 0.35;
      node.style.transform = `translate3d(${drawnX}px, ${drawnY}px, 0) translate(-50%, -50%)`;
      if (Math.abs(x - drawnX) > 0.1 || Math.abs(y - drawnY) > 0.1) frame = requestAnimationFrame(draw);
    };

    const show = () => {
      if (!visible) {
        visible = true;
        node.dataset.on = "true";
      }
      bringToFront(false);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      show();
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const onOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      hover = Boolean(target?.closest("a, button, [role='button'], input, textarea, select, label, summary"));
      node.dataset.hover = hover ? "true" : "";
    };

    const onLeave = () => {
      visible = false;
      node.dataset.on = "false";
      node.dataset.hover = "";
    };

    const onDialogToggle = (event: Event) => {
      // Only react to real <dialog> toggles — the cursor mark is also a popover, so
      // listening to every toggle would hide/show itself in a loop and freeze opacity at 0.
      if (!(event.target instanceof HTMLDialogElement)) return;
      if (!event.target.open || !visible) return;
      requestAnimationFrame(() => bringToFront(true));
    };

    bringToFront();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("toggle", onDialogToggle, true);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.classList.add("has-cursor-mark");

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      document.removeEventListener("toggle", onDialogToggle, true);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.classList.remove("has-cursor-mark");
      try { if (node.matches(":popover-open")) node.hidePopover(); } catch { /* ignore */ }
    };
  }, []);

  return <div ref={mark} className="cursor-mark" popover="manual" data-on="false" aria-hidden="true" />;
}
