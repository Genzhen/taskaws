import { Bell, RefreshCw } from "lucide-react";

export function TopBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#414752] bg-[#0c141a]">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-4">
        <div className="flex cursor-pointer items-center gap-2 active:opacity-80">
          <RefreshCw size={20} className="text-[#58a6ff]" />
          <h1 className="text-xl font-semibold text-[#dbe3ec]">GitHub Sync</h1>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            className="rounded-full p-2 text-[#c0c7d4] transition-colors hover:bg-[#2e363c]"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </button>
          <div className="size-8 overflow-hidden rounded-full border border-[#414752] bg-[#2e363c]">
            <div className="flex size-full items-center justify-center font-mono text-xs text-[#91f294]">
              GH
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
