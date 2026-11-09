"use client";

import styles from "./software.module.css";

type Student = {
  id: string;
  name: string;
  department: string;
  email: string;
  active: boolean;
};

export function AdminStudentDirectory({
  people,
  search,
  setSearch,
}: {
  people: Student[];
  search: string;
  setSearch: (value: string) => void;
}) {
  const query = search.trim().toLowerCase();
  const visible = people
    .filter(person => person.active)
    .filter(person => !query || `${person.name} ${person.department} ${person.email}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <>
    <div className={styles.pageHead}>
      <div>
        <h1>Students.</h1>
        <p>Campus student directory. Email is the unique account reference.</p>
      </div>
    </div>
    <div className={styles.directoryTools}>
      <label className={styles.searchLabel}>Search students
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, department, or email" />
      </label>
    </div>
    <p className={styles.resultCount} role="status">{visible.length ? `${visible.length} students` : "No students"}</p>
    <div className={styles.facultyGrid}>
      {visible.map(person => (
        <article key={person.id} className={styles.card}>
          <div className={styles.avatar}>{person.name.charAt(0)}</div>
          <h2>{person.name}</h2>
          <dl className={styles.facultyMeta}>
            <div><dt>Department</dt><dd>{person.department || "Not listed"}</dd></div>
            <div><dt>Email</dt><dd>{person.email || "Not listed"}</dd></div>
          </dl>
        </article>
      ))}
    </div>
    {!visible.length && <div className={styles.card}><p>No students here.</p><button className={styles.secondary} type="button" onClick={() => setSearch("")}>Clear search</button></div>}
  </>;
}
