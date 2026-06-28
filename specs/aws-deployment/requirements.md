# Requirements: AWS SAM 部署与 GitHub Actions 自动化

**版本**：v1.0
**日期**：2026-06-28
**状态**：Draft
**父 PRD**：`specs/PLAN.md` — Cycle 4 + Cycle 5 + Cycle 6

> 本文档定义将已完成的 Hono + Drizzle 全栈应用部署到 AWS 的基础设施需求。
> AWS 云端已手动建好 VPC、NAT 网关和 RDS 主从库；本 feature 聚焦 **SAM 模板化** + **CI/CD 自动化**。

---

## 1. 业务背景

当前状态：
- 本地代码开发完成（Hono 后端 + React Router SPA 前端 + Drizzle ORM + PostgreSQL）
- AWS 云端已手动搭建：VPC（含 NAT 网关）、私有子网 A/B、RDS PostgreSQL 主从集群（Writer + Reader Endpoint）
- **缺失**：基础设施即代码（IaC）模板、自动化部署流水线

目标：代码 push 到 `main` 分支后，自动构建并部署到 AWS Lambda + API Gateway，前端静态资源同步到 S3。

---

## 2. 功能需求 (FR)

### FR-1: SAM 模板 — Lambda 函数

- Runtime: `nodejs20.x`
- Handler: 指向 Hono 应用的 Lambda 入口文件
- MemorySize: 512 MB（默认，可按需调整）
- Timeout: 30 秒（API Gateway HTTP API 最大超时）
- Architectures: `arm64`（Graviton，成本更低）
- 环境变量注入：
  - `DATABASE_WRITER_URL` — RDS Writer Endpoint 连接串（含用户名/密码/库名）
  - `DATABASE_READER_URL` — RDS Reader Endpoint 连接串
  - `BETTER_AUTH_SECRET` — 认证密钥（≥32 字符）
  - `BETTER_AUTH_URL` — 后端认证服务 URL（API Gateway 域名）
  - `CORS_ORIGIN` — 前端域名
  - `NODE_ENV` — 固定为 `production`
- **所有环境变量通过 SAM Parameters 引用**，敏感值标 `NoEcho: true`

### FR-2: SAM 模板 — VPC 配置

- Lambda 的 `VpcConfig` 必须包含：
  - `SubnetIds`: 参数占位符，引用两个私有子网（SubnetA、SubnetB）
  - `SecurityGroupIds`: 引用下方定义的 Lambda SecurityGroup
- 不配置 VPC 则 Lambda 无法访问 VPC 内的 RDS

### FR-3: SAM 模板 — 安全组

- 新建 `AWS::EC2::SecurityGroup`：
  - `GroupDescription`: "Lambda to RDS access"
  - `VpcId`: 参数引用自定义 VPC ID
  - `SecurityGroupEgress`: 允许 TCP 出站到 RDS 端口（5432）
  - 无需入站规则（Lambda 不接受外部连接）

### FR-4: SAM 模板 — API Gateway 触发器

- 类型：`AWS::Serverless::Api`（HTTP API，非 REST API — 成本更低、延迟更小）
- 路由：`/{proxy+}` 捕获所有 HTTP 方法，转发到 Lambda
- Payload 格式：2.0（HTTP API v2）
- 输出：API Gateway 的 Invoke URL

### FR-5: 构建脚本

- `build:api` 脚本：使用 esbuild 将 `apps/server/src/lambda.ts` 及其依赖打包为单文件
  - 格式：ESM（`type: "module"`）
  - 平台：`node`，target：`node20`
  - 输出：`apps/server/dist/lambda.mjs`
  - external：`@aws-sdk/*`（Lambda 运行时已内置）
- `sam:build` 脚本：调用 `sam build`，SAM CLI 从 `template.yaml` 读取配置

### FR-6: GitHub Actions 工作流

- 触发条件：`push` 到 `main` 分支
- Job 步骤：
  1. Checkout 代码（`actions/checkout@v4`）
  2. 安装 Node.js（`actions/setup-node@v4`，node 20.x）
  3. 安装 pnpm（`pnpm/action-setup@v2`）
  4. 安装依赖（`pnpm install --frozen-lockfile`）
  5. 构建 Lambda 包（`pnpm run build:api`）
  6. 配置 AWS 凭证（`aws-actions/configure-aws-credentials@v4`）
  7. 安装 AWS SAM CLI（官方 `aws-actions/setup-sam@v2`）
  8. 执行 `sam build`
  9. 执行 `sam deploy`（`--no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM`）
- 可选：前端 S3 同步步骤（`aws s3 sync`）

### FR-7: 前端静态部署（可选）

- 构建前端：`pnpm run build:web`（`react-router build` 产物在 `apps/web/build/`）
- S3 同步：`aws s3 sync apps/web/build/ s3://<FRONTEND_BUCKET>/ --delete`
- CloudFront 缓存失效（如使用）：`aws cloudfront create-invalidation`

---

## 3. 非功能需求 (NFR)

### NFR-1: 安全
- 所有敏感参数（数据库密码、AUTH_SECRET）通过 GitHub Secrets → SAM Parameters → Lambda Env 传递
- 不在 `template.yaml` 中硬编码任何密钥或连接串
- IAM Role 遵循最小权限原则（仅 SAM 部署所需权限）
- `NoEcho: true` 标记所有敏感 Parameter

### NFR-2: 可维护性
- SAM 模板使用 `Description` 字段标注每个资源的用途
- 注释用中文标注需要手动替换的占位符及获取方式
- 环境变量与 `packages/env/src/server.ts` schema 一一对应

### NFR-3: 可复现
- `sam deploy` 使用 `--resolve-s3` 自动管理 S3 部署桶（无需预先创建）
- Stack Name 固定，支持幂等更新
- 使用 `--sanitize-template` 去除 AWS 账户特定信息

---

## 4. 验收标准 (AC)

### AC-1: SAM 模板语法验证
- 执行 `sam validate --lint`，无错误输出
- 执行 `sam build`，成功生成构建产物

### AC-2: GitHub Actions YAML 语法
- 通过 `actionlint` 或 GitHub UI 校验
- 所有 `${{ secrets.XXX }}` 引用在仓库 Settings 中存在

### AC-3: 环境变量完整性
- `template.yaml` 的 `Environment.Variables` 包含所有必需变量
- 与 `packages/env/src/server.ts` 的 zod schema 字段一致（或为其子集 + 新增变量）

### AC-4: 手动配置清单
- `design.md` 中包含完整的手动替换清单表格
- 每个占位符标注获取方式（AWS Console 路径或 CLI 命令）

---

## 5. 不在范围

- ❌ 不使用 API Gateway REST API（用 HTTP API，更快更便宜）
- ❌ 不创建新的 VPC / 子网 / RDS（已有，手动建好）
- ❌ 不配置自定义域名（ACM + Route53，后续按需添加）
- ❌ 不做蓝绿/金丝雀部署
- ❌ 不做 alarm / 自动扩缩容策略（后续按需）
- ❌ 不迁移到 ECS / EKS（保持 Lambda + API Gateway）
