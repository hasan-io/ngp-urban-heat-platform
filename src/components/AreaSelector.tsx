import { ChevronDown, MapPin } from "lucide-react";
import { AREAS, type AreaKey } from "@/data/boundaries";
import { cn } from "@/utils/cn";

export default function AreaSelector({
  value,
  onChange,
  className,
}: {
  value: AreaKey;
  onChange: (a: AreaKey) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto relative inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_2px_8px_rgba(15,23,42,0.08)] backdrop-blur",
        className,
      )}
    >
      <MapPin className="h-3.5 w-3.5 text-[#FF6B35]" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Area</span>
      <select
        aria-label="Select area"
        value={value}
        onChange={(e) => onChange(e.target.value as AreaKey)}
        className="cursor-pointer appearance-none border-0 bg-transparent pr-4 text-sm font-semibold text-slate-900 outline-none"
      >
        {AREAS.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 text-slate-400" />
    </div>
  );
}