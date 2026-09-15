import { useState } from "react";
import { Languages } from "lucide-react";
import { transliterateMalayalam } from "@/lib/malayalamTransliteration";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  transliteration?: boolean;
};

/**
 * Malayalam transliteration input — type in Manglish (Malayalam written in
 * English letters) and press ENTER to convert the field to Malayalam script.
 *
 * Nothing is converted while typing: partial words ("nan", "mahall") would
 * otherwise be mangled mid-keystroke and make editing impossible. The ML
 * toggle turns the Enter-conversion on/off per field.
 */
export function MalayalamInput({ value, onChange, transliteration = true, className = "", ...props }: Props) {
  const [enabled, setEnabled] = useState(transliteration);
  const convertOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!enabled || e.key !== "Enter" || (e.nativeEvent as KeyboardEvent).isComposing) return;
    // Already Malayalam (or empty / no Latin letters) → nothing to convert.
    if (!/[A-Za-z]/.test(value) || /[\u0D00-\u0D7F]/.test(value)) return;
    e.preventDefault();
    onChange(transliterateMalayalam(value));
  };
  return (
    <div className="relative">
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={convertOnEnter}
        className={`inp pr-16 ${className}`}
        title={enabled ? "Type in Manglish, then press Enter to convert to Malayalam" : undefined}
        data-transliteration={enabled ? "ml-enter" : "off"}
      />
      <button
        type="button"
        title={enabled ? "Manglish → Malayalam ON — press Enter in the field to convert" : "Malayalam transliteration off"}
        onClick={() => setEnabled(v => !v)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold transition-colors ${enabled ? "bg-primary text-white" : "bg-surface-hover text-text-tertiary"}`}
        aria-pressed={enabled}
      >
        <Languages size={12} /> ML
      </button>
    </div>
  );
}
