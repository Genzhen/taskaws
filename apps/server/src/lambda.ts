/**
 * AWS Lambda Handler
 *
 * Hono app 复用 index.ts 的 app 构建逻辑，通过 hono/aws-lambda
 * 适配 API Gateway HTTP API (v2) 事件格式。
 *
 * 本地开发仍用 index.ts（监听端口），Lambda 部署用此文件。
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp();

export const handler = handle(app);
