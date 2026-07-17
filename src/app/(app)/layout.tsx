import AppNav from "@/components/AppNav";
import CoachWidget from "@/components/CoachWidget";
import { LocaleProvider } from "@/lib/i18n";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <div className="min-h-screen pb-20 sm:pb-0">
        <AppNav />
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">{children}</div>
        <CoachWidget />
      </div>
    </LocaleProvider>
  );
}
