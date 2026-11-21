import AppNav from "@/components/AppNav";
import BillingSync from "@/components/BillingSync";
import OnboardingSync from "@/components/OnboardingSync";
import { LocaleProvider } from "@/lib/i18n";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <div className="min-h-dvh pb-24 sm:pb-8">
        <AppNav />
        <OnboardingSync />
        <BillingSync />
        <div className="mx-auto max-w-2xl px-4 pt-5 sm:px-6 sm:pt-8">{children}</div>
      </div>
    </LocaleProvider>
  );
}
