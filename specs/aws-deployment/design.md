# Design: AWS SAM 部署架构

**版本**：v1.0
**日期**：2026-06-28
**状态**：Draft

> 对应 [requirements.md](requirements.md)，定义 IaC 模板结构、构建流水线和手动配置项。

---

## 1. 整体架构

```
GitHub (main branch)
  │ git push
  ▼
GitHub Actions (.github/workflows/deploy.yml)
  │
  ├── [1] pnpm install + build:api (esbuild → dist/lambda.mjs)
  │
  └── [2] sam build → sam deploy
           │
           ▼
  ┌─────────────────────────────────────────┐
  │            AWS CloudFormation            │
  │  Stack: github-sync-deploy-stack         │
  │                                          │
  │  ┌──────────────────────────────────┐   │
  │  │  AWS::Serverless::Api (HTTP API)  │   │
  │  │  Route: ANY /{proxy+}             │   │
  │  └──────────┬───────────────────────┘   │
  │             │ trigger                     │
  │  ┌──────────▼───────────────────────┐   │
  │  │  AWS::Serverless::Function        │   │
  │  │  Runtime: nodejs20.x              │   │
  │  │  Handler: lambda.handler          │   │
  │  │  VpcConfig:                       │   │
  │  │    SubnetIds: [subnet-a, subnet-b]│   │
  │  │    SecurityGroupIds: [sg-lambda]  │   │
  │  │  Env:                             │   │
  │  │    DATABASE_WRITER_URL            │   │
  │  │    DATABASE_READER_URL            │   │
  │  │    BETTER_AUTH_SECRET             │   │
  │  │    BETTER_AUTH_URL                │   │
  │  │    CORS_ORIGIN                    │   │
  │  └──────────┬───────────────────────┘   │
  │             │ outbound :5432              │
  │  ┌──────────▼───────────────────────┐   │
  │  │  AWS::EC2::SecurityGroup          │   │
  │  │  GroupDescription: Lambda→RDS     │   │
  │  │  VpcId: !Ref VpcId                │   │
  │  │  Egress: TCP 5432 → 0.0.0.0/0    │   │
  │  └──────────────────────────────────┘   │
  │                                          │
  │  ┌──────────────────────────────────┐   │
  │  │       Existing (手动创建)          │   │
  │  │  VPC (10.0.0.0/16)                │   │
  │  │  ├── Public Subnet + NAT GW       │   │
  │  │  ├── Private Subnet A             │   │
  │  │  ├── Private Subnet B             │   │
  │  │  └── RDS Cluster                  │   │
  │  │       ├── Writer Endpoint          │   │
  │  │       └── Reader Endpoint          │   │
  │  └──────────────────────────────────┘   │
  └─────────────────────────────────────────┘
```

---

## 2. SAM 模板设计 (`template.yaml`)

### 2.1 文件结构

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Parameters:        # 所有需要手动替换/外部注入的变量
  VpcId:           # VPC ID
  SubnetA:         # 私有子网 A
  SubnetB:         # 私有子网 B
  DatabaseWriterUrl:  # 数据库写连接串（NoEcho）
  DatabaseReaderUrl:  # 数据库读连接串（NoEcho）
  BetterAuthSecret:   # 认证密钥（NoEcho）
  BetterAuthUrl:      # API Gateway URL → 首次部署后回填
  CorsOrigin:         # 前端域名

Resources:
  LambdaSecurityGroup:  # AWS::EC2::SecurityGroup
  LambdaFunction:       # AWS::Serverless::Function
  HttpApi:              # AWS::Serverless::Api

Outputs:
  ApiUrl:               # API Gateway Invoke URL
  LambdaFunctionName:   # Lambda 函数名
```

### 2.2 Parameters 设计

| 参数名 | 类型 | NoEcho | 默认值 | 说明 |
|--------|------|--------|--------|------|
| `VpcId` | String | — | — | **手动替换**：VPC ID |
| `SubnetA` | String | — | — | **手动替换**：私有子网 A ID |
| `SubnetB` | String | — | — | **手动替换**：私有子网 B ID |
| `DatabaseWriterUrl` | String | ✅ | — | RDS Writer Endpoint 完整连接串，通过 GitHub Secrets → `sam deploy --parameter-overrides` 传入 |
| `DatabaseReaderUrl` | String | ✅ | — | RDS Reader Endpoint 完整连接串 |
| `BetterAuthSecret` | String | ✅ | — | `openssl rand -base64 32` 生成 |
| `BetterAuthUrl` | String | — | — | 首次部署后通过 Output `ApiUrl` 回填 |
| `CorsOrigin` | String | — | `*` | 生产应设为前端实际域名 |

### 2.3 Lambda 函数配置

```yaml
LambdaFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Sub "${AWS::StackName}-hono-api"
    Runtime: nodejs20.x
    Architectures: [arm64]
    Handler: lambda.handler
    CodeUri: apps/server/dist/
    MemorySize: 512
    Timeout: 30
    Environment:
      Variables:
        DATABASE_WRITER_URL: !Ref DatabaseWriterUrl
        DATABASE_READER_URL: !Ref DatabaseReaderUrl
        BETTER_AUTH_SECRET: !Ref BetterAuthSecret
        BETTER_AUTH_URL: !Ref BetterAuthUrl
        CORS_ORIGIN: !Ref CorsOrigin
        NODE_ENV: "production"
    VpcConfig:
      SubnetIds: [!Ref SubnetA, !Ref SubnetB]
      SecurityGroupIds: [!GetAtt LambdaSecurityGroup.GroupId]
    Events:
      HttpApiProxy:
        Type: HttpApi
        Properties:
          ApiId: !Ref HttpApi
          Path: /{proxy+}
          Method: ANY
```

### 2.4 安全组配置

```yaml
LambdaSecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: "Allow Lambda outbound to RDS PostgreSQL"
    VpcId: !Ref VpcId
    SecurityGroupEgress:
      - IpProtocol: tcp
        FromPort: 5432
        ToPort: 5432
        CidrIp: 0.0.0.0/0
        Description: "PostgreSQL access to RDS"
```

> **注意**：`CidrIp: 0.0.0.0/0` 允许出站到任意 IP 的 5432 端口，实际受 RDS SecurityGroup 入站规则限制。更严格的做法是将其限制为 RDS 所在子网的 CIDR，但对已有手动配置的环境，0.0.0.0/0 配合 RDS SG 入站规则更灵活。

### 2.5 API Gateway 配置

```yaml
HttpApi:
  Type: AWS::Serverless::Api
  Properties:
    StageName: prod
    CorsConfiguration:
      AllowMethods: [GET, POST, OPTIONS]
      AllowHeaders: [Content-Type, Authorization]
      AllowOrigins: [!Ref CorsOrigin]
```

---

## 3. Lambda Handler 设计

### 3.1 代码拆分

当前 `apps/server/src/index.ts` 包含 `app` 创建 + `serve()` 监听。需拆分为：

```
apps/server/src/
├── app.ts          # createApp(): Hono → 纯 app 构建（中间件 + 路由）
├── index.ts        # 本地开发：import { createApp } from "./app" + serve()
└── lambda.ts       # Lambda 部署：import { handle } from "hono/aws-lambda" + createApp()
```

### 3.2 lambda.ts 设计

```typescript
// apps/server/src/lambda.ts
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp();
export const handler = handle(app);
```

`hono/aws-lambda` 的 `handle()` 函数自动：
- 解析 API Gateway HTTP API v2 事件
- 构造 Hono `Request`
- 调用 app 路由匹配
- 将 Hono `Response` 转换为 Lambda 响应格式

### 3.3 环境变量双源

Lambda 环境变量注入 vs 本地 `.env` 文件：

| 场景 | 读取方式 |
|------|----------|
| 本地开发 | `dotenv/config` + `apps/server/.env` → `@taskaws/env/server` |
| Lambda 部署 | `template.yaml` `Environment.Variables` → `process.env` → `@taskaws/env/server` |

`@taskaws/env/server` 对两种场景一致，无需修改代码。只需确保 env schema 包含 Lambda 注入的所有变量。

---

## 4. esbuild 构建设计

### 4.1 构建配置

```jsonc
// apps/server/package.json
{
  "scripts": {
    "build:api": "esbuild src/lambda.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/lambda.mjs --external:@aws-sdk/*"
  }
}
```

关键参数：
- `--bundle`: 打包所有依赖到单文件
- `--platform=node --target=node20`: 使用 Node.js 20 API
- `--format=esm`: ESM 输出（与项目 `"type": "module"` 一致）
- `--external:@aws-sdk/*`: AWS SDK 已内置在 Lambda 运行时，无需打包
- `--outfile=dist/lambda.mjs`: 输出到 `dist/`

### 4.2 devDependencies

需在 `apps/server/package.json` 的 `devDependencies` 中添加 `esbuild`：

```json
"devDependencies": {
  "esbuild": "^0.25.0"
}
```

---

## 5. GitHub Actions 设计

### 5.1 工作流文件结构

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build:api
      - uses: aws-actions/configure-aws-credentials@v4
      - uses: aws-actions/setup-sam@v2
      - run: sam build
      - run: sam deploy --no-confirm-changeset --resolve-s3 --capabilities CAPABILITY_IAM
```

### 5.2 必需 GitHub Secrets

| Secret 名 | 说明 |
|-----------|------|
| `AWS_ACCESS_KEY_ID` | AWS IAM 用户 Access Key |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM 用户 Secret Key |
| `AWS_REGION` | 目标区域（如 `us-east-1`） |
| `DATABASE_WRITER_URL` | SAM 部署时通过 `--parameter-overrides` 传入 |
| `DATABASE_READER_URL` | 同上 |
| `BETTER_AUTH_SECRET` | 同上 |

### 5.3 SAM Deploy 参数说明

```bash
sam deploy \
  --no-confirm-changeset \       # 自动确认变更集
  --resolve-s3 \                 # 自动创建/使用 SAM 托管 S3 桶
  --capabilities CAPABILITY_IAM \ # 允许创建 IAM 相关资源
  --stack-name github-sync-deploy-stack \
  --parameter-overrides \
    VpcId=vpc-xxx \
    SubnetA=subnet-xxx \
    SubnetB=subnet-xxx \
    DatabaseWriterUrl="${{ secrets.DATABASE_WRITER_URL }}" \
    DatabaseReaderUrl="${{ secrets.DATABASE_READER_URL }}" \
    BetterAuthSecret="${{ secrets.BETTER_AUTH_SECRET }}" \
    BetterAuthUrl="https://xxx.execute-api.region.amazonaws.com" \
    CorsOrigin="${{ secrets.CORS_ORIGIN }}"
```

---

## 6. 环境变量 Schema 扩展

### 6.1 新增 server env 变量

`packages/env/src/server.ts` 需补充 Lambda 部署涉及的变量：

```typescript
export const env = createEnv({
  server: {
    // 现有
    DATABASE_URL: z.string().min(1).optional(),  // 改为 optional（读写分离后不用）
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.string().min(1),              // 从 z.url() 放宽（Lambda URL 可能不是完整 http URL）
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // 新增 — Lambda 读写分离
    DATABASE_WRITER_URL: z.string().min(1).optional(),
    DATABASE_READER_URL: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
```

### 6.2 前端 env（不变）

前端只需 `VITE_SERVER_URL`，指向 API Gateway URL。不需要新增。

---

## 7. 手动配置清单

> **⚠️ 部署前必须替换以下占位符。**

| # | 占位符 | 所在文件 | 获取方式 |
|---|--------|----------|----------|
| 1 | `VpcId` | `template.yaml` Parameters | AWS Console → VPC → Your VPC → Details → VPC ID（如 `vpc-0abc123def456`） |
| 2 | `SubnetA` | `template.yaml` Parameters | AWS Console → VPC → Subnets → 私有子网 1 → Subnet ID（如 `subnet-0a1b2c3d`） |
| 3 | `SubnetB` | `template.yaml` Parameters | AWS Console → VPC → Subnets → 私有子网 2 → Subnet ID |
| 4 | `DATABASE_WRITER_URL` | GitHub Secrets / sam deploy `--parameter-overrides` | AWS Console → RDS → Cluster → Endpoints → Writer（格式：`postgresql://user:pass@host:5432/db`） |
| 5 | `DATABASE_READER_URL` | GitHub Secrets / sam deploy `--parameter-overrides` | AWS Console → RDS → Cluster → Endpoints → Reader |
| 6 | `BETTER_AUTH_SECRET` | GitHub Secrets | 终端执行 `openssl rand -base64 32` |
| 7 | `BETTER_AUTH_URL` | `template.yaml` → Parameter 默认值 | 首次部署后从 CloudFormation Outputs 获取 `ApiUrl`，回填后再次部署 |
| 8 | `CORS_ORIGIN` | GitHub Secrets | 前端实际域名（本地 `http://localhost:5173`，生产为 CloudFront/S3 URL） |
| 9 | `AWS_ACCESS_KEY_ID` | GitHub Secrets → Settings → Secrets | IAM 用户 Access Key（需 SAM + S3 + CloudFormation 权限） |
| 10 | `AWS_SECRET_ACCESS_KEY` | GitHub Secrets → Settings → Secrets | IAM 用户 Secret Key |
| 11 | `AWS_REGION` | GitHub Secrets | 与 VPC/RDS 所在区域一致（如 `us-east-1`） |
| 12 | `FRONTEND_BUCKET` | `.github/workflows/deploy.yml`（可选） | S3 桶名，用于前端静态文件同步 |

---

## 8. 数据库连接串格式

```
postgresql://<username>:<password>@<endpoint-host>:5432/<database-name>
```

示例：
```
# Writer
DATABASE_WRITER_URL=postgresql://postgres:MySecretPass@rds-writer.cluster-xxx.us-east-1.rds.amazonaws.com:5432/taskaws

# Reader
DATABASE_READER_URL=postgresql://postgres:MySecretPass@rds-reader.cluster-xxx.us-east-1.rds.amazonaws.com:5432/taskaws
```

> **安全提示**：连接串含明文密码。生产环境建议使用 AWS Secrets Manager 存储凭据，Lambda 启动时通过 SDK 获取。当前阶段为简化配置，通过 GitHub Secrets + SAM Parameter 传递，后续可升级为 Secrets Manager 方案。
