import { Globe, ChevronDown } from "lucide-react";
import { useI18n, type Lang } from "@/i18n";
import { cn } from "@/utils/cn";

const OPTIONS: { value: Lang; labelKey: "lang.en" | "lang.hi" | "lang.mr" }[] = [
  { value: "en", labelKey: "lang.en" },
  { value: "hi", labelKey: "lang.hi" },
  { value: "mr", labelKey: "lang.mr" },
];

export default function LanguageSelector() {
  const { lang, setLang, t } = useI18n();
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5",
        "text-xs font-medium text-slate-700 transition hover:bg-slate-50",
      )}
      title={t("lang.label")}
    >
      <Globe className="h-3.5 w-3.5 text-slate-400" />
      <select
        aria-label={t("lang.label")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="cursor-pointer appearance-none border-0 bg-transparent pr-4 text-xs font-medium text-slate-700 outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none h-3 w-3 text-slate-400" />
    </label>
  );
}