import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";

// Onboarding's language, chosen on the server for the first render (the saved
// choice, an invitation's ?lang= through the proxy, or the browser's language).
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <RequestLocaleProvider>{children}</RequestLocaleProvider>;
}
