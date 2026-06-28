import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@taskaws/ui/lib/utils";

type SyncButtonState = "idle" | "loading" | "success";

type SyncButtonProps = {
  state: SyncButtonState;
  onClick: () => void;
  disabled?: boolean;
};

export function SyncButton({ state, onClick, disabled }: SyncButtonProps) {
  const isIdle = state === "idle";
  const isLoading = state === "loading";
  const isSuccess = state === "success";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-all active:scale-[0.98]",
        isIdle && "bg-[#58a6ff] text-[#00315c] hover:bg-[#58a6ff]/90",
        isLoading && "cursor-not-allowed bg-[#58a6ff]/80 text-[#00315c]",
        isSuccess && "bg-[#238636] text-white hover:bg-[#238636]/90",
      )}
    >
      {isLoading ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          <span>Syncing...</span>
        </>
      ) : isSuccess ? (
        <>
          <CloudOff size={16} />
          <span>Synced Successfully</span>
        </>
      ) : (
        <>
          <Cloud size={16} />
          <span>Sync and Save to AWS</span>
        </>
      )}
    </button>
  );
}
