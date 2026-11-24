import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";

// The chat signup's language, chosen on the server for the first render (the
// saved choice, a link's ?lang= through the proxy, or the browser's language).
export default function RegistroLayout({ children }: { children: React.ReactNode }) {
  return <RequestLocaleProvider>{children}</RequestLocaleProvider>;
}
