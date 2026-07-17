import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "Mi reporte" },
  { href: "/items", label: "Elementos" },
  { href: "/attack", label: "Mi ataque" },
  { href: "/rounds", label: "Rondas" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link href="/" className="font-bold text-blue-700">
            Bonalti Crédito
          </Link>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm text-slate-600 hover:text-slate-900">
              {n.label}
            </Link>
          ))}
          <span className="ml-auto rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            Demo
          </span>
        </nav>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-10">{children}</div>
    </div>
  );
}
