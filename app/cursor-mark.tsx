"use client";

import { useEffect, useRef, useState } from "react";

export function CursorMark() {
  const mark = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

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

    const draw = () => {
      frame = 0;
      drawnX += (x - drawnX) * 0.35;
      drawnY += (y - drawnY) * 0.35;
      node.style.transform = `translate3d(${drawnX}px, ${drawnY}px, 0) translate(-50%, -50%)`;
      if (Math.abs(x - drawnX) > 0.1 || Math.abs(y - drawnY) > 0.1) frame = requestAnimationFrame(draw);
    };

    const show = () => {
      if (visible) return;
      visible = true;
      setOn(true);
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
      setOn(false);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.classList.add("has-cursor-mark");

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.classList.remove("has-cursor-mark");
    };
  }, []);

  return <div ref={mark} className="cursor-mark" data-on={on ? "true" : "false"} aria-hidden="true" />;
}
