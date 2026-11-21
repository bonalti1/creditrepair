import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getStaffAccess, getStaffMember } from "@/lib/staff/access";
import Logo from "@/components/Logo";
import StaffShell from "@/components/staff/StaffShell";

// The staff console. Not linked from anywhere a customer goes and kept out of
// search engines. In the demo (no database configured) it is open and shows
// invented clients. With a database, the proxy requires a signed-in session
// and this layout lets in only active members of staff.
export const metadata = {
  title: BRAND.teamTitle,
  robots: { index: false, follow: false },
};

// The access check must run on every request, never be baked into a static
// page at build time (where the database settings may not be present).
export const dynamic = "force-dynamic";

export default async function EquipoLayout({ children }: { children: React.ReactNode }) {
  const access = await getStaffAccess();

  if (access === "denied") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
        <Logo size={19} />
        <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-slate-900">No tienes acceso</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          Esta sección es solo para el equipo de {BRAND.name}. Si eres parte del equipo, pide a un administrador que
          active tu cuenta.
        </p>
        <Link href="/" className="mt-6 text-[15px] font-medium text-blue-700">
          Volver al inicio
        </Link>
      </main>
    );
  }

  // With a database, the member's role decides what each screen shows (and
  // every staff route checks it again). In the demo there is nobody signed in.
  const member = access === "allowed" ? await getStaffMember() : null;
  const viewer = member ? { handle: member.handle, name: member.name, role: member.role } : null;
  return <StaffShell viewer={viewer}>{children}</StaffShell>;
}
