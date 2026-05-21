import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

export function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: ws
    }
  });
}

export async function insertScanLog({ sport, slate_type, status, message, players_processed = 0 }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("dfs_scan_logs").insert({
    sport,
    slate_type,
    status,
    message,
    players_processed
  });

  if (error) {
    console.error("Failed to insert scan log", error.message);
  }
}
