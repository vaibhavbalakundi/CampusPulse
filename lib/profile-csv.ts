export type ImportedProfile = { auth_user_id: string; name: string; department: string; role: "student" | "faculty" };
const required = ["auth_user_id", "name", "department", "role"];

// Small CSV reader supporting quoted commas, newlines and escaped quotes.
export function parseProfileCsv(input: string): ImportedProfile[] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  const text = input.replace(/^\uFEFF/, "");
  const pushField = () => { row.push(field); field = ""; closed = false; };
  const pushRow = () => { pushField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; pushRow(); }
    else { if (closed) throw new Error("Unexpected text after a quoted field."); field += c; }
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  if (field || row.length || closed) pushRow();
  if (!rows.length) throw new Error("The CSV file is empty.");
  const headers = rows.shift()!.map(value => value.trim().toLowerCase());
  if (headers.length !== required.length || required.some((name,index) => headers[index] !== name)) {
    throw new Error("Use the columns: auth_user_id,name,department,role");
  }
  if (!rows.length || rows.length > 100) throw new Error("Include between 1 and 100 profiles.");
  const ids = new Set<string>();
  return rows.map((values,index) => {
    if (values.length !== 4) throw new Error(`Row ${index+2} must have four columns.`);
    const [auth_user_id,name,department,rawRole] = values.map(v => v.trim());
    const role = rawRole.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auth_user_id)) throw new Error(`Row ${index+2} needs a valid Auth user ID.`);
    if (!name || name.length > 120 || department.length > 120 || (role !== "student" && role !== "faculty")) throw new Error(`Row ${index+2} has an invalid name, department or role.`);
    if (ids.has(auth_user_id.toLowerCase())) throw new Error(`Row ${index+2} repeats an Auth user ID.`);
    ids.add(auth_user_id.toLowerCase());
    return {auth_user_id,name,department,role};
  });
}
