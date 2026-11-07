"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** One soft curve from stretch distance to on-screen pull. */
function rubber(distance: number, limit = 72) {
  if (!distance) return 0;
  const sign = Math.sign(distance);
  const abs = Math.abs(distance);
  return sign * ((abs * limit) / (abs + limit));
}

type Edge = { top?: string; bottom?: string };

export function PullScroll({ children, edge = {} }: { children: ReactNode; edge?: Edge }) {
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const topEdge = edge.top ?? "#f3f1ec";
  const bottomEdge = edge.bottom ?? "#11100e";

  useEffect(() => {
    const root = surface.current;
    const shell = frame.current;
    if (!root || !shell) return;

    let stretch = 0;
    let touchY = 0;
    let dragging = false;
    let spring = 0;
    let settle = 0;
    let paintFrame = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const paint = () => {
      paintFrame = 0;
      const offset = rubber(stretch);
      root.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
      if (offset) root.dataset.pulling = offset > 0 ? "down" : "up";
      else delete root.dataset.pulling;
      shell.style.setProperty("--pull-edge", stretch >= 0 ? topEdge : bottomEdge);
    };

    const schedulePaint = () => {
      if (paintFrame) return;
      paintFrame = requestAnimationFrame(paint);
    };

    const stopSpring = () => {
      cancelAnimationFrame(spring);
      spring = 0;
      window.clearTimeout(settle);
      settle = 0;
    };

    const clearPull = () => {
      stopSpring();
      stretch = 0;
      paint();
    };

    const release = () => {
      if (reduce || !stretch) {
        clearPull();
        return;
      }
      stopSpring();
      const tick = () => {
        stretch *= 0.82;
        if (Math.abs(stretch) < 0.5) {
          stretch = 0;
          spring = 0;
          paint();
          return;
        }
        paint();
        spring = requestAnimationFrame(tick);
      };
      spring = requestAnimationFrame(tick);
    };

    const atTop = () => window.scrollY <= 0.5;
    const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1.5;

    const onWheel = (event: WheelEvent) => {
      if (reduce) return;

      const intoPageFromTop = stretch > 0 && event.deltaY > 0;
      const intoPageFromBottom = stretch < 0 && event.deltaY < 0;
      if (intoPageFromTop || intoPageFromBottom) {
        // Drop the pull immediately so this same gesture can scroll the page.
        clearPull();
        return;
      }

      const pullDown = event.deltaY < 0 && (stretch > 0 || atTop());
      const pullUp = event.deltaY > 0 && (stretch < 0 || atBottom());
      if (!pullDown && !pullUp) return;

      event.preventDefault();
      stopSpring();
      stretch += event.deltaY * -1;
      if (pullDown && stretch < 0) stretch = 0;
      if (pullUp && stretch > 0) stretch = 0;
      if (stretch > 0) window.scrollTo(0, 0);
      if (stretch < 0) window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      schedulePaint();
      settle = window.setTimeout(release, 160);
    };

    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
      dragging = true;
      stopSpring();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!dragging || reduce) return;
      const y = event.touches[0]?.clientY ?? touchY;
      const delta = y - touchY;
      touchY = y;

      const intoPageFromTop = stretch > 0 && delta < 0;
      const intoPageFromBottom = stretch < 0 && delta > 0;
      if (intoPageFromTop || intoPageFromBottom) {
        clearPull();
        return;
      }

      const pullDown = delta > 0 && (stretch > 0 || atTop());
      const pullUp = delta < 0 && (stretch < 0 || atBottom());
      if (!pullDown && !pullUp) return;

      if (event.cancelable) event.preventDefault();
      stretch += delta;
      if (pullDown && stretch < 0) stretch = 0;
      if (pullUp && stretch > 0) stretch = 0;
      if (stretch > 0) window.scrollTo(0, 0);
      if (stretch < 0) window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      schedulePaint();
    };

    const onTouchEnd = () => {
      dragging = false;
      release();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      stopSpring();
      cancelAnimationFrame(paintFrame);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [topEdge, bottomEdge]);

  const style = { "--pull-edge": topEdge } as CSSProperties;

  return (
    <div className="pull-frame" ref={frame} style={style}>
      <div className="pull-surface" ref={surface}>{children}</div>
    </div>
  );
}
