import { Bell, LogOut, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";

export function TopBar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(trpc.privateData.queryOptions());
  const user = sessionQuery.data?.user;

  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Clear all user-scoped React Query caches to prevent cross-account data leak
          queryClient.clear();
          navigate("/login");
        },
      },
    });
  };

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
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full p-2 text-[#c0c7d4] transition-colors hover:bg-[#2e363c]"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
          <div className="size-8 overflow-hidden rounded-full border border-[#414752] bg-[#2e363c]">
            {user?.image ? (
              <img
                src={user.image}
                alt={user.name || "User"}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-[#c0c7d4]">
                {user?.name?.charAt(0)?.toUpperCase() || "?"}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
