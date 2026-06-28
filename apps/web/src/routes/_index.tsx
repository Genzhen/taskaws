import { BottomNav } from "@/components/github-sync/bottom-nav";
import { GitHubSync } from "@/components/github-sync";
import { TopBar } from "@/components/github-sync/top-bar";
import { authClient } from "@/lib/auth-client";
import { Navigate } from "react-router";

import type { Route } from "./+types/_index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "GitHub Sync — TaskAWS" },
    { name: "description", content: "Sync your GitHub profile to AWS VPC" },
  ];
}

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  // Declarative redirect：未登录时 Navigate to /login（不 break hook order）
  if (!isPending && !session) {
    return <Navigate to="/login" replace />;
  }

  if (isPending) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#0d1117] text-sm text-[#8b919d]">
        Loading...
      </div>
    );
  }

  // session 存在时才渲染主页
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
