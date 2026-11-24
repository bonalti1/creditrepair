"use client";

import { SIGNUP_STEPS, STEP_LABELS, stageRank, stepLabel, type SignupStage } from "@/lib/signup/steps";

// The five steps of the chat signup, at the top of the chat: Get started →
// Your info → Verify identity → Your report → Sign up. A list, so a screen
// reader hears each step and which one is current; on a phone the names
// shorten to the current one under the bar.

export default function SignupProgressBar({ stage, locale, label }: { stage: SignupStage; locale: "en" | "es"; label: string }) {
  const current = stageRank(stage);
  return (
    <nav aria-label={label} data-testid="signup-progress">
      <ol className="flex gap-1.5">
        {SIGNUP_STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "next";
          return (
            <li key={step} className="min-w-0 flex-1" aria-current={state === "current" ? "step" : undefined}>
              <span className={`block h-1.5 rounded-full ${state === "next" ? "bg-slate-300" : state === "current" ? "bg-amber-400" : "bg-blue-700"}`} aria-hidden="true" />
              <span
                className={`sr-only mt-1.5 truncate text-[12px] sm:not-sr-only sm:block ${state === "current" ? "font-semibold text-blue-700" : state === "done" ? "text-slate-600" : "text-slate-500"}`}
              >
                <span className="sr-only">{state === "done" ? (locale === "es" ? "Hecho: " : "Done: ") : ""}</span>
                {STEP_LABELS[locale][step]}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[13px] font-medium text-slate-600 sm:hidden" aria-hidden="true">
        {stepLabel(stage, locale)}
      </p>
    </nav>
  );
}
