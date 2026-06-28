import { BottomNav } from "@/components/github-sync/bottom-nav";
import { GitHubSync } from "@/components/github-sync";
import { TopBar } from "@/components/github-sync/top-bar";

export default function Dashboard() {
  return (
    <div className="flex min-h-full flex-col bg-[#0d1117]">
      <TopBar />
      <div className="flex-grow">
        <GitHubSync />
      </div>
      <BottomNav />
    </div>
  );
}
