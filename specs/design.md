# Design: GitHub Profile Sync Manager

**版本**：v2.0
**对应 PRD**：`docs/PRD.md`

---

## 1. 架构总览

```
┌─────────────┐         ┌────────────────┐        ┌──────────────┐
│  Browser    │  HTTPS  │ API Gateway    │        │ GitHub API   │
│  (SPA)      │ ──────► │ (HTTP API)     │ ─────► │ api.github.com│
│             │         └───────┬────────┘        └──────────────┘
└─────────────┘                 │
                                │ invoke
                       ┌────────▼────────┐
                       │ Lambda (Hono)   │
                       │ - REST routes   │
                       │ - fetch GitHub  │
                       │ - Drizzle ORM   │
                       └────────┬────────┘
                                │
                       ┌────────▼────────┐
                       │ RDS PostgreSQL  │
                       │ (私有子网 B)     │
                       └─────────────────┘
```

**前端 SPA**：打包到 S3，通过 CloudFront 分发。

## 2. 数据模型（Drizzle Schema）

**文件**：`packages/db/src/schema/github.ts`

```typescript
import { pgTable, text, integer, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const githubProfiles = pgTable(
  "github_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: integer("github_id").notNull(),
    username: text("username").notNull(),
    avatarUrl: text("avatar_url").notNull(),
    bio: text("bio"),
    publicRepos: integer("public_repos").notNull().default(0),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_profiles_github_id_idx").on(table.githubId),
  ],
);
```

**简化说明**：无 `user_id` FK（作业不需要多用户/登录）。只存一条 GitHub profile。

## 3. 读写终节点

### Reader（`packages/db/src/github/reader.ts`）

```typescript
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubReader = {
  get: async () => {
    const [row] = await db.select().from(githubProfiles).limit(1);
    return row ?? null;
  },
};
```

### Writer（`packages/db/src/github/writer.ts`）

```typescript
import { eq } from "drizzle-orm";
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubWriter = {
  upsert: async (input: {
    githubId: number;
    username: string;
    avatarUrl: string;
    bio: string | null;
    publicRepos: number;
  }) => {
    const now = new Date();
    const [row] = await db
      .insert(githubProfiles)
      .values({ ...input, syncedAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: githubProfiles.githubId,
        set: {
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
  },

  deleteAll: async () => {
    await db.delete(githubProfiles);
    return { success: true };
  },
};
```

## 4. Hono REST API

**文件**：`apps/server/src/index.ts`

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { githubReader, githubWriter } from "@taskaws/db";

const app = new Hono();

app.use("/*", cors({ origin: "*" }));

// POST /api/github/sync
app.post("/api/github/sync", async (c) => {
  const { pat } = await c.req.json<{ pat: string }>();
  
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `token ${pat}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "TaskAWS/1.0",
    },
  });
  
  if (!res.ok) return c.json({ error: "Invalid GitHub PAT" }, 400);
  
  const ghUser = await res.json() as {
    id: number; login: string; avatar_url: string;
    bio: string | null; public_repos: number;
  };
  
  const profile = await githubWriter.upsert({
    githubId: ghUser.id,
    username: ghUser.login,
    avatarUrl: ghUser.avatar_url,
    bio: ghUser.bio,
    publicRepos: ghUser.public_repos,
  });
  
  return c.json(profile);
});

// GET /api/github/user
app.get("/api/github/user", async (c) => {
  const profile = await githubReader.get();
  return c.json({ profile });
});

// DELETE /api/github/user
app.delete("/api/github/user", async (c) => {
  await githubWriter.deleteAll();
  return c.json({ success: true });
});

export default app;
```

## 5. SAM 模板（AWS 部署）

**文件**：`template.yaml`

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    VpcConfig:
      SubnetIds:
        - !Ref PrivateSubnetA
        - !Ref PrivateSubnetB
      SecurityGroupIds:
        - !Ref LambdaSecurityGroup

Resources:
  # === 网络层 ===
  VPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsSupport: true
      EnableDnsHostnames: true

  InternetGateway:
    Type: AWS::EC2::InternetGateway

  AttachGateway:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref VPC
      InternetGatewayId: !Ref InternetGateway

  # 公有子网（NAT Gateway）
  PublicSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: 10.0.0.0/24
      MapPublicIpOnLaunch: true

  NatEIP:
    Type: AWS::EC2::EIP
    Properties:
      Domain: vpc

  NatGateway:
    Type: AWS::EC2::NatGateway
    Properties:
      SubnetId: !Ref PublicSubnet
      AllocationId: !GetAtt NatEIP.AllocationId

  # 私有子网 A（Lambda）
  PrivateSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: 10.0.1.0/24

  # 私有子网 B（RDS）
  PrivateSubnetB:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: 10.0.2.0/24

  # 路由表
  PublicRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref VPC

  PublicRoute:
    Type: AWS::EC2::Route
    DependsOn: AttachGateway
    Properties:
      RouteTableId: !Ref PublicRouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref InternetGateway

  PrivateRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref VPC

  PrivateRoute:
    Type: AWS::EC2::Route
    Properties:
      RouteTableId: !Ref PrivateRouteTable
      DestinationCidrBlock: 0.0.0.0/0
      NatGatewayId: !Ref NatGateway

  # === 安全组 ===
  LambdaSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Lambda → RDS access
      VpcId: !Ref VPC
      SecurityGroupEgress:
        - CidrIp: 0.0.0.0/0

  RdsSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: RDS access from Lambda
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - FromPort: 5432
          ToPort: 5432
          IpProtocol: tcp
          SourceSecurityGroupId: !Ref LambdaSecurityGroup

  # === 数据库 ===
  DBSubnetGroup:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: RDS subnet group
      SubnetIds:
        - !Ref PrivateSubnetA
        - !Ref PrivateSubnetB

  Database:
    Type: AWS::RDS::DBInstance
    Properties:
      Engine: postgres
      EngineVersion: "15"
      DBInstanceClass: db.t3.micro
      AllocatedStorage: 20
      MasterUsername: !Sub "{{resolve:secretsmanager:${DBSecret}::username}}"
      MasterUserPassword: !Sub "{{resolve:secretsmanager:${DBSecret}::password}}"
      DBSubnetGroupName: !Ref DBSubnetGroup
      VPCSecurityGroups:
        - !Ref RdsSecurityGroup
      MultiAZ: false

  DBSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      GenerateSecretString:
        SecretStringTemplate: '{"username":"admin"}'
        GenerateStringKey: password
        PasswordLength: 32

  # === Lambda ===
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      CodeUri: apps/server/
      Environment:
        Variables:
          DATABASE_URL: !Sub
            - postgresql://${username}:${password}@${host}:5432/taskaws
            - username: !Sub "{{resolve:secretsmanager:${DBSecret}::username}}"
              password: !Sub "{{resolve:secretsmanager:${DBSecret}::password}}"
              host: !GetAtt Database.Endpoint.Address

  ApiGateway:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: prod

  # === 前端静态托管 ===
  WebBucket:
    Type: AWS::S3::Bucket

  WebDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Origins:
          - DomainName: !GetAtt WebBucket.DomainName
            Id: S3Origin
            S3OriginConfig: {}
        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: redirect-to-https
          ForwardedValues:
            QueryString: false
        DefaultRootObject: index.html
        Enabled: true

Outputs:
  ApiUrl:
    Value: !Sub "https://${ApiGateway}.execute-api.${AWS::Region}.amazonaws.com/prod"
  WebUrl:
    Value: !Sub "https://${WebDistribution.DomainName}"
```

## 6. GitHub Actions CI/CD

**文件**：`.github/workflows/deploy.yml`

```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm db:generate

      - run: sam build
      - run: sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
```

## 7. 前端状态机

```
┌────────────┐
│  Empty     │ ◄── 初始 / 删除后
└─────┬──────┘
      │ POST /api/github/sync
      ▼
┌────────────┐
│  Loading   │ (按钮 spinner)
└─────┬──────┘
      │ 成功
      ▼
┌────────────┐
│  Profile   │ ── DELETE ──► confirm ──► Empty
└────────────┘
```

挂载时 `GET /api/github/user`：有数据 → Profile，无数据 → Empty。

## 8. 安全考量

| 风险 | 缓解 |
|------|------|
| PAT 泄露 | 仅透传给 GitHub API，不落库 |
| DB 凭据 | Secrets Manager，不硬编码 |
| VPC 隔离 | Lambda + RDS 在私有子网，无公网 IP |
| GitHub Actions | IAM OIDC（无长期 AK/SK） |
