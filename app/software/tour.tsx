"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./software.module.css";

const line = {
  student: "Your day is the home screen. Ask someone who is free in one tap. Replies, notices, and clubs you follow arrive as alerts.",
  faculty: "Your week sets your status. Busy now, or free for the next hour. Accept a request in one tap.",
  admin: "Your day is the home screen. Notices reach the people they are for. Club events reach people who follow that club.",
} as const;

export function CampusTour({ userId, role }: { userId: string; role: string; onShow?: (id: string) => void }) {
  const key = `campuspulse.tour.v2.${userId}`;
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const copy = role === "faculty" || role === "admin" ? line[role] : line.student;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { if (!localStorage.getItem(key)) setOpen(true); } catch { setOpen(false); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>("[data-tour-next]")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function finish() {
    try { localStorage.setItem(key, "done"); } catch { /* the tour can show again on the next visit */ }
    setOpen(false);
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={dialog} className={styles.tour} style={{ top: 24, left: 24 }} role="dialog" aria-labelledby={titleId}>
      <p className={styles.eyebrow}>YOUR DAY</p>
      <h2 id={titleId}>Start here.</h2>
      <p>{copy}</p>
      <div className={styles.tourActions}>
        <button type="button" className={styles.link} onClick={finish}>Skip</button>
        <button type="button" data-tour-next className={styles.primary} onClick={finish}>Done</button>
      </div>
    </div>,
    document.body,
  );
}
