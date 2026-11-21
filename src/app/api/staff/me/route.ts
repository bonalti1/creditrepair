import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffMember } from "@/lib/staff/access";

// Who is signed in, as far as the team is concerned: an active member of
// staff (with their role), or not. The login page asks right after the code
// is verified, to send staff to the console instead of the client app. The
// answer comes from the member's own staff_members row (access.ts); someone
// the team invited becomes a member here the first time they sign in.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-me", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const member = await getStaffMember();
  if (!member) return NextResponse.json({ staff: false });
  return NextResponse.json({ staff: true, handle: member.handle, name: member.name, role: member.role });
}
