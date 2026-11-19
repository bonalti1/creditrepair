import type { ItemFact } from "@/lib/ux/itemDisplay";

// The facts the report states about one item (balance, status, dates…), so the
// customer can check them before deciding. "card" is the label/value list on a
// review card; "inline" is the one-paragraph version for rows in a list.

export default function ItemFacts({
  facts,
  heading,
  variant = "card",
  className = "",
}: {
  facts: ItemFact[];
  /** Says whose words these are, e.g. "Lo que dice tu reporte:". */
  heading?: string;
  variant?: "card" | "inline";
  className?: string;
}) {
  if (facts.length === 0) return null;

  if (variant === "inline") {
    return (
      <p className={`text-[13px] leading-relaxed text-slate-500 ${className}`}>
        {facts.map((f, i) => (
          <span key={f.label}>
            {i > 0 && " · "}
            {f.label}: <span className="font-medium text-slate-900">{f.value}</span>
          </span>
        ))}
      </p>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-50 px-4 py-3 ${className}`}>
      {heading && <p className="text-[13px] font-semibold text-slate-500">{heading}</p>}
      <dl className={heading ? "mt-1.5 space-y-1.5" : "space-y-1.5"}>
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-[14px] text-slate-500">{f.label}</dt>
            <dd className="min-w-0 text-balance break-words text-right text-[15px] font-medium text-slate-900">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
