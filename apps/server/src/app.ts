import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@taskaws/api/context";
import { appRouter } from "@taskaws/api/routers/index";
import { auth } from "@taskaws/auth";
import { env } from "@taskaws/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export function createApp() {
  const app = new Hono();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: env.CORS_ORIGIN,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: (_opts, context) => {
        return createContext({ context });
      },
    }),
  );

  app.get("/", (c) => {
    return c.text("OK");
  });

  return app;
}
