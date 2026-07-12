# Go 版本 PR 预览环境 — 搭建指南

> Phase 3 手册。为每个 open PR 自动拉起一套临时预览：后端 Go 服务复用 **prod 栈的共享 ALB**（每 PR 一条 host-header ListenerRule），经 **Cloudflare Tunnel** 暴露，前端走 **Cloudflare Pages**，触发/鉴权走 **GitHub Actions + OIDC**（无长期 AWS 密钥），全程 IAM 角色隔离权限。
>
> 本指南是「照着敲就能跑」的 runbook，所有 `aws` 命令均可直接复制（需替换的占位符用 `<...>` 标出）。

---

## 0. 前提 & 架构

### 前提

- **Phase 2 已完成**：prod 栈 `taskaws-go` 已部署成功（Go intro 微服务跑在 ECS Fargate 上）。该栈现在**额外输出共享 ALB 资源**，每个 PR 的 ListenerRule 挂到这个 ALB 的 listener 上。
- 预览栈 `taskaws-go-pr-<N>` 复用 prod 栈的共享资源（**不再自建 ALB**）：
  - ECS 集群（`taskaws-go`，输出名 `EcsClusterName`）
  - CloudMap 私有命名空间 `taskaws.local`（输出名 `CloudMapNamespaceId`）
  - **共享 ALB 的 HTTP listener / SG / DNS**（输出名 `SharedAlbListenerArn` / `SharedAlbSecurityGroupId` / `SharedAlbDnsName`）
  - 2 个公有子网（`10.0.20.0/24` + `10.0.21.0/24`，连 IGW `igw-0325e75afae3aa258`）
  - ECR 仓库 `taskaws-go`（PR 镜像用 `pr-<N>` tag 推到**同一仓库**）
- 已安装并配置好 `aws` CLI（账号 **977778967406**，region **us-east-1**）。

查 prod 栈共享输出（确认 Phase 2 就绪 + 拿共享 ALB 资源 ID）：

```bash
aws cloudformation describe-stacks \
  --stack-name taskaws-go \
  --query 'Stacks[0].Outputs' \
  --output table
```

期望看到关键输出：`EcsClusterName` / `CloudMapNamespaceId` / `SharedAlbListenerArn` / `SharedAlbSecurityGroupId` / `SharedAlbDnsName` / `EcrRepositoryUri`（应为 `977778967406.dkr.ecr.us-east-1.amazonaws.com/taskaws-go`）。其中 `SharedAlbListenerArn` 就是每 PR 的 ListenerRule 挂载点。

### 架构

```
 GitHub PR (opened / synchronized / reopened / closed)
        │  OIDC: assume taskaws-go-pr-gh-oidc-role（无长期密钥）
        ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │ GitHub Actions（.github/workflows/pr-preview.yml）               │
 │                                                                  │
 │  创建/更新事件：                                                   │
 │   1. docker build --platform linux/amd64 → push ECR :pr-N       │
 │   2. cloudformation deploy taskaws-go-pr-N                      │
 │      （pr-template.yaml：TargetGroup + host-header ListenerRule  │
 │       挂到 prod 栈共享 ALB listener；复用集群/命名空间/子网；    │
 │       不再自建 ALB）                                             │
 │   3. cloudflared 暴露 pr-N.preview.taskaws.local                 │
 │      （命名 tunnel + 通配 DNS *.preview.taskaws.local → 共享 ALB）│
 │   4. wrangler pages deploy 前端                                  │
 │      （注入 VITE_INTRO_SERVICE_URL=pr-N.preview.taskaws.local）  │
 │   5. gh pr comment 贴 Preview backend / frontend 链接           │
 │      （用内置 GITHUB_TOKEN，无需 PAT）                           │
 │                                                                  │
 │  关闭事件：                                                       │
 │   • cloudformation delete-stack taskaws-go-pr-N                 │
 │   • wrangler pages project delete（best-effort）                 │
 └──────────────────────────────────────────────────────────────────┘
```

要点：
- **共享 ALB + host-header 路由**：每个 PR 不再创建独立 ALB，而是建一个 TargetGroup + 一条 ListenerRule（host `pr-<N>.preview.taskaws.local`，priority = PR 号），挂到 prod 栈的共享 ALB listener。省掉 N 个 ALB 的固定开销。
- **触发/鉴权**：GitHub Actions 通过 OIDC 直接代入 `taskaws-go-pr-gh-oidc-role`（无长期 AWS access key），role 的 `iam:PassRole` 只允许传 `pr-roles.yaml` 里预建的 cfn-role / task-role。
- **Cloudflare Tunnel**：reviewer 访问需要**通配 DNS + 命名 tunnel**（见 §1.6）。workflow 里还保留一个 `cloudflared tunnel --url` 的 ephemeral quick-tunnel 步骤作为可达性证明，但它**满足不了 host-header 路由**（quick tunnel 无法固定 Host 头，listener rule 不会命中）——真正的预览访问走命名 tunnel。
- 前端走 **Cloudflare Pages**，项目 URL 稳定（`taskaws-go-pr-<N>.pages.dev`）；每次 push 部署一个新 deployment，评论里贴该 deployment 的预览 URL。
- 预览栈是**临时的**：PR 关闭即 `delete-stack`，ListenerRule / TargetGroup / ECS service / SG / log group 随栈销毁；**共享 ALB / VPC / ECR 保留**。

---

## 1.（一次性）setup

### 1.1 部署 prod 栈（共享 ALB 的来源）

Phase 2 已完成。确认 `taskaws-go` 栈输出里含 `SharedAlbListenerArn` / `SharedAlbSecurityGroupId` / `SharedAlbDnsName`（见 §0 查询命令）。**共享 ALB 必须先存在**，否则 PR 栈的 ListenerRule 无处挂载（`AlbListenerArn` 参数空值 → CFN 报错）。

### 1.2 部署 `pr-roles.yaml`（cfn-role + task-role + codebuild-role）

预览环境用预建 IAM 角色做权限隔离。GHA 的 OIDC role 和 CodeBuild 替代方案都从这里取 `Role2Arn`（cfn-role）/ `Role3Arn`（task-role）。

```bash
aws cloudformation deploy \
  --stack-name taskaws-go-pr-roles \
  --template-file infra/go/pr-roles.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

读取 3 个角色 ARN（OIDC role 的 `PassRole` 限定到 Role2 / Role3）：

```bash
aws cloudformation describe-stacks \
  --stack-name taskaws-go-pr-roles \
  --query 'Stacks[0].Outputs' \
  --output table
```

| 角色（输出） | 物理名 | 信任主体 | 职责 |
|------|------|------|------|
| **Role1Arn** | `taskaws-go-pr-codebuild-role` | `codebuild.amazonaws.com` | 仅 CodeBuild 替代方案用：编排全流程。`iam:PassRole` 只许传 Role2/Role3。 |
| **Role2Arn** | `taskaws-go-pr-cfn-role` | `cloudformation.amazonaws.com` | CFN 代入它创建预览栈资源（TargetGroup、ListenerRule、ECS service、SG ingress、log group）。权限限定 `taskaws-go-pr-*`。 |
| **Role3Arn** | `taskaws-go-pr-task-role` | `ecs-tasks.amazonaws.com` | Fargate task 的 execution + task role（`TaskRoleArn` 同时填它）。拉 ECR + 写 CloudWatch Logs + 按需 RDS/SSM 读。 |

**PassRole 是核心安全边界**：OIDC role（和 CodeBuild role）的 `iam:PassRole` 资源锁定到 Role2 / Role3 两个 ARN。即便 buildspec / workflow 被篡改，攻击者也无处把更高权限的角色塞给 CFN / ECS。

### 1.3 创建 GitHub OIDC identity provider（账号级，一次性）

`gh-oidc-role.yaml` **假定 provider 已存在**（栈里不创建它，避免被 stack teardown 误删）。账号级只执行一次：

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> 该 thumbprint 仅是占位值（CLI 必填参数）——AWS 现在自动维护 GitHub OIDC 的上游证书 thumbprint 并覆盖它。

确认 provider 存在：

```bash
aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn,'token.actions.githubusercontent.com')]"
```

### 1.4 部署 `gh-oidc-role.yaml`（GHA OIDC role）

```bash
aws cloudformation deploy \
  --stack-name taskaws-go-pr-gh-oidc \
  --template-file infra/go/gh-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GithubRepo=Genzhen/taskaws
```

读 `OidcRoleArn`：

```bash
aws cloudformation describe-stacks \
  --stack-name taskaws-go-pr-gh-oidc \
  --query 'Stacks[0].Outputs' \
  --output table
```

该 role（`taskaws-go-pr-gh-oidc-role`）的信任策略限定 `repo:Genzhen/taskaws:pull_request` 才能 AssumeRoleWithWebIdentity；内联策略给 ECR push（仅 `taskaws-go` 仓库）、CloudFormation 管理 `taskaws-go-pr-*` 栈、SSM 读 `/taskaws-go/pr/*`、`iam:PassRole` 仅 Role2/Role3。

### 1.5 存 GitHub Actions 变量 `TASKAWS_GO_OIDC_ROLE_ARN`

GitHub 仓库 → **Settings → Secrets and variables → Actions → Variables**（**不是 Secret**，workflow 用 `vars.` 读）→ New variable：

- Name：`TASKAWS_GO_OIDC_ROLE_ARN`
- Value：上一步的 `OidcRoleArn` 输出值

`pr-preview.yml` 里 `aws-actions/configure-aws-credentials` 的 `role-to-assume: ${{ vars.TASKAWS_GO_OIDC_ROLE_ARN }}` 读的就是它。

### 1.6 Cloudflare：通配 DNS + 命名 tunnel（reviewer 访问必需）

> **host-header 路由的关键约束**：ListenerRule 按 `Host: pr-<N>.preview.taskaws.local` 命中。Quick tunnel 拿到的随机 `*.trycloudflare.com` URL **无法固定 Host 头**，发到 ALB 时 Host 不匹配 → 走默认规则 → 打不到该 PR 的 TargetGroup。所以 reviewer 真正能访问必须满足下面两条：

1. **通配 DNS**：`*.preview.taskaws.local` 解析到共享 ALB（CNAME 到 `SharedAlbDnsName`，或到 cloudflared tunnel）。
2. **每 PR 一个命名 tunnel**（`cloudflared tunnel create taskaws-go-pr-<N>`），把 `pr-<N>.preview.taskaws.local` 路由到共享 ALB；cloudflared 作为 **sidecar**（ECS task 第二个容器）随 task 常驻。

> **栈本身无需 DNS 也能部署成功**：CFN 只创建 ListenerRule / TargetGroup / ECS service，不依赖 DNS。只是 DNS 没就绪时，reviewer 按域名访问不到（ECS task 健康、CloudMap 已注册，内部 VPC 仍可经 `intro-pr-<N>.taskaws.local` 解析）。

命名 tunnel 需要一个 **Cloudflare API Token**（同时给 Pages 部署用），权限见下表（Dashboard → My Profile → API Tokens → Create Token → Custom token，Account Resources 限定到自己账户）：

| 权限 | 级别 | 作用 |
|------|------|------|
| **Account · Cloudflare Pages · Edit** | Account | `wrangler pages deploy` / `project delete` |
| **Account · Cloudflare Tunnel · Edit** | Account | 命名 tunnel 创建/路由（reviewer 访问用） |
| **Account · Account · Read** | Account | wrangler 启动时探测账户资源 |
| **User · User Details · Read** | User | wrangler 读取用户信息 |

### 1.7 存 SSM 参数

GitHub Actions 跑在 GitHub 托管 runner 上，**读不了 GitHub Secrets 之外的仓库内敏感值**；workflow 通过 OIDC role 读 SSM。账号 / region 已固定：

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

# 3. Cloudflare API token（Pages 部署 + 命名 tunnel 用，§1.6 获取后回填）
aws ssm put-parameter \
  --name /taskaws-go/pr/cloudflare/api-token \
  --type SecureString \
  --value '<CF_API_TOKEN>'
```

| 参数 | 注入到 | 用途 |
|------|--------|------|
| `database-reader-url` | Go 容器 `DATABASE_READER_URL` | 复用 Phase 2 reader 端点（读写分离）。**必须用 reader，不要用 writer。** |
| `cors-origin` | Go 容器 `CORS_ORIGIN` | 预览前端域名每次变，预览阶段用 `*` 放行（生产仍锁精确域名）。 |
| `cloudflare/api-token` | `wrangler` / cloudflared 鉴权 | Pages 部署 + 命名 tunnel（见 §1.6）。 |

> **GHA 路径不需要 `gh-token`**：PR 评论用 workflow 内置的 `GITHUB_TOKEN`（`permissions: pull-requests: write` 已开）。`gh-token` SSM 参数仅 **CodeBuild 替代方案**需要（见 §5）。

> **SecureString 解密**：OIDC role 已给 `ssm:GetParameter` + 用默认 `aws/ssm` 托管 key（KMS 解密授权自带）。

---

## 2. 使用流程（开发者视角）

1. **开 PR** → GitHub Actions `pr-preview` job 自动触发（`pull_request: opened`）。
2. **约 5–8 分钟后**，PR 评论出现两个链接：
   - **Preview backend**：`https://pr-<N>.preview.taskaws.local`（命名 tunnel 就绪后；否则 workflow 会贴 ephemeral tunnel URL 或 `<pending>`）
   - **Preview frontend**：`https://<hash>.taskaws-go-pr-<N>.pages.dev`（Cloudflare Pages deployment）
3. **点 frontend URL** → 打开 `/intro` 预览页，前端调该 PR 的 Go 后端（`VITE_INTRO_SERVICE_URL=pr-<N>.preview.taskaws.local` 编译期注入）。
4. **新 push 同一 PR** → `synchronize` 触发重新构建；`concurrency` 取消同 PR 在跑的旧 run。评论更新新 URL。
5. **关闭 / 合并 PR** → `closed` 触发 teardown：`delete-stack taskaws-go-pr-<N>` + `wrangler pages project delete`（best-effort）。共享 ALB / VPC / ECR 保留。

开发者无需装任何本地工具，全部在 GitHub PR 界面完成（Actions 标签页看 run 日志，PR 评论看预览链接）。

---

## 3. 验证 / 排查

### 看 GitHub Actions run 日志

GitHub 仓库 → **Actions** → `Go PR preview` workflow → 点对应 run。失败步骤（tunnel URL 捕获、Pages 部署、评论）都 `continue-on-error: true`，部署本身是 source of truth。

### 查预览栈状态

```bash
# 把 <N> 换成 PR 号
aws cloudformation describe-stacks \
  --stack-name taskaws-go-pr-<N> \
  --query 'Stacks[0].[StackStatus,Outputs]' \
  --output table
```

`Outputs` 里抓 `PreviewHost`（`pr-<N>.preview.taskaws.local`，host-header 路由用的域名）和 `CloudMapDnsName`（`intro-pr-<N>.taskaws.local`，VPC 内解析）。

### host-header 路由验证（VPC 内）

在 VPC 内一台机器上（或用 Session Manager 接进同 VPC 的 EC2）：

```bash
# 直连共享 ALB，但手动带 Host 头触发对应 PR 的 ListenerRule
curl -H "Host: pr-<N>.preview.taskaws.local" http://<SharedAlbDnsName>/health
```

返回 200 即该 PR 的 TargetGroup + ListenerRule 工作正常。这条命令也能确认「栈部署成功但外部 DNS 没就绪」的情况——内部可达，外部暂时不可达。

### cloudflared / DNS 排查

- `pr-<N>.preview.taskaws.local` 不解析 → 通配 DNS 没配（§1.6 第 1 条）。
- 解析了但 502 / 默认页面 → 命名 tunnel 没起或 Host 不匹配；确认 sidecar cloudflared 跑在该 PR 的 ECS task 里、tunnel ingress 把 `pr-<N>.preview.taskaws.local` 指向共享 ALB。
- ephemeral `trycloudflare.com` URL 打不开后端 → 预期行为（quick tunnel 不满足 host-header 路由），走命名 tunnel。

---

## 4. 注意事项 / 坑 / 成本

### 成本（共享 ALB 后）

| 资源 | 单价 | 说明 |
|------|------|------|
| **共享 ALB**（prod 栈 1 个，所有 PR 复用） | ≈ **$16 / 月** | LCU 费用另计，预览流量小可忽略。**固定 1 个，不随 PR 增长。** |
| ListenerRule / TargetGroup | 免费 | 挂在共享 ALB 上 |
| Fargate task（0.5 vCPU + 1 GB） | ≈ **$14 / 月 / PR** | 按 730h 算；PR 关闭即销毁 |
| GitHub Actions | 公共仓库免费 / 私有仓库有免费额度 | ubuntu-latest，每 PR 几分钟 |
| Cloudflare Pages | 免费 | 免费额度足够预览 |
| 命名 Tunnel | 免费 | 通配 DNS 需 Cloudflare 托管该域 |

**结论**：每个常开 PR ≈ **$14 / 月**（只剩 Fargate；ALB 摊销到 prod）。相比旧的「每 PR 独立 ALB」省掉 $16×N。

### host-header 路由 / DNS

- **栈 ≠ 可访问**：`pr-template.yaml` 不创建 DNS，只建 ListenerRule。栈 `CREATE_COMPLETE` 不代表 reviewer 能访问——要 §1.6 的通配 DNS + 命名 tunnel 就绪。
- **quick tunnel 是临时可达性证明**：workflow 里 `cloudflared tunnel --url` 那步 `continue-on-error: true`，捕不到 URL 不阻塞部署；捕到的 `trycloudflare.com` URL 也打不到该 PR（Host 不匹配）。
- **PrId 作 ListenerRule priority**：PR 号是数字，直接当 priority（1–50000）。同共享 ALB 上不会撞 priority（每个 PR 号唯一）。

### Teardown 依赖

- PR 关闭的清理依赖 `pull_request: closed` 事件触发 workflow。若 workflow run 失败（OIDC role 被删、权限丢失），残留栈不会被清。
- **建议**加一条 EventBridge 定时任务（每晚）兜底：扫描所有 `taskaws-go-pr-*` 栈，对没有对应 open PR 的执行 `delete-stack`。

  ```bash
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --query "StackSummaries[?starts_with(StackName,\`taskaws-go-pr-\`)].StackName" \
    --output text
  ```

  逐个对 GitHub PR 状态校验后删除（删除用 OIDC role 或 admin principal 都行）。

### 其他坑

- **CloudMap 命名空间复用**：预览栈**绝不能**新建 `taskaws.local` namespace（和 prod 冲突）——必须传 prod 栈的 `CloudMapNamespaceId`。每 PR 注册 `intro-pr-<N>` 到该 namespace。
- **ECR tag 清理**：PR 关闭只删栈，不删 ECR `pr-N` tag 镜像。靠 ECR lifecycle policy（prod 栈已配 untagged 7 天过期）兜底，tagged 镜像按需手动清。
- **GitHub OIDC role 信任范围**：`gh-oidc-role.yaml` 默认只信任 `repo:Genzhen/taskaws:pull_request`。fork PR 无法代入该 role（sub 不同）→ fork 的预览不会触发部署（这是预期安全行为）。
- **`TASKAWS_GO_OIDC_ROLE_ARN` 是 variable 不是 secret**：放 secret 里 `vars.` 读不到。OIDC role ARN 不算敏感值（知道 ARN 没有 GitHub OIDC token 也代入不了）。

---

## 5. CodeBuild 替代方案（legacy trigger）

仓库保留了 CodeBuild 触发路径作为**替代方案**（`infra/go/codebuild.json` + `infra/go/buildspec-pr.yml`）。它和 GHA 路径**共用同一套后端栈**（`pr-template.yaml` + 共享 ALB + `pr-roles.yaml`），区别只在触发/鉴权层。

何时用 CodeBuild 替代：

- 想**脱离 GitHub**（私有 Git 仓库 / 其它 SCM）触发预览。
- 需要在 **AWS 内网**跑构建（CodeBuild 可配 VPC；GHA runner 在 GitHub 公网）。
- 想用 **CodeBuild 原生 webhook** 而非 GitHub Actions。

启用步骤概要：

```bash
# 1. 额外存 GitHub PAT（CodeBuild 跑在 AWS 托管环境，读不了 GITHUB_TOKEN）
aws ssm put-parameter \
  --name /taskaws-go/pr/gh-token \
  --type SecureString \
  --value '<GH_PAT>'

# 2. 编辑 infra/go/codebuild.json（serviceRole = Role1Arn，source.location = 仓库 URL）
# 3. 创建项目 + webhook
aws codebuild create-project --cli-input-json file://infra/go/codebuild.json
aws codebuild create-webhook \
  --project-name taskaws-go-pr \
  --filter-groups '[[{"type":"EVENT","pattern":"PULL_REQUEST_CREATED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_UPDATED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_REOPENED"}],[{"type":"EVENT","pattern":"PULL_REQUEST_CLOSED"}]]'
```

`buildspec-pr.yml` 已更新为读 prod 栈的 `SharedAlb*` 输出并部署 `pr-template.yaml`（共享 ALB 路径），与 GHA 主路径行为一致。CodeBuild 路径需要 Role1（`taskaws-go-pr-codebuild-role`，在 `pr-roles.yaml` 里），GHA 路径不需要。

> 两条路径不要同时启用同一个 PR 仓库——会重复部署。二选一。

---

## 附录：GitHub Actions workflow 关键步骤（参考骨架）

```yaml
# .github/workflows/pr-preview.yml — 骨架，实际文件以仓库为准
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
permissions:
  contents: read
  pull-requests: write      # gh pr comment 用内置 GITHUB_TOKEN
  id-token: write           # OIDC 必需
concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  preview:
    runs-on: ubuntu-latest
    env:
      AWS_REGION: us-east-1
      PROD_STACK: taskaws-go
      ECR_REPO: 977778967406.dkr.ecr.us-east-1.amazonaws.com/taskaws-go
      HOST_DOMAIN: preview.taskaws.local
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4        # OIDC 代入
        with:
          role-to-assume: ${{ vars.TASKAWS_GO_OIDC_ROLE_ARN }}
          aws-region: us-east-1
      # close → delete-stack + pages project delete; exit 0
      # open/update:
      #   1. docker build --platform linux/amd64 -f apps/intro-go/Dockerfile → push ECR:pr-N
      #   2. 读 SSM（database-reader-url / cors-origin / cloudflare/api-token）
      #   3. 读 prod + pr-roles 栈输出（CLUSTER / NS_ID / LISTENER_ARN / ALB_SG_ID / ALB_DNS / CFN_ROLE_ARN / TASK_ROLE_ARN）
      #   4. aws cloudformation deploy taskaws-go-pr-N（pr-template.yaml + 共享 ALB 参数）
      #   5. cloudflared（命名 tunnel 走 host-header；quick tunnel 仅可达性证明）
      #   6. pnpm -F web build（VITE_INTRO_SERVICE_URL=pr-N.preview.taskaws.local）→ wrangler pages deploy
      #   7. gh pr comment 贴链接（GITHUB_TOKEN）
```

> 实际 workflow 还处理：`IS_CLOSED` 分支、secret mask、wrangler/cloudflared 安装、`continue-on-error` 容错。骨架只展示主干；完整逻辑见 `.github/workflows/pr-preview.yml`。
