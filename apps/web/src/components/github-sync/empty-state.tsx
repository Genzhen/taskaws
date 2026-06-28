import { Ghost } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-[#414752] px-8 py-8 text-center opacity-60">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#2e363c]">
        <Ghost size={48} className="text-[#8b919d]" />
      </div>
      <p className="max-w-[240px] text-sm text-[#c0c7d4]">
        Connect your GitHub account to sync data to AWS VPC database
      </p>
    </div>
  );
}
