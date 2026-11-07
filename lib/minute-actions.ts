export type MinuteAction = { id: string; text: string; due_on: string | null; done: boolean };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function cleanMinuteActions(value: unknown): MinuteAction[] {
  if (!Array.isArray(value)) throw new Error("Action list is invalid");
  if (value.length > 20) throw new Error("A meeting can have at most 20 action points");
  return value.map(item => {
    if (!item || typeof item !== "object") throw new Error("Action list is invalid");
    const source = item as { id?: unknown; text?: unknown; due_on?: unknown; done?: unknown };
    const text = String(source.text ?? "").trim();
    if (text.length < 1 || text.length > 200) throw new Error("Each action point needs 1 to 200 characters");
    const due = source.due_on == null || source.due_on === "" ? null : String(source.due_on);
    if (due && (!datePattern.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) throw new Error("An action date is invalid");
    const id = typeof source.id === "string" && /^[0-9a-f-]{36}$/i.test(source.id) ? source.id : crypto.randomUUID();
    return { id, text, due_on: due, done: source.done === true };
  });
}

export function actionsFromTranscript(raw: string): MinuteAction[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const actions = parsed && typeof parsed === "object" && "actions" in parsed ? (parsed as { actions: unknown }).actions : [];
  try { return cleanMinuteActions(actions); } catch { return []; }
}
