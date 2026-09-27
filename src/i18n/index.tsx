import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type TranslationKey } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";

export type Lang = "en" | "hi" | "mr";
export type { TranslationKey };

const DICTS: Record<Lang, Record<TranslationKey, string>> = { en, hi, mr };

const LS_KEY = "nagpur-uhi.lang";

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_KEY) as Lang | null;
    if (saved === "en" || saved === "hi" || saved === "mr") return saved;
  } catch { /* ignore */ }
  return "en";
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readInitialLang());

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, lang); } catch { /* ignore */ }
    try { document.documentElement.lang = lang; } catch { /* ignore */ }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dict = DICTS[lang] ?? en;
      const value = dict[key] ?? en[key] ?? key;
      return interpolate(value, vars);
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <LanguageProvider>");
  return ctx;
};