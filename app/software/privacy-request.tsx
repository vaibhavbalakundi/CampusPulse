"use client";

import { useState, type FormEvent } from "react";
import styles from "./software.module.css";

export type PrivacyRequestKind = "export" | "delete";

export function PrivacyRequestCard({
  working,
  onSubmit,
}: {
  working?: boolean;
  onSubmit: (kind: PrivacyRequestKind, note: string) => void | boolean | Promise<void | boolean>;
}) {
  const [kind, setKind] = useState<PrivacyRequestKind>("export");
  const [note, setNote] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const ok = await onSubmit(kind, note.trim());
      if (ok !== false) setNote("");
    } catch {
      /* parent surfaces errors */
    }
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <h2>Export or delete your records</h2>
      <p className={styles.muted}>
        Submit a request to your campus administrator. Meeting records follow the 45-day retention described in Help &amp; privacy; this form is for a broader export or deletion ask.
      </p>
      <fieldset className={styles.plainFieldset}>
        <legend>Request type</legend>
        <div className={styles.filters} role="group" aria-label="Request type">
          {([
            ["export", "Export my records"],
            ["delete", "Delete my records"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className={styles.adminSearch}>
        Note for your administrator
        <textarea
          maxLength={500}
          rows={4}
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Optional: what you need exported or removed, and any timing constraints."
        />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={working}>
          Submit request
        </button>
      </div>
    </form>
  );
}
