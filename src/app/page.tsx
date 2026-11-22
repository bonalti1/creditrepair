import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import LandingContent from "@/components/marketing/LandingContent";

// Landing (server wrapper). The page itself is in LandingContent, a client
// component, because it follows the visitor's language choice (ES/EN), which
// is kept on the device and shared with the app.

export default function Landing() {
  return (
    <RequestLocaleProvider>
      <LandingContent />
    </RequestLocaleProvider>
  );
}
