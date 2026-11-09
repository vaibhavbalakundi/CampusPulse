import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Only the public browser key belongs here; authorization is enforced by RLS/RPCs.
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) }
}) : null;
