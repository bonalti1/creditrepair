"use client";

import { useCallback, useEffect, useState } from "react";

// "Letra grande": a per-device setting that makes the client app's text and
// tap targets bigger. Many clients are 45+ or read on a small phone.
//
// How it works: the choice is saved on the device and set as
// <html data-text-size="large">, and globals.css scales the client app's
// containers (`.client-scale`) by TEXT_SCALE with CSS zoom. Zoom scales text,
// spacing and tap targets together, so every screen keeps its layout and
// nothing is cut: a 390 px phone lays the app out as if it were 325 px wide,
// which the screens are checked at. The root layout applies the saved choice
// before the first paint (TEXT_SIZE_SCRIPT), so the page never jumps.

import { TEXT_SIZE_KEY, type TextSize } from "./textSizeCore";

export { TEXT_SCALE, TEXT_SIZE_KEY, type TextSize } from "./textSizeCore";

export function readTextSize(): TextSize {
  if (typeof window === "undefined") return "normal";
  try {
    return window.localStorage.getItem(TEXT_SIZE_KEY) === "large" ? "large" : "normal";
  } catch {
    return "normal";
  }
}

function apply(size: TextSize) {
  if (size === "large") document.documentElement.dataset.textSize = "large";
  else delete document.documentElement.dataset.textSize;
}

export function useTextSize() {
  const [size, setSizeState] = useState<TextSize>("normal");

  useEffect(() => {
    const saved = readTextSize();
    setSizeState(saved);
    apply(saved);
  }, []);

  const setSize = useCallback((next: TextSize) => {
    setSizeState(next);
    apply(next);
    try {
      if (next === "large") window.localStorage.setItem(TEXT_SIZE_KEY, "large");
      else window.localStorage.removeItem(TEXT_SIZE_KEY);
    } catch {
      // Storage unavailable: the choice lasts for this visit.
    }
  }, []);

  return { size, large: size === "large", setSize };
}
