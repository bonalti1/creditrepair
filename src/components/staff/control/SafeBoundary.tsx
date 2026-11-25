"use client";

import { Component, type ReactNode } from "react";
import { useTx } from "@/lib/staff/i18n/StaffLocale";

// One bad value never blanks the screen (ALTO Control's lesson): every card
// of the Overview, the lead list, the conversation and each settings panel
// sit inside one of these. If something inside throws while rendering, only
// that box says so; the rest of the console keeps working.

function Fallback({ label }: { label?: string }) {
  const t = useTx();
  return (
    <div className="card px-5 py-4 text-[14px] leading-snug text-slate-600" role="status" data-testid="safe-boundary">
      <p className="font-semibold text-slate-900">{label ?? t("Esta parte no se pudo mostrar", "This part couldn't be shown")}</p>
      <p className="mt-1">{t("El resto de la consola sigue funcionando. Recarga la página; si vuelve a pasar, avísale a un administrador.", "The rest of the console still works. Reload the page; if it happens again, tell an administrator.")}</p>
    </div>
  );
}

export default class SafeBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // The console's error reporting picks up window errors; keep a trace for whoever looks at the browser.
    console.error("SafeBoundary", error);
  }

  render() {
    return this.state.failed ? <Fallback label={this.props.label} /> : this.props.children;
  }
}
