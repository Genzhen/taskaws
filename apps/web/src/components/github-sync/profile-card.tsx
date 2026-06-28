import { Database, Trash2, CheckCircle2 } from "lucide-react";

type ProfileCardProps = {
  username: string;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
  onDelete: () => void;
  deletePending?: boolean;
  deleteDisabled?: boolean;
};

export function ProfileCard({
  username,
  avatarUrl,
  bio,
  publicRepos,
  onDelete,
  deletePending,
  deleteDisabled,
}: ProfileCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]">
      <div className="flex items-start gap-4 p-4">
        <div className="relative">
          <div className="size-16 overflow-hidden rounded-lg border border-[#414752] bg-[#2e363c]">
            <img
              src={avatarUrl}
              alt={`${username}'s avatar`}
              className="size-full object-cover"
            />
          </div>
          <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-[#161b22] bg-[#238636]">
            <CheckCircle2 size={12} className="text-white" />
          </div>
        </div>
        <div className="flex flex-grow flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-[#dbe3ec]">
              @{username}
            </h3>
            <span className="rounded-full border border-[#91f294]/30 bg-[#91f294]/10 px-2 py-0.5 font-mono text-xs text-[#91f294]">
              {publicRepos} Repos
            </span>
          </div>
          <p className="mt-1 text-sm text-[#c0c7d4]">
            {bio || "No bio provided"}
          </p>
          <div className="mt-2 flex items-center gap-1 text-xs text-[#8b919d]">
            <Database size={14} />
            <span>AWS VPC: Synced</span>
          </div>
        </div>
      </div>
      <div className="border-t border-[#414752] bg-[#070f15] p-2">
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled || deletePending}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm text-[#f85149] transition-colors hover:bg-[#f85149]/10 disabled:opacity-50"
        >
          <Trash2 size={16} />
          <span>{deletePending ? "Deleting..." : "Delete from DB"}</span>
        </button>
      </div>
    </div>
  );
}
