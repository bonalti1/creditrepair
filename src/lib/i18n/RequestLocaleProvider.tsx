import { LocaleProvider } from "./index";
import { requestLocale } from "./server";

/**
 * LocaleProvider with the server's choice for the first render (a server
 * component): the saved choice or the browser's language, else English. Use
 * it in the server wrapper of every page a client or visitor sees.
 */
export default async function RequestLocaleProvider({ children }: { children: React.ReactNode }) {
  const initial = await requestLocale();
  return <LocaleProvider initial={initial}>{children}</LocaleProvider>;
}
