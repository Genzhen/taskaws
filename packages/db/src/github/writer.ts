import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { db } from "../index";
import { githubProfiles, user } from "../schema";

export type UpsertGithubProfileInput = {
  userId: string;
  githubId: number;
  username: string;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
};

export const githubWriter = {
  /** Ensure the public demo flow has a user row for github_profiles.user_id FK. */
  ensureDemoUser: async (userId: string) => {
    await db
      .insert(user)
      .values({
        id: userId,
        name: "TaskAWS Demo",
        email: "demo@taskaws.local",
        emailVerified: true,
      })
      .onConflictDoNothing({
        target: user.id,
      });
  },

  /** upsert：按 userId 插入或更新；事务 + unique violation 处理防止并发 race */
  upsertByUserId: async (input: UpsertGithubProfileInput) => {
    const now = new Date();

    try {
      // 事务包裹：防止并发 race condition
      const result = await db.transaction(async (tx) => {
        // 在事务内检查是否已被其他用户绑定
        const existing = await tx.query.githubProfiles.findFirst({
          where: eq(githubProfiles.githubId, input.githubId),
        });

        if (existing && existing.userId !== input.userId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `GitHub account ${input.username} is already linked to another user`,
          });
        }

        const [row] = await tx
          .insert(githubProfiles)
          .values({
            id: randomUUID(),
            ...input,
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: githubProfiles.userId,
            set: {
              githubId: input.githubId,
              username: input.username,
              avatarUrl: input.avatarUrl,
              bio: input.bio,
              publicRepos: input.publicRepos,
              syncedAt: now,
              updatedAt: now,
            },
          })
          .returning();
        return row;
      });

      return result;
    } catch (error) {
      // 处理 unique violation（并发 insert 同一 githubId）
      if (error instanceof Error && error.message.includes("unique constraint")) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `GitHub account ${input.username} is already linked to another user`,
        });
      }
      // Re-throw TRPCError 和其他错误
      throw error;
    }
  },

  /** 按 userId 删除 profile */
  deleteByUserId: async (userId: string) => {
    await db.delete(githubProfiles).where(eq(githubProfiles.userId, userId));
    return { success: true as const };
  },
};
