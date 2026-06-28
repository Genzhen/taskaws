import { eq } from "drizzle-orm";
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubReader = {
  /** 按 userId 查询已同步的 GitHub profile */
  getByUserId: async (userId: string) => {
    const [row] = await db
      .select()
      .from(githubProfiles)
      .where(eq(githubProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  },
};
