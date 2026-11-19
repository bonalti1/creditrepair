// Team tools. Not linked from anywhere a customer goes, and kept out of search
// engines. Nothing here reads customer data: these pages only compose links.
export const metadata = {
  title: "CreditCapi — Equipo",
  robots: { index: false, follow: false },
};

export default function EquipoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
