"use client";

import { useStaffLocale } from "@/lib/staff/i18n/StaffLocale";
import { OPTION_BADGE, OPTION_NAME, OPTION_SUBTITLE, type ServiceOption } from "@/lib/service/options";

// The client's service option in the console (docs/SERVICE-OPTIONS.md):
// "Complete" (the team prepares and mails) or "DIY" (the client prints and
// mails; the team answers questions and mails only what the client paid us
// to). Same chip shape as the console's other badges; the full name is the
// tooltip and the screen-reader text.

const TONE: Record<ServiceOption, string> = {
  full_service: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
  diy: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
};

export default function OptionBadge({ option, className = "" }: { option: ServiceOption; className?: string }) {
  const { locale } = useStaffLocale();
  const full = `${OPTION_NAME[option][locale]} · ${OPTION_SUBTITLE[option][locale]}`;
  return (
    <span
      data-testid={`option-badge-${option}`}
      title={full}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-none ${TONE[option]} ${className}`}
    >
      <span aria-hidden="true">{OPTION_BADGE[option][locale]}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
