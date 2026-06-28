# Tasks: AWS SAM 部署与 GitHub Actions 自动化

**版本**：v1.0
**日期**：2026-06-28
**依赖**：`github-sync-rw` 所有 task 完成后才能开始

---

## 依赖关系

```
github-sync-rw (T1-T15)
    │
    └── AWS 部署
         ├── T1: env schema 扩展
         │     │
         │     ▼
         ├── T2: 拆分 app.ts + lambda.ts
         │     │
         │     ▼
         ├── T3: esbuild build:api 脚本
         │     │
         │     ▼
         ├── T4: template.yaml (SAM)
         │     │
         │     ▼
         ├── T5: samconfig.toml
         │     │
         │     ▼
         ├── T6: deploy.yml (GitHub Actions)
         │     │
         │     ▼
         └── T7: 验证 + 文档
```

> 无依赖的任务可并行执行（如 T3 和 T4 可同时进行）。

---

## Task 清单

### T1: 扩展环境变量 Schema
**目录**：`packages/env/src/server.ts`

- [ ] 新增 `DATABASE_WRITER_URL`：`z.string().min(1).optional()`
- [ ] 新增 `DATABASE_READER_URL`：`z.string().min(1).optional()`
- [ ] 将现有 `DATABASE_URL` 改为 `.optional()`（平滑过渡，不直接删除）
- [ ] 将 `CORS_ORIGIN` 从 `z.url()` 放宽为 `z.string().min(1)`（Lambda URL 可能含路径段，`z.url()` 可能 reject）

**验收**：`pnpm check-types` 在 `packages/env` 通过

**负责**：DB

---

### T2: 拆分 Hono app 为可复用模块
**目录**：`apps/server/src/`

- [ ] 创建 `app.ts`：将 `index.ts` 中的 app 构建逻辑（Hono 实例化、中间件、路由注册）提取为 `export function createApp()`
- [ ] 改写 `index.ts`：`import { createApp } from "./app"` + `serve()`
- [ ] 创建 `lambda.ts`：`import { handle } from "hono/aws-lambda"` + `createApp()` → `export const handler = handle(app)`
- [ ] 确认 `hono/aws-lambda` 在 `hono@^4.8` 中已内置，无需额外安装

**验收**：
- `pnpm dev:server` 本地正常启动，功能不变
- `pnpm check-types` 在 `apps/server` 通过

**负责**：BE

---

### T3: 配置 esbuild 构建脚本
**目录**：`apps/server/`

- [ ] 在 `apps/server/package.json` 的 `devDependencies` 添加 `esbuild`
- [ ] 新增脚本 `"build:api": "esbuild src/lambda.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/lambda.mjs --external:@aws-sdk/*"`
- [ ] 根目录 `package.json` 新增 `"build:api": "turbo -F server build:api"`
- [ ] 根目录 `package.json` 新增 `"sam:build": "sam build"`

**验收**：
- `pnpm run build:api` 成功生成 `apps/server/dist/lambda.mjs`
- 产物文件包含完整 Hono 依赖，无运行时 `import` 报错

**负责**：BE

---

### T4: 生成 AWS SAM 模板
**目录**：项目根目录

- [ ] 创建 `template.yaml`，包含：
  - **Parameters**（8 个）：`VpcId`、`SubnetA`、`SubnetB`、`DatabaseWriterUrl`、`DatabaseReaderUrl`、`BetterAuthSecret`、`BetterAuthUrl`、`CorsOrigin`
    - 敏感参数标 `NoEcho: true`
    - 每个参数的 `Description` 用中文标注用途和获取方式
    - `Default` 字段用占位符标记（如 `"PLACEHOLDER_replace_with_your_vpc_id"`）
  - **LambdaSecurityGroup**（`AWS::EC2::SecurityGroup`）：
    - `VpcId: !Ref VpcId`
    - Egress 允许 TCP 5432
    - 中文注释标注：此 SG 需与 RDS 的 SG 配对（RDS SG 入站规则允许此 SG 访问）
  - **LambdaFunction**（`AWS::Serverless::Function`）：
    - `Runtime: nodejs20.x`
    - `Architectures: [arm64]`
    - `Handler: lambda.handler`
    - `CodeUri: apps/server/dist/`
    - `VpcConfig` 引用 `SubnetA`、`SubnetB`、`LambdaSecurityGroup`
    - `Environment.Variables` 映射 6 个环境变量
    - `HttpApi` 事件触发器 `/{proxy+}`
    - 中文注释标注哪些参数需在首次部署前替换为真实 AWS 资源 ID
  - **HttpApi**（`AWS::Serverless::Api`）：
    - `StageName: prod`
    - CORS 配置引用 `CorsOrigin`
  - **Outputs**：`ApiUrl`、`LambdaFunctionName`
- [ ] 每个资源加 `Description` 字段，中文说明用途

**验收**：
- `sam validate --lint` 无错误
- 人工复查：所有 `!Ref` 引用的 Parameter 均已定义

**负责**：BE

---

### T5: 配置 SAM 部署参数
**目录**：项目根目录

- [ ] 创建 `samconfig.toml`，预设 stack_name 和常用参数：
  ```toml
  version = 0.1
  [default.deploy.parameters]
  stack_name = "github-sync-deploy-stack"
  resolve_s3 = true
  capabilities = "CAPABILITY_IAM"
  no_confirm_changeset = true
  ```
- [ ] `.gitignore` 确认 `samconfig.toml` **已提交**（含非敏感默认值），敏感覆盖值通过 CI 的 `--parameter-overrides` 传入

**验收**：
- 本地执行 `sam build` 成功
- `.gitignore` 不含 `samconfig.toml`

**负责**：BE

---

### T6: 编写 GitHub Actions 工作流
**目录**：`.github/workflows/`

- [ ] 创建 `.github/workflows/deploy.yml`：
  - **触发**：`push` to `branches: [main]`
  - **Job `deploy`**（`runs-on: ubuntu-latest`）：
    1. `actions/checkout@v4`
    2. `actions/setup-node@v4`（`node-version: 20`）
    3. `pnpm/action-setup@v2`
    4. `run: pnpm install --frozen-lockfile`
    5. `run: pnpm run build:api`
    6. `aws-actions/configure-aws-credentials@v4`（`aws-region: ${{ secrets.AWS_REGION }}`）
    7. `aws-actions/setup-sam@v2`
    8. `run: sam build`
    9. `run: sam deploy --parameter-overrides "VpcId=${{ secrets.VPC_ID }} SubnetA=${{ secrets.SUBNET_A }} SubnetB=${{ secrets.SUBNET_B }} DatabaseWriterUrl=${{ secrets.DATABASE_WRITER_URL }} DatabaseReaderUrl=${{ secrets.DATABASE_READER_URL }} BetterAuthSecret=${{ secrets.BETTER_AUTH_SECRET }} BetterAuthUrl=${{ secrets.BETTER_AUTH_URL }} CorsOrigin=${{ secrets.CORS_ORIGIN }}"`
  - **可选**：前端 S3 同步步骤（`run: pnpm run build:web` + `aws s3 sync`）
- [ ] YAML 中用注释标注每个 `secrets.XXX` 的说明

**验收**：
- `.github/workflows/deploy.yml` 通过 `actionlint` 语法检查（或 GitHub UI 编辑器检查）
- 所有 `${{ secrets.XXX }}` 引用与仓库 Settings → Secrets 名称一致

**负责**：BE

---

### T7: 验证与文档
**目录**：全项目

- [ ] 本地 `sam validate --lint` 验证模板语法
- [ ] 本地 `sam build` 验证构建流程（产生 `.aws-sam/` 目录）
- [ ] 确认 `.gitignore` 排除 `.aws-sam/`（构建产物不提交）
- [ ] 人工核对：`template.yaml` 中所有占位符均有注释说明获取方式
- [ ] 人工核对：GitHub Actions Secrets 列表与 `deploy.yml` 中引用一致
- [ ] 更新 `.gitignore`（如需要）

**验收**：
- `sam build` 成功，`sam validate --lint` 通过
- 代码 review 通过（模板注释完整、占位符清晰）

**负责**：QA

---

## 并发策略

```
T1 (env schema)
    │
    ▼
T2 (app.ts/lambda.ts)
    │
    ├── T3 (esbuild 脚本)  ← 可与 T4/T5 并行
    │
    └── T4 (template.yaml)  ← 可与 T3 并行
         │
         └── T5 (samconfig.toml)
              │
              └── T6 (deploy.yml)  ← 可与 T7 并行
                   │
                   └── T7 (验证)
```

**建议并行组**：
- **Group A**：T3 + T4（两个文件无依赖，同时写）
- **Group B**：T6 + T7（deploy.yml 完成后即可验证）

---

## 手动替换提示（部署前必读）

以下参数在 `template.yaml` 中用 `PLACEHOLDER_` 前缀标记，部署前必须替换：

| 参数 | template.yaml 占位符 | 替换为 |
|------|---------------------|--------|
| VpcId | `PLACEHOLDER_replace_with_your_vpc_id` | 真实 VPC ID（如 `vpc-0abc123def456`） |
| SubnetA | `PLACEHOLDER_replace_with_your_subnet_a_id` | 私有子网 A ID（如 `subnet-0a1b2c3d`） |
| SubnetB | `PLACEHOLDER_replace_with_your_subnet_b_id` | 私有子网 B ID（如 `subnet-0e4f5g6h`） |

其余敏感参数（数据库连接串、密钥）通过 GitHub Actions Secrets + `--parameter-overrides` 在 CI 中动态注入，不在 `template.yaml` 中写死。
