import Link from "next/link";
import { headers } from "next/headers";
import { BRAND } from "@/lib/brand";
import { getStaffAccess, getStaffLocaleChoice, getStaffMember } from "@/lib/staff/access";
import { localeFromBrowser } from "@/lib/staff/i18n/locale";
import { SHELL_TEXT } from "@/lib/staff/i18n/ui/shell";
import Logo from "@/components/Logo";
import StaffShell from "@/components/staff/StaffShell";

// The staff console. Not linked from anywhere a customer goes and kept out of
// search engines. In the demo (no database configured) it is open and shows
// invented clients. With a database, the proxy requires a signed-in session
// and this layout lets in only active members of staff.
//
// The console speaks the member's language (src/lib/staff/i18n): their saved
// choice, else their browser's (Accept-Language), else English. Worked out
// here so the first paint is already in it.
export const metadata = {
  title: BRAND.teamTitle,
  robots: { index: false, follow: false },
};

// The access check must run on every request, never be baked into a static
// page at build time (where the database settings may not be present).
export const dynamic = "force-dynamic";

export default async function EquipoLayout({ children }: { children: React.ReactNode }) {
  const access = await getStaffAccess();
  const browser = localeFromBrowser((await headers()).get("accept-language"));

  if (access === "denied") {
    const t = SHELL_TEXT[browser];
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12" lang={browser}>
        <Logo size={28} />
        <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-slate-900">{t.deniedTitle}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{t.deniedBody(BRAND.name)}</p>
        <Link href="/" className="mt-6 text-[15px] font-medium text-blue-700">
          {t.deniedBack}
        </Link>
      </main>
    );
  }

  // With a database, the member's role decides what each screen shows (and
  // every staff route checks it again). In the demo there is nobody signed in.
  const member = access === "allowed" ? await getStaffMember() : null;
  const viewer = member ? { handle: member.handle, name: member.name, role: member.role } : null;
  const chosen = await getStaffLocaleChoice(member);
  return (
    <StaffShell viewer={viewer} locale={chosen ?? browser} localeSaved={chosen !== null}>
      {children}
    </StaffShell>
  );
}
