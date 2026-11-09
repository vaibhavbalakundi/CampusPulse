import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const APP_ORIGINS = new Set([
  "https://sygnetta.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allow = APP_ORIGINS.has(origin) ? origin : "https://sygnetta.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const reply = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders(request) });

type InviteInput = {
  email?: unknown;
  name?: unknown;
  department?: unknown;
  role?: unknown;
};

type InviteRow = {
  email: string;
  name: string;
  department: string;
  role: "student" | "faculty";
};

const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
const roles = new Set(["student", "faculty"]);

function redirectAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (!APP_ORIGINS.has(url.origin)) return false;
    if (url.origin.startsWith("https://")) {
      /* production must be https; already true for sygnetta */
    } else if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return false;
    }
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return path === "/software/" || path.startsWith("/software/");
  } catch {
    return false;
  }
}

function normalizeInvite(raw: InviteInput, index: number): InviteRow | string {
  const email = String(raw.email ?? "").trim().toLowerCase();
  const name = String(raw.name ?? "").trim();
  const department = String(raw.department ?? "").trim();
  const role = String(raw.role ?? "").trim().toLowerCase();
  const label = index >= 0 ? `Row ${index + 1}` : "Invite";
  if (!emailOk(email)) return `${label}: use a valid email address.`;
  if (name.length < 1 || name.length > 120) return `${label}: add a name up to 120 characters.`;
  if (department.length > 120) return `${label}: department is too long.`;
  if (!roles.has(role)) return `${label}: role must be student or faculty. Promote administrators separately.`;
  return { email, name, department, role: role as InviteRow["role"] };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(request) });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(request, { ok: false, message: "Sign in again before inviting people." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(request, { ok: false, message: "Invites are not available right now." }, 500);

  let payload: { invite?: InviteInput; invites?: InviteInput[]; redirect_to?: unknown };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return reply(request, { ok: false, message: "Send invite details as JSON." }, 400);
  }

  const redirectTo = String(payload.redirect_to ?? "").trim();
  if (!redirectAllowed(redirectTo)) {
    return reply(request, { ok: false, message: "Invite redirect URL is not allowed for this app." }, 400);
  }
  const rawList: InviteInput[] = Array.isArray(payload.invites)
    ? payload.invites
    : payload.invite
      ? [payload.invite]
      : [];
  if (!rawList.length) return reply(request, { ok: false, message: "Add at least one person to invite." }, 400);
  if (rawList.length > 50) return reply(request, { ok: false, message: "Invite at most 50 people per request." }, 400);

  const invites: InviteRow[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const next = normalizeInvite(rawList[i] ?? {}, rawList.length === 1 ? -1 : i);
    if (typeof next === "string") return reply(request, { ok: false, message: next }, 400);
    invites.push(next);
  }
  const seen = new Set<string>();
  for (const row of invites) {
    if (seen.has(row.email)) return reply(request, { ok: false, message: `Duplicate email in this batch: ${row.email}` }, 400);
    seen.add(row.email);
  }

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return reply(request, { ok: false, message: "Sign in again before inviting people." }, 401);

  const me = await admin.from("profiles").select("id,institution_id,role,active").eq("id", user.data.user.id).maybeSingle();
  if (me.error || !me.data?.active || me.data.role !== "admin" || !me.data.institution_id) {
    return reply(request, { ok: false, message: "Administrator access required." }, 403);
  }
  const campus = me.data.institution_id as string;

  const invited: string[] = [];
  const failed: { email: string; message: string }[] = [];

  for (const row of invites) {
    try {
      const invitedUser = await admin.auth.admin.inviteUserByEmail(row.email, {
        redirectTo,
        data: { name: row.name, role: row.role, department: row.department, institution_id: campus },
      });
      if (invitedUser.error || !invitedUser.data.user?.id) {
        const message = invitedUser.error?.message || "Could not send invite.";
        const lower = message.toLowerCase();
        if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
          failed.push({ email: row.email, message: "Already has an account — ask them to sign in or Reset password. If their profile is disabled, Activate it under People (invite cannot resend)." });
        } else {
          failed.push({ email: row.email, message });
        }
        continue;
      }

      const userId = invitedUser.data.user.id;
      const already = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (already.data?.id) {
        invited.push(row.email);
        continue;
      }

      const inserted = await admin.from("profiles").insert({
        id: userId,
        institution_id: campus,
        role: row.role,
        name: row.name,
        department: row.department,
        active: true,
      });
      if (inserted.error) {
        failed.push({ email: row.email, message: inserted.error.message || "Invite sent, but the campus profile could not be created." });
        continue;
      }
      invited.push(row.email);
    } catch (error) {
      failed.push({
        email: row.email,
        message: error instanceof Error ? error.message : "Could not invite this person.",
      });
    }
  }

  if (!invited.length) {
    return reply(request, {
      ok: false,
      message: failed[0]?.message || "No invites were sent.",
      invited: [],
      failed,
    }, 400);
  }

  const message = failed.length
    ? `Invited ${invited.length}. ${failed.length} could not be invited.`
    : invited.length === 1
      ? "Invite sent. They can set a password from the email and sign in."
      : `Invited ${invited.length} people.`;

  return reply(request, { ok: true, message, invited, failed });
});
