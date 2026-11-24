import { notFound } from "next/navigation";
import CallsScreen from "@/components/staff/CallsScreen";
import { callsEnabled } from "@/lib/calls/config";

// /equipo/llamadas: when the team takes calls, and the calls booked
// (src/lib/calls, migration 0032). Off by default: with
// NEXT_PUBLIC_CALLS_ENABLED unset the screen does not exist, the menu has no
// entry for it and the routes refuse. Questions only, on every call.

export default function LlamadasPage() {
  if (!callsEnabled()) notFound();
  return <CallsScreen />;
}
