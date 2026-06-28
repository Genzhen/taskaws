import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc, trpcClient } from "@/utils/trpc";
import { useState } from "react";
import { EmptyState } from "./empty-state";
import { ProfileCard } from "./profile-card";
import { SyncButton } from "./sync-button";
import { TokenInput } from "./token-input";

type SyncState = "idle" | "loading" | "success";

export function GitHubSync() {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("idle");

  const profileQuery = useQuery(
    trpc.github.getProfile.queryOptions(),
  );

  const syncMutation = useMutation({
    mutationFn: (pat: string) => trpcClient.github.sync.mutate({ pat }),
    onSuccess: () => {
      setSyncState("success");
      setPat(""); // Clear PAT after successful sync
      void queryClient.invalidateQueries(trpc.github.getProfile.queryOptions());
      toast.success("GitHub profile synced");
    },
    onError: (error) => {
      setSyncState("idle");
      toast.error(error.message || "Sync failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => trpcClient.github.deleteProfile.mutate(),
    onSuccess: () => {
      void queryClient.invalidateQueries(trpc.github.getProfile.queryOptions());
      setSyncState("idle");
      setPat("");
      toast.success("Profile deleted from DB");
    },
    onError: (error) => {
      toast.error(error.message || "Delete failed");
    },
  });

  const profile = profileQuery.data?.profile ?? null;
  const hasProfile = profile !== null;

  const handleSync = () => {
    const trimmedPat = pat.trim();
    if (!trimmedPat) {
      toast.error("Please enter a GitHub PAT");
      return;
    }
    setSyncState("loading");
    syncMutation.mutate(trimmedPat); // Submit trimmed PAT, not raw input
  };

  const handleDelete = () => {
    if (!window.confirm("Are you sure you want to remove this data from the AWS VPC?")) {
      return;
    }
    deleteMutation.mutate();
  };

  const buttonState: SyncState =
    syncState === "loading"
      ? "loading"
      : syncState === "success" || hasProfile
        ? "success"
        : "idle";

  // Disable delete when sync is in flight (prevent race condition)
  const deleteDisabled = syncMutation.isPending || deleteMutation.isPending;

  // Disable sync when delete is in flight (mutual exclusion)
  const syncDisabled = syncState === "loading" || deleteMutation.isPending;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6">
      <section className="flex flex-col gap-4 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
        <div className="flex items-center justify-between border-b border-[#414752] pb-2">
          <h2 className="text-base font-semibold text-[#dbe3ec]">
            Entry Point
          </h2>
          <span className="text-lg text-[#c0c7d4]">⌘</span>
        </div>
        <TokenInput
          value={pat}
          onChange={setPat}
          disabled={syncState === "loading"}
        />
        <SyncButton
          state={buttonState}
          onClick={handleSync}
          disabled={syncDisabled}
        />
      </section>

      {profileQuery.isLoading ? (
        <div className="flex justify-center py-8 text-sm text-[#8b919d]">
          Loading...
        </div>
      ) : hasProfile ? (
        <ProfileCard
          username={profile.username}
          avatarUrl={profile.avatarUrl}
          bio={profile.bio}
          publicRepos={profile.publicRepos}
          onDelete={handleDelete}
          deletePending={deleteMutation.isPending}
          deleteDisabled={deleteDisabled}
        />
      ) : (
        <EmptyState />
      )}
    </main>
  );
}
