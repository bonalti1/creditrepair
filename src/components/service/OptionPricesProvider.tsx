"use client";

import { createContext, useContext } from "react";
import type { ServiceOption } from "@/lib/service/options";
import type { ComparisonPrice } from "./OptionComparison";

// The comparison's prices for client pages that cannot read the plan
// catalogue themselves (onboarding): the server layout reads the offered,
// attorney-approved plans (site/plans.ts optionPrices) and hands them down.
// None (the demo, or nothing offered yet): "Price set by the team".

export interface OptionPricesValue {
  prices: Record<"en" | "es", Record<ServiceOption, ComparisonPrice | null>>;
  monitoring: Record<"en" | "es", string>;
}

const EMPTY: OptionPricesValue = { prices: { en: { full_service: null, diy: null }, es: { full_service: null, diy: null } }, monitoring: { en: "", es: "" } };

const OptionPricesContext = createContext<OptionPricesValue>(EMPTY);

export default function OptionPricesProvider({ value, children }: { value: OptionPricesValue; children: React.ReactNode }) {
  return <OptionPricesContext.Provider value={value}>{children}</OptionPricesContext.Provider>;
}

export function useOptionPrices(): OptionPricesValue {
  return useContext(OptionPricesContext);
}
