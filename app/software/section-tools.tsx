"use client";

import { useRef } from "react";
import styles from "./software.module.css";
import { formatDayLabel, fromDateInputValue, shiftLocalDay, toDateInputValue } from "../../lib/section-browse";

export type SectionChip = { id: string; label: string };

export function SectionTools({
  search,
  onSearch,
  searchPlaceholder = "Search",
  day,
  onDayChange,
  chips,
  chip,
  onChip,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
  day?: Date;
  onDayChange?: (value: Date) => void;
  chips?: SectionChip[];
  chip?: string;
  onChip?: (id: string) => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const showDay = !!day && !!onDayChange;

  function openCalendar() {
    const input = dateRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else { input.focus(); input.click(); }
    } catch {
      input.focus();
      input.click();
    }
  }

  return <div className={styles.sectionTools}>
    {chips && chips.length > 0 && onChip && <div className={styles.chipRow} role="group" aria-label="Filter">
      {chips.map(item => <button type="button" key={item.id} className={chip === item.id ? styles.chipActive : styles.chip} aria-pressed={chip === item.id} onClick={() => onChip(item.id)}>{item.label}</button>)}
    </div>}
    <div className={styles.sectionToolsRow}>
      <label className={styles.sectionSearch}>Search
        <input type="search" value={search} placeholder={searchPlaceholder} onChange={event => onSearch(event.target.value)} />
      </label>
      {showDay && <div className={styles.dayStrip}>
        <button type="button" className={styles.secondary} aria-label="Previous day" onClick={() => onDayChange(shiftLocalDay(day, -1))}>‹</button>
        <div className={styles.dayPickWrap}>
          <button type="button" className={styles.dayPick} aria-label={`Choose date, currently ${formatDayLabel(day)}`} onClick={openCalendar}>
            {formatDayLabel(day)}
          </button>
          <input
            ref={dateRef}
            className={styles.dayPickInput}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={toDateInputValue(day)}
            onChange={event => onDayChange(fromDateInputValue(event.target.value))}
          />
        </div>
        <button type="button" className={styles.secondary} aria-label="Next day" onClick={() => onDayChange(shiftLocalDay(day, 1))}>›</button>
      </div>}
    </div>
  </div>;
}
