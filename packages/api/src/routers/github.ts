import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { githubReader, githubWriter } from "@taskaws/db";
import { publicProcedure, router } from "../index";

const DEMO_USER_ID = "taskaws-public-demo-user";

export const githubRouter = router({
  /** 同步 GitHub 资料（Writer 终节点） */
  sync: publicProcedure
    .input(z.object({ pat: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Create AbortController with 10s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch("https://api.github.com/user", {
          signal: controller.signal,
          headers: {
            Authorization: `token ${input.pat}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "TaskAWS/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        if (!res.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              res.status === 401
                ? "Invalid GitHub PAT"
                : "GitHub API unavailable",
          });
        }

        const ghUser = (await res.json()) as {
          id: number;
          login: string;
          avatar_url: string;
          bio: string | null;
          public_repos: number;
        };

        await githubWriter.ensureDemoUser(DEMO_USER_ID);

        const profile = await githubWriter.upsertByUserId({
          userId: DEMO_USER_ID,
          githubId: ghUser.id,
          username: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          bio: ghUser.bio,
          publicRepos: ghUser.public_repos,
        });

        return { profile };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "GitHub API request timed out after 10 seconds",
          });
        }
        throw error; // Re-throw other errors (including TRPCError)
      } finally {
        clearTimeout(timeoutId);
      }
    }),

  /** 读取已同步 profile（Reader 终节点） */
  getProfile: publicProcedure.query(async () => {
    const profile = await githubReader.getByUserId(DEMO_USER_ID);
    return { profile };
  }),

  /** 删除已同步 profile（Writer 终节点） */
  deleteProfile: publicProcedure.mutation(async () => {
    return githubWriter.deleteByUserId(DEMO_USER_ID);
  }),
});
