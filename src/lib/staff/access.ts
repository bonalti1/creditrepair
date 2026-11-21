import { getServerSupabase } from "../supabase/server";

// Who may open the staff console.
//
// Demo (Supabase not configured): open to anyone, like the rest of the demo.
// Configured: only a signed-in, active member of staff (staff_members, checked
// by the is_staff() database function from migration 0007). The proxy already
// sends signed-out visitors to the login page; this is the second check, for
// signed-in customers who type the address.
//
// Anything unexpected (function missing, network error) counts as "denied":
// the console fails closed.

export type StaffAccess = "demo" | "allowed" | "denied";

export async function getStaffAccess(): Promise<StaffAccess> {
  const supabase = await getServerSupabase();
  if (!supabase) return "demo";
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return "denied";
    const { data, error } = await supabase.rpc("is_staff");
    return !error && data === true ? "allowed" : "denied";
  } catch {
    return "denied";
  }
}
