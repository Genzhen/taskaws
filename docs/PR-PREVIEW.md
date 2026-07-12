# Go 版本 PR 预览环境 — 搭建指南

> Phase 3 手册。为每个 open PR 自动拉起一套临时预览：后端 Go 服务走 **Cloudflare Tunnel** 暴露，前端走 **Cloudflare Pages**，**CodeBuild** 编排构建 / 部署 / 销毁，全程 3 个 IAM 角色隔离权限。
>
> 本指南是「照着敲就能跑」的 runbook，所有 `aws` 命令均可直接复制（需替换的占位符用 `<...>` 标出）。

---

## 0. 前提 & 架构

### 前提

- **Phase 2 已完成**：prod 栈 `taskaws-go` 已部署成功（Go intro 微服务跑在 ECS Fargate 上，CloudMap 注册名 `intro.taskaws.local`）。
- 预览栈 `taskaws-go-pr-<N>` 复用 Phase 2 的共享资源：
  - ECS 集群（`taskaws-go`）
  - CloudMap 私有命名空间 `taskaws.local`
  - 2 个公有子网（prod 栈新建的 `10.0.20.0/24` + `10.0.21.0/24`，连 IGW `igw-0325e75afae3aa258`）
  - ECR 仓库 `taskaws-go`（PR 镜像用 `pr-<N>` tag 推到**同一仓库**）
- 已安装并配置好 `aws` CLI（账号 **977778967406**，region **us-east-1**）。

查 prod 栈共享输出（确认 Phase 2 就绪 + 拿资源 ID）：

```bash
aws cloudformation describe-stacks \
  --stack-name taskaws-go \
  --query 'Stacks[0].Outputs' \
  --output table
```

期望看到 5 个输出：`AlbDnsUrl` / `EcrRepositoryUri` / `CloudMapServiceArn` / `EcsServiceName` / `CloudMapDnsName`。其中 `EcrRepositoryUri` 应为 `977778967406.dkr.ecr.us-east-1.amazonaws.com/taskaws-go`。

### 架构

```
 GitHub PR push / close
        │
        ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ CodeBuild（GitHub webhook 触发，跑在 AWS 托管 VPC）          │
 │                                                             │
 │  创建/更新事件：                                              │
 │   1. docker buildx 构建 Go 镜像 → push ECR :pr-N tag        │
 │   2. cloudformation deploy taskaws-go-pr-N                  │
 │      （ALB + ECS task，复用集群 / 命名空间 / 公有子网）       │
 │   3. cloudflared quick tunnel → 暴露 ALB，得随机 trycf URL  │
 │   4. wrangler pages deploy 前端                              │
 │      （注入 VITE_INTRO_SERVICE_URL=<tunnel URL>）            │
 │   5. gh pr comment 贴 Preview backend / frontend 两个链接   │
 │                                                             │
 │  关闭事件：                                                   │
 │   • cloudformation delete-stack taskaws-go-pr-N             │
 │   • wrangler pages deployment 清理                           │
 └─────────────────────────────────────────────────────────────┘
```

要点：
- 后端用 **Cloudflare Quick Tunnel**（`cloudflared tunnel --url http://<ALB-内网DNS>`），每次构建随机一个 `*.trycloudflare.com` URL，零配置、无需 tunnel token。
- 前端走 **Cloudflare Pages**，项目 URL 稳定（`taskaws-go-preview.pages.dev`）；每次 push 部署一个新 deployment，评论里贴该 deployment 的预览 URL。
- 预览栈是**临时的**：PR 关闭即 `delete-stack`，ALB / ECS service / SG / log group 随栈销毁。

---

## 1.（一次性）部署 3 个 IAM 角色

预览环境用 3 个独立角色做权限隔离。预览栈通过 `template.yaml` 的 `TaskRoleArn` 参数复用第 3 个角色（绕开每栈自建 IAM，加快部署 + 收敛权限表面）。

```bash
aws cloudformation deploy \
  --stack-name taskaws-go-pr-roles \
  --template-file infra/go/pr-roles.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

读取 3 个角色 ARN（第 3 步配 CodeBuild 项目要用 Role1，buildspec 里要用 Role2 / Role3）：

```bash
aws cloudformation describe-stacks \
  --stack-name taskaws-go-pr-roles \
  --query 'Stacks[0].Outputs' \
  --output table
```

### 3 个角色各自职责

| 角色 | 信任主体（Principal） | 职责 |
|------|----------------------|------|
| **Role1 — CodeBuild 编排角色** | `codebuild.amazonaws.com` | 编排全流程：ECR push、CloudFormation `deploy` / `delete`、SSM 读参数、ECS `describe`、GitHub 评论。**`iam:PassRole` 只允许传 Role2、Role3** —— 这是安全边界。 |
| **Role2 — CloudFormation 执行角色** | `cloudformation.amazonaws.com` | CFN 代入它创建预览栈资源（ALB、target group、ECS service、SG ingress、log group 等）。权限限定在 `taskaws-go-pr-*` 资源名前缀，不能动 prod 栈。 |
| **Role3 — ECS Task 运行角色** | `ecs-tasks.amazonaws.com` | Fargate task 的 execution + task role（`template.yaml` 的 `TaskRoleArn` 同时填它）。execution 部分拉 ECR 镜像 + 写 CloudWatch Logs；task 部分按需给 RDS / SSM 读权限。 |

**PassRole 是核心安全边界**：Role1 的 `iam:PassRole` 资源锁定到 Role2、Role3 两个 ARN。这样即便 CodeBuild 的 buildspec 被篡改，攻击者也无处把更高权限的角色塞给 CFN / ECS —— 三个角色即预览环境的全部 IAM 表面。

---

## 2.（一次性）存 SSM 参数

CodeBuild 跑在 AWS 托管环境里，**读不了 GitHub Secrets** —— 所有敏感值放 SSM，buildspec 用 `aws ssm get-parameter` 取。账号 / region 已固定：

```bash
AWS_ACCT=977778967406
REGION=us-east-1

# 1. 数据库 reader URL（同 Phase 2 的 reader 端点，Go 服务走只读副本）
aws ssm put-parameter \
  --name /taskaws-go/pr/database-reader-url \
  --type SecureString \
  --value 'postgresql://<USER>:<PASS>@task-db-reader.cubc4sg8c4ux.us-east-1.rds.amazonaws.com:5432/postgres'

# 2. CORS —— 预览前端域名每次 deployment 变，先用 * 放行（仅预览环境）
aws ssm put-parameter \
  --name /taskaws-go/pr/cors-origin \
  --type String \
  --value '*'

# 3. Cloudflare API token（Pages 部署用，第 4 步获取后回填）
aws ssm put-parameter \
  --name /taskaws-go/pr/cloudflare/api-token \
  --type SecureString \
  --value '<CF_API_TOKEN>'

# 4. GitHub PAT（PR 评论回贴用）
aws ssm put-parameter \
  --name /taskaws-go/pr/gh-token \
  --type SecureString \
  --value '<GH_PAT>'
```

参数用途：

| 参数 | 注入到 | 用途 |
|------|--------|------|
| `database-reader-url` | Go 容器 `DATABASE_READER_URL` | 复用 Phase 2 reader 端点（读写分离）。**必须用 reader，不要用 writer。** |
| `cors-origin` | Go 容器 `CORS_ORIGIN` | 预览前端域名每次变，预览阶段用 `*` 放行（生产仍锁精确域名）。 |
| `cloudflare/api-token` | `wrangler` 鉴权 | 需 **Cloudflare Pages: Edit** + 账户读权限（见第 4 步）。 |
| `gh-token` | `gh pr comment` | 回贴预览链接，需 `repo` scope（私有仓）或 fine-grained 的 `Pull requests: Write`。 |

> **SecureString 解密**：CodeBuild 角色需 `ssm:GetParameter` + `kms:Decrypt`。用默认 `aws/ssm` 托管 key 时，SSM 取参数的权限自带 KMS 解密授权，无需额外配 KMS 策略。

buildspec 读参数片段：

```bash
DB_URL=$(aws ssm get-parameter \
  --name /taskaws-go/pr/database-reader-url \
  --with-decryption \
  --query 'Parameter.Value' --output text)
```

---

## 3.（一次性）创建 CodeBuild 项目 + GitHub Webhook

### 3.1 编辑 `infra/go/codebuild.json`

填关键字段：

- `name`：`taskaws-go-pr`
- `serviceRole`：第 1 步的 **Role1Arn**（CodeBuild 编排角色）
- `source.type`：`GITHUB`
- `source.location`：仓库 HTTPS URL，如 `https://github.com/<org>/<repo>.git`
- `source.buildspec`：留空 → 用仓库根 `buildspec.yml`（或 `source.buildSpec` 内联）
- `environment.type`：`LINUX_CONTAINER`
- `environment.image`：`aws/codebuild/standard:7.0`
- `environment.privilegedMode`：`true`（docker buildx 需要）
- `artifacts.type`：`NO_ARTIFACTS`

### 3.2 创建项目

```bash
aws codebuild create-project \
  --cli-input-json file://infra/go/codebuild.json
```

### 3.3 创建 webhook（PR 事件触发）

```bash
aws codebuild create-webhook \
  --project-name taskaws-go-pr \
  --filter-groups '[[{"type":"EVENT","pattern":"PULL_REQUEST_CREATED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_UPDATED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_REOPENED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_CLOSED"}]]'
```

四个 PR 事件各成一个 filter group：`CREATED` / `UPDATED` / `REOPENED` 触发构建 + 部署；`CLOSED` 触发 teardown。buildspec 据 `CODEBUILD_WEBHOOK_EVENT` 环境变量分支决定跑 build 还是跑 delete。

> **更简单的替代**：CodeBuild 控制台 → 项目 → Source → Connect to GitHub（OAuth），勾选这 4 个 PR 事件类型即可，不用手写 webhook filter JSON。控制台连 GitHub 的额外好处：webhook 自动注册，PR 页面能看到 CodeBuild check 状态。两种方式等价。

---

## 4.（一次性）Cloudflare 准备

### 4.1 建 API Token

Dashboard → My Profile → API Tokens → Create Token → Custom token，权限如下：

| 权限 | 级别 | 作用 |
|------|------|------|
| **Account · Cloudflare Pages · Edit** | Account | `wrangler pages deploy` / `deployment delete` |
| **Account · Account · Read** | Account | wrangler 启动时探测账户资源 |
| **User · User Details · Read** | User | wrangler 读取用户信息 |

Account Resources 限定到你的账户（**不要选 All accounts**）。生成后把 token 回填到第 2 步的 SSM `/taskaws-go/pr/cloudflare/api-token`。

### 4.2 Tunnel 方式说明

本指南默认 **Quick Tunnel**（`cloudflared tunnel --url <ALB-URL>`）：

- **零配置**：不需登录 Cloudflare、不需 tunnel token、不需预先建 tunnel。
- **代价**：URL 是随机 `*.trycloudflare.com`，且 cloudflared **进程退出即失效**（见第 6 步限制）。

**升级项 — 命名 Tunnel（耐久预览）**：若要让预览在 PR 存活期内持续可访问（不随 CodeBuild 退出失效），改用命名 tunnel + 固定 hostname：

1. `cloudflared tunnel create taskaws-go-pr-<N>`（需 token）。
2. 配 `<pr>.preview.example.com` CNAME 到 `<tunnel-id>.cfargotunnel.com`。
3. cloudflared 作为 **sidecar**（ECS task 第二个容器）常驻运行，随 task 存活。

命名 tunnel 列为升级路径，本 runbook 默认 quick tunnel。

---

## 5. 使用流程（开发者视角）

1. **开 PR** → CodeBuild 自动触发（`PULL_REQUEST_CREATED`）。
2. **约 5–8 分钟后**，PR 评论出现两个链接：
   - **Preview backend**：`https://<random>.trycloudflare.com`（该 PR 的 Go 后端）
   - **Preview frontend**：`https://<hash>.taskaws-go-preview.pages.dev`（Cloudflare Pages deployment）
3. **点 frontend URL** → 打开 `/intro` 预览页，前端调该 PR 的 Go 后端（`VITE_INTRO_SERVICE_URL` 已编译期注入 tunnel URL）。
4. **新 push 同一 PR** → `PULL_REQUEST_UPDATED` 触发重新构建，评论更新新 URL（Pages 项目名稳定，tunnel URL 换新）。
5. **关闭 / 合并 PR** → `PULL_REQUEST_CLOSED` 触发 teardown：`delete-stack taskaws-go-pr-<N>` + Pages deployment 清理。

开发者无需装任何本地工具，全部在 GitHub PR 界面完成。

---

## 6. 验证 / 排查

### 看构建日志

```bash
# 列最近 3 次构建
aws codebuild list-builds-for-project \
  --project-name taskaws-go-pr \
  --query 'ids[:3]'

# 拿构建状态 + 日志链接
aws codebuild batch-get-builds \
  --ids <build-id> \
  --query 'builds[0].{Status:buildStatus,Log:logs.deepLink}'
```

或直接 CodeBuild 控制台 → 项目 → Build history → 点 build ID 看完整日志。

### 查预览栈状态

```bash
# 把 <N> 换成 PR 号
aws cloudformation describe-stacks \
  --stack-name taskaws-go-pr-<N> \
  --query 'Stacks[0].[StackStatus,Outputs]' \
  --output table
```

`Outputs` 里抓 `AlbDnsUrl`（该 PR 的 ALB，tunnel 后端）和 `CloudMapDnsName`（`intro-pr-<N>.taskaws.local`，VPC 内解析）。

### cloudflared Quick Tunnel 限制（重要）

Quick tunnel 的 `trycloudflare.com` URL **只在 CodeBuild 构建进程存活期间有效** —— cloudflared 是构建里的前台 / 后台进程，构建结束它就退出，tunnel 随之失效。

后果：

- **构建窗口内可访问**：buildspec 跑完到 CodeBuild 终止之间的几分钟，tunnel URL 有效。
- **构建结束后失效**：点评论里的 backend URL 可能已不通。
- **重新 push 会重建**：新构建拉起新 tunnel，评论更新新 URL。

若团队需要「PR 开着就能随时访问」，升级到第 4.2 步的**命名 tunnel + sidecar cloudflared**（tunnel 跑在 ECS task 第二容器里，随 task 存活）。在那之前，预览主要靠构建窗口；Pages 项目 URL 本身是**稳定**的（`taskaws-go-preview.pages.dev`，不随构建失效），但前端 bundle 里编译期的 tunnel URL 失效后前端也调不通后端 —— 要持续可访问必须升级命名 tunnel。

---

## 7. 注意事项 / 坑 / 成本

### 成本

| 资源 | 单价 | 说明 |
|------|------|------|
| ALB（每个 open PR 1 个） | ≈ **$16 / 月** | LCU 费用另计，预览流量小可忽略 |
| Fargate task（0.5 vCPU + 1 GB） | ≈ **$14 / 月 / PR** | 按 730h 算 |
| CodeBuild | ≈ $0.01 / 分钟 | `build.general1.small`；每 PR 构建几次可忽略 |
| Cloudflare Pages | 免费 | 免费额度足够预览 |
| Quick Tunnel | 免费 | 命名 tunnel 也免费 |

**结论**：每个常开 PR ≈ **$30 / 月**（$16 ALB + $14 Fargate）。PR 多时考虑**升级项**：共享 ALB + 每 PR 一条 listener rule（按 host / path 路由），省掉 N 个 ALB 的 $16×N。

### CodeBuild 并发

- 默认并发 **20** 个构建；PR 超过 20 个会排队。
- 提限额：Service Quotas → AWS CodeBuild → Concurrently running builds。

### Teardown 依赖

- PR 关闭的清理**依赖 `PULL_REQUEST_CLOSED` webhook**。若 webhook 失效（GitHub 断连、OAuth token 过期），残留栈不会被清。
- **强烈建议**加一条 EventBridge 定时任务（每晚）兜底：扫描所有 `taskaws-go-pr-*` 栈，对没有对应 open PR 的执行 `delete-stack`。
- 扫描命令示意：

  ```bash
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --query "StackSummaries[?starts_with(StackName,\`taskaws-go-pr-\`)].StackName" \
    --output text
  ```

  逐个对 GitHub PR 状态校验后删除。

### CodeBuild 无需 VPC 配置

- CodeBuild 默认跑在 AWS 托管 VPC（有公网出口），只做 `push ECR` + `deploy CFN` + `wrangler`（公网）+ `gh`（公网），**不碰 RDS**。
- **不要**给 CodeBuild 配 VPC —— 加了反而要处理 NAT / SG，且拉 ECR 走公网更快。

### 其他坑

- **CloudMap 命名空间复用**：预览栈**绝不能**新建 `taskaws.local` namespace（会和 prod 冲突，CloudMap 同名 namespace 在同 VPC 唯一）—— 必须复用 prod 栈已建的。这是第 0 步强调「复用共享资源」的关键原因；落地时把 `template.yaml` 的 `CloudMapNamespace` 资源改成引用 prod 的 namespace ID（Cross-stack 引用或硬编码）。
- **ECR tag 清理**：PR 关闭只删栈，不删 ECR `pr-N` tag 镜像。靠 ECR lifecycle policy（template.yaml 已配 untagged 7 天过期）兜底，tagged 镜像按需手动清。
- **GitHub PAT 过期**：SSM 里的 `gh-token` 过期后 PR 评论静默失败（构建本身仍成功）。监控：构建日志里 `gh pr comment` 的退出码。

---

## 附录：buildspec 关键步骤（参考骨架）

```yaml
# buildspec.yml（仓库根）— 骨架，实际按 CODEBUILD_WEBHOOK_EVENT 分支
env:
  variables:
    AWS_ACCT: "977778967406"
    REGION: "us-east-1"
    REPO: "977778967406.dkr.ecr.us-east-1.amazonaws.com/taskaws-go"

phases:
  pre_build:
    commands:
      # 从 webhook payload 解析 PR 号
      - PR=<从 CODEBUILD_SOURCE_VERSION / CODEBUILD_WEBHOOK_HEAD_REF 解析>
      - STACK=taskaws-go-pr-$PR
      # 读 SSM 参数
      - DB_URL=$(aws ssm get-parameter --name /taskaws-go/pr/database-reader-url --with-decryption --query 'Parameter.Value' --output text)
      - CORS=$(aws ssm get-parameter --name /taskaws-go/pr/cors-origin --query 'Parameter.Value' --output text)
      - export CLOUDFLARE_API_TOKEN=$(aws ssm get-parameter --name /taskaws-go/pr/cloudflare/api-token --with-decryption --query 'Parameter.Value' --output text)
      - export GH_TOKEN=$(aws ssm get-parameter --name /taskaws-go/pr/gh-token --with-decryption --query 'Parameter.Value' --output text)
      # Role2 / Role3 ARN 从 pr-roles 栈输出取（或硬编码）
      - ROLE2_ARN=<CloudFormation 执行角色 ARN>
      - ROLE3_ARN=<ECS Task 运行角色 ARN>

  build:
    commands:
      - |
        case "$CODEBUILD_WEBHOOK_EVENT" in
          PULL_REQUEST_CLOSED)
            # teardown
            aws cloudformation delete-stack --stack-name $STACK
            # wrangler pages deployment 清理（按需）
            ;;
          *)
            # 1. build + push ECR（复用 taskaws-go 仓库，pr-N tag）
            aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $AWS_ACCT.dkr.ecr.$REGION.amazonaws.com
            docker build -f apps/intro-go/Dockerfile -t $REPO:pr-$PR .
            docker push $REPO:pr-$PR

            # 2. deploy 预览栈（传 PrId + TaskRoleArn 复用 Role3）
            aws cloudformation deploy --stack-name $STACK \
              --template-file infra/go/template.yaml \
              --capabilities CAPABILITY_NAMED_IAM \
              --role-arn $ROLE2_ARN \
              --parameter-overrides \
                PrId=$PR \
                TaskRoleArn=$ROLE3_ARN \
                ImageUrl=$REPO:pr-$PR \
                DatabaseReaderUrl="$DB_URL" \
                CorsOrigin="$CORS"

            # 3. 取 ALB URL + quick tunnel 暴露
            ALB=$(aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='AlbDnsUrl'].OutputValue" --output text)
            cloudflared tunnel --url "$ALB" > tunnel.log 2>&1 &
            TUNNEL_URL=<从 tunnel.log grep trycloudflare URL>

            # 4. 构建前端（注入 tunnel URL）+ Pages 部署
            VITE_INTRO_SERVICE_URL=$TUNNEL_URL pnpm --filter web build
            PAGES_URL=$(wrangler pages deploy apps/web/build/client --project-name taskaws-go-preview)

            # 5. PR 评论贴链接
            gh pr comment $PR --body "Preview backend: $TUNNEL_URL | frontend: $PAGES_URL"
            ;;
        esac
```

> 实际 buildspec 还需处理：`cloudflared` / `wrangler` / `gh` 的安装（`pre_build` 里 `npm i -g`）、tunnel URL 的解析时序（cloudflared 启动到打出 URL 有几秒延迟）、`pnpm` 缓存等。骨架只展示主干。
