import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type TokenInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function TokenInput({ value, onChange, disabled }: TokenInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="github-pat"
        className="text-xs font-medium text-[#8b919d]"
      >
        Personal Access Token
      </label>
      <div className="relative">
        <input
          id="github-pat"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Enter your GitHub PAT..."
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-2 pr-10 font-mono text-sm text-[#dbe3ec] placeholder:text-[#414752] outline-none transition-all focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff]/20 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8b919d] transition-colors hover:text-[#dbe3ec]"
          aria-label={visible ? "Hide token" : "Show token"}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="text-xs italic text-[#8b919d]">
        Hint: Token needs read:user permission
      </p>
    </div>
  );
}
