import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { env } from "@taskaws/env/server";
import { publicProcedure, router } from "../index";

type IntroPayload = {
  userId: string;
  message: string;
};

export const introRouter = router({
  // WHY publicProcedure: the Go intro service performs no auth of its own —
  // it only reads and returns data keyed by userId. Authentication is enforced
  // at the Lambda edge (better-auth), not inside the Go service.
  proxy: publicProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ input }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      try {
        const url = `${env.INTRO_SERVICE_URL}/api/intro?userId=${encodeURIComponent(
          input.userId,
        )}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "TaskAWS/1.0",
          },
        });

        if (!res.ok) {
          if (res.status === 404) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Intro record not found for the given userId",
            });
          }
          if (res.status >= 500) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Intro service unavailable",
            });
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Intro service rejected request: ${res.status}`,
          });
        }

        return (await res.json()) as IntroPayload;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "Intro service request timed out after 10 seconds",
          });
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }),
});
