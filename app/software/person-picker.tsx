"use client";

import { useMemo, useState } from "react";
import styles from "./software.module.css";

export type PickerPerson = {
  id: string;
  name: string;
  role: string;
  email?: string;
  department?: string;
  active?: boolean;
};

export function PersonPicker({
  label = "Person",
  people,
  value,
  onChange,
  required = false,
  placeholder = "Search by name or email",
}: {
  label?: string;
  people: PickerPerson[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const selected = people.find(person => person.id === value);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = people.filter(person => person.active !== false);
    if (!needle) return pool.slice(0, 40);
    return pool.filter(person =>
      `${person.name} ${person.email || ""} ${person.role} ${person.department || ""}`.toLowerCase().includes(needle),
    ).slice(0, 40);
  }, [people, query]);

  return <div className={styles.personPicker}>
    <span className={styles.personPickerLabel}>{label}</span>
    {selected ? (
      <div className={styles.personPickerSelected}>
        <div>
          <strong>{selected.name}</strong>
          <span className={styles.muted}>{selected.email || selected.role}</span>
        </div>
        <button type="button" className={styles.secondary} onClick={() => { onChange(""); setQuery(""); }}>Change</button>
      </div>
    ) : (
      <>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
        <input type="hidden" value={value} required={required} readOnly />
        <ul className={styles.personPickerList} role="listbox" aria-label={label}>
          {matches.map(person => (
            <li key={person.id}>
              <button type="button" onClick={() => { onChange(person.id); setQuery(""); }}>
                <strong>{person.name}</strong>
                <span>{person.email || person.role}</span>
              </button>
            </li>
          ))}
          {!matches.length && <li className={styles.muted}>No matching people.</li>}
        </ul>
      </>
    )}
  </div>;
}
