import { publicPlans } from "@/lib/site/plans";
import { packagePrices } from "@/lib/webinars/scripts";
import LiveConsole from "@/components/staff/webinars/LiveConsole";

// The moderator's live console (docs/WEBINARS.md, «During»): the counters,
// the copy-paste chat messages, the run-of-show timer with the three
// call-to-action moments, and the messages and leads arriving. Made for a
// laptop beside the stream; it works on a phone too.

export default async function WebinarLive() {
  const prices = packagePrices(await publicPlans("en"));
  return <LiveConsole prices={prices} />;
}
