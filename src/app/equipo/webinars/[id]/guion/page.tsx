import { publicPlans } from "@/lib/site/plans";
import { packagePrices } from "@/lib/webinars/scripts";
import ScriptPage from "@/components/staff/webinars/ScriptPage";

// The host's script and run of show, printable (docs/WEBINARS.md, «During»).
// The two packages' prices come from the offered, attorney-approved plans
// (the same list as /precios); "[price]" until one is offered.

export default async function WebinarScript() {
  const prices = packagePrices(await publicPlans("en"));
  return <ScriptPage prices={prices} />;
}
