"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./software.module.css";

export function ChoiceSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  placeholder = "Choose",
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return <div className={styles.choiceSelect} ref={root}>
    <span className={styles.choiceSelectLabel}>{label}</span>
    <button
      type="button"
      className={`${styles.choiceSelectTrigger}${open ? ` ${styles.choiceSelectTriggerOpen}` : ""}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      disabled={disabled}
      onClick={() => setOpen(current => !current)}
    >
      <span>{selected?.label || placeholder}</span>
    </button>
    {open && (
      <ul id={listId} className={styles.choiceSelectList} role="listbox" aria-label={label}>
        {options.map(option => (
          <li key={option.value} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? styles.choiceSelectOptionOn : undefined}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >{option.label}</button>
          </li>
        ))}
      </ul>
    )}
    {required && <input type="hidden" value={value} required readOnly />}
  </div>;
}
