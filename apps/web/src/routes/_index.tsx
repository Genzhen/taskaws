import { BottomNav } from "@/components/github-sync/bottom-nav";
import { GitHubSync } from "@/components/github-sync";
import { TopBar } from "@/components/github-sync/top-bar";

import type { Route } from "./+types/_index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "GitHub Sync — TaskAWS" },
    { name: "description", content: "Sync your GitHub profile to AWS VPC" },
  ];
}

export default function Home() {
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
