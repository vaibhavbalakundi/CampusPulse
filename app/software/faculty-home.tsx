"use client";

import type { ReactNode } from "react";
import styles from "./software.module.css";

export type FacultyPending = {
  id: string;
  studentName: string;
  when: string;
  reason: string;
};

export type FacultyTodayItem = {
  key: string;
  kind: string;
  title: string;
  when: string;
};

export function FacultyHome({
  name,
  statusControls,
  statusNudge,
  pending,
  today,
  onOpenInbox,
  onOpenDay,
  dayWrap,
}: {
  name: string;
  statusControls: ReactNode;
  statusNudge?: ReactNode;
  pending: FacultyPending[];
  today: FacultyTodayItem[];
  onOpenInbox: () => void;
  onOpenDay: () => void;
  dayWrap?: { pending: number; nudges: number } | null;
}) {
  const waiting = pending.length;
  const preview = pending.slice(0, 3);

  return <>
    <div className={styles.pageHead}>
      <div>
        <h1>{name}.</h1>
        <p>Set status. Answer requests. See what’s next today.</p>
      </div>
    </div>

    <div className={styles.facultyHomeStack}>
      {statusNudge}
      {statusControls}
      {dayWrap && (dayWrap.pending > 0 || dayWrap.nudges > 0) && (
        <section className={`${styles.card} ${styles.facultyDashCard} ${styles.dayWrapCard}`} role="status">
          <div className={styles.sectionHead}>
            <div>
              <h2>Day wrap</h2>
              <p>
                {dayWrap.pending ? `${dayWrap.pending} waiting ask${dayWrap.pending === 1 ? "" : "s"}` : "Inbox clear"}
                {dayWrap.nudges ? ` · ${dayWrap.nudges} status nudge${dayWrap.nudges === 1 ? "" : "s"} still open` : ""}
              </p>
            </div>
            {dayWrap.pending > 0 && <button type="button" className={styles.primary} onClick={onOpenInbox}>Clear inbox</button>}
          </div>
        </section>
      )}

      <section className={`${styles.card} ${styles.facultyDashCard}`} data-tour="faculty-waiting">
        <div className={styles.sectionHead}>
          <div>
            <h2>{waiting ? `${waiting} waiting` : "Inbox clear"}</h2>
            <p>{waiting ? "Students waiting for a yes, no, or another time." : "New meeting asks show up here."}</p>
          </div>
          <button type="button" className={styles.primary} onClick={onOpenInbox}>
            {waiting ? "Open inbox" : "See requests"}
          </button>
        </div>
        {preview.length > 0 && <ul className={styles.facultyDashList}>
          {preview.map(item => (
            <li key={item.id}>
              <div>
                <strong>{item.studentName}</strong>
                <span className={styles.muted}>{item.when}</span>
              </div>
              <p>{item.reason || "No note"}</p>
            </li>
          ))}
        </ul>}
        {waiting > preview.length && (
          <button type="button" className={styles.link} onClick={onOpenInbox}>
            See all {waiting} waiting
          </button>
        )}
      </section>

      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Today</h2>
            <p>{today.length ? "Next on your day." : "Nothing timed for today yet."}</p>
          </div>
          <button type="button" className={styles.secondary} onClick={onOpenDay}>My day</button>
        </div>
        {today.length > 0 && <ul className={styles.facultyDashList}>
          {today.map(item => (
            <li key={item.key}>
              <div>
                <strong>{item.title}</strong>
                <span className={styles.muted}>{item.kind} · {item.when}</span>
              </div>
            </li>
          ))}
        </ul>}
      </section>
    </div>
  </>;
}
