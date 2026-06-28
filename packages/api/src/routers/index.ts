import { protectedProcedure, publicProcedure, router } from "../index";
import { githubRouter } from "./github";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  github: githubRouter,
});
export type AppRouter = typeof appRouter;
