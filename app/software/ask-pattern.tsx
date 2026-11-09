"use client";

import styles from "./software.module.css";

export function AskPatternCard({ summary }: { summary: { label: string; count: number }[] | null }) {
  const rows = summary?.filter(row => row.count > 0) ?? [];
  const peak = rows.length ? Math.max(...rows.map(row => row.count)) : 0;
  return <section className={`${styles.card} ${styles.facultyDashCard}`}>
    <div className={styles.sectionHead}>
      <div>
        <h2>Usually asked on</h2>
        <p>When students sent meeting requests in the last eight weeks.</p>
      </div>
    </div>
    {!rows.length ? <p className={styles.muted}>Not enough requests yet.</p> : <ul className={styles.askPatternList}>
      {[...rows].sort((left, right) => right.count - left.count).map(row => (
        <li key={row.label} className={styles.askPatternRow}>
          <span>{row.label}</span>
          <div className={styles.askPatternBarTrack} aria-hidden="true">
            <div className={styles.askPatternBarFill} style={{ width: peak ? `${Math.round((row.count / peak) * 100)}%` : "0%" }} />
          </div>
          <strong>{row.count}</strong>
        </li>
      ))}
    </ul>}
  </section>;
}
