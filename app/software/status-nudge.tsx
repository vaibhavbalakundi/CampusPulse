"use client";

import styles from "./software.module.css";

const statusWord = { available: "Available", busy: "Busy", away: "Away" } as const;

export type OpenStatusNudge = {
  id: string;
  student_id: string;
  studentName: string;
  expires_at: string;
};

export function FacultyStatusNudge({
  nudge,
  working,
  onRespond,
  onDismiss,
}: {
  nudge: OpenStatusNudge;
  working?: boolean;
  onRespond: (status: "available" | "busy" | "away") => void;
  onDismiss: () => void;
}) {
  return (
    <section className={`${styles.card} ${styles.facultyDashCard} ${styles.statusNudgeCard}`} role="status">
      <div className={styles.sectionHead}>
        <div>
          <h2>Update your status?</h2>
          <p>
            {nudge.studentName} checked your cabin while you show Available and asked for a quick update.
            One tap sets your status and clears this ask.
          </p>
        </div>
      </div>
      <div className={styles.statusChoices} role="group" aria-label="Set status from ask">
        {(["available", "busy", "away"] as const).map(status => (
          <button
            type="button"
            key={status}
            className={styles.statusChoice}
            disabled={working}
            onClick={() => onRespond(status)}
          >
            {statusWord[status]}
          </button>
        ))}
      </div>
      <button type="button" className={styles.link} disabled={working} onClick={onDismiss}>
        Keep current status
      </button>
    </section>
  );
}

export function StudentStatusNudgeButton({
  canAsk,
  asked,
  blocked,
  working,
  onAsk,
}: {
  canAsk: boolean;
  asked: boolean;
  blocked: boolean;
  working?: boolean;
  onAsk: () => void;
}) {
  if (asked) {
    return <p className={styles.muted} role="status">Asked · waiting for an update</p>;
  }
  if (blocked) {
    return <p className={styles.muted} role="status">Someone already asked them to update</p>;
  }
  if (!canAsk) return null;
  return (
    <button type="button" className={styles.secondary} disabled={working} onClick={event => {
      event.stopPropagation();
      onAsk();
    }}>
      Cabin empty · ask to update
    </button>
  );
}
