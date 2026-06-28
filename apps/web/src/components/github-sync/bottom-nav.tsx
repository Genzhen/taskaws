import { LayoutDashboard, Package, History, Settings } from "lucide-react";
import { cn } from "@taskaws/ui/lib/utils";
import { toast } from "sonner";

const TABS = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Package, label: "Repos", active: false },
  { icon: History, label: "Logs", active: false },
  { icon: Settings, label: "Settings", active: false },
] as const;

export function BottomNav() {
  const handleNavClick = (label: string) => {
    if (label === "Dashboard") {
      // Dashboard is current page (GitHub Sync), no action needed
      return;
    }
    // Other tabs: show "Coming soon" toast (避免误导用户)
    toast.info(`${label} — Coming soon`);
  };

  return (
    <nav className="sticky bottom-0 flex justify-around border-t border-[#414752] bg-[#151d22] py-2 pb-4 md:hidden">
      {TABS.map(({ icon: Icon, label, active }) => (
        <button
          key={label}
          type="button"
          onClick={() => handleNavClick(label)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg px-4 py-2 transition-all",
            active
              ? "bg-[#238636] font-medium text-white"
              : "text-[#c0c7d4] hover:text-[#dbe3ec]",
          )}
        >
          <Icon size={18} />
          <span className="text-xs">{label}</span>
        </button>
      ))}
    </nav>
  );
}
