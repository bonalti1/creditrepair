import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";

// Sign-in's language, chosen on the server for the first render (src/lib/i18n/detect.ts).
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <RequestLocaleProvider>{children}</RequestLocaleProvider>;
}
