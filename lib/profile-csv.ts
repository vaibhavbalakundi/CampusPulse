export type ImportedProfile = {
  email: string;
  name: string;
  department: string;
  role: "student" | "faculty";
};

const required = ["email", "name", "department", "role"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// Small CSV reader supporting quoted commas, newlines and escaped quotes.
export function parseProfileCsv(input: string): ImportedProfile[] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  const text = input.replace(/^\uFEFF/, "");
  const pushField = () => { row.push(field); field = ""; closed = false; };
  const pushRow = () => { pushField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else { if (closed) throw new Error("Unexpected text after a quoted field."); field += c; }
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  if (field || row.length || closed) pushRow();
  if (!rows.length) throw new Error("The CSV file is empty.");
  const headers = rows.shift()!.map(value => value.trim().toLowerCase());
  if (headers.length !== required.length || required.some((name, index) => headers[index] !== name)) {
    throw new Error("Use the columns: email,name,department,role");
  }
  if (!rows.length || rows.length > 2000) throw new Error("Include between 1 and 2000 profiles.");
  const emails = new Set<string>();
  return rows.map((values, index) => {
    if (values.length !== 4) throw new Error(`Row ${index + 2} must have four columns.`);
    const [emailRaw, name, department, rawRole] = values.map(v => v.trim());
    const email = emailRaw.toLowerCase();
    const role = rawRole.toLowerCase();
    if (!emailPattern.test(email)) throw new Error(`Row ${index + 2} needs a valid email.`);
    if (!name || name.length > 120 || department.length > 120 || (role !== "student" && role !== "faculty")) {
      throw new Error(`Row ${index + 2} has an invalid name, department or role.`);
    }
    if (emails.has(email)) throw new Error(`Row ${index + 2} repeats an email.`);
    emails.add(email);
    return { email, name, department, role: role as "student" | "faculty" };
  });
}
