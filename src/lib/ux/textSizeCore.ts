// The "Letra grande" setting's constants, apart from the React hook
// (textSize.ts) so the root layout, a server component, can read the script.

export type TextSize = "normal" | "large";

export const TEXT_SIZE_KEY = "bonalti.textSize";
export const TEXT_SCALE = 1.2;

/** Runs in <head> before the page paints: applies the saved choice. */
export const TEXT_SIZE_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)})==="large")document.documentElement.dataset.textSize="large"}catch(e){}`;

