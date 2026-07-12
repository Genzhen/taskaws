# Go Intro 微服务 — AWS ECS 部署指南

> Phase 2 手动操作 + 部署指南。本指南带你把 `apps/intro-go/` 的 Go 微服务部署到 AWS ECS（Fargate），并通过 ALB + CloudMap 与现有 Lambda 后端打通。

---

## 0. 前提

- 已安装 `aws`（已配置账号 **977778967406**，region **us-east-1**）、`docker`、`go`。
- Phase 1 的 Go 服务代码在 `apps/intro-go/`，`Dockerfile` 已就绪。
- CloudFormation 模板在 `infra/go/template.yaml`（本栈所需参数都有发现好的默认值）。
- **本栈会自动创建公有子网（`10.0.20.0/24` + `10.0.21.0/24`）和连 IGW 的路由表** —— 当前 VPC 没有可用公有子网（主路由表把所有流量丢给 NAT，IGW 路由表未关联），所以 ALB 必须放在新建的公有子网里。
- 已确认的资源 ID（后续命令默认值，无需重复填）：

  | 资源 | ID |
  |------|----|
  | VPC | `vpc-0100e9f3e19120c53` |
  | IGW | `igw-0325e75afae3aa258` |
  | NAT | `nat-1ed6f750f51721085`（主路由表 `rtb-08c399bf1dd4694bc`） |
  | PrivateSubnetA（us-east-1a，10.0.11.0/24） | `subnet-0952e2f162d9221c1` |
  | PrivateSubnetB（us-east-1b，10.0.12.0/24） | `subnet-02013ba8ad282d639` |
  | RDS 安全组（writer+reader 共用） | `sg-088f299ef45073f8a` |
  | RDS reader 端点 | `task-db-reader.cubc4sg8c4ux.us-east-1.rds.amazonaws.com:5432` |

---

## 1. 先用 DesiredCount=0 部署栈（创建 ECR 仓库 + 全部基础设施，不起 task）

> ✅ **本流程已在账号 977778967406 实测通过**（2026-07-11）。模板已修复 3 个实测发现的坑：CloudMap `PrivateDnsNamespace` 用 `Vpc`（非 `VpcId`）、`AmazonECSTaskExecutionRolePolicy` 在 `service-role/` 路径下、`ServiceRegistries` 不能带 `ContainerPort`。
>
> ECS service 启动时就要拉镜像，所以**先把栈以 0 任务建出来**（ECR 仓库随之创建），再 push 镜像，最后升到 1。`DesiredCount` 是模板参数。

```bash
DATABASE_READER_URL="postgresql://<USER>:<PASS>@task-db-reader.cubc4sg8c4ux.us-east-1.rds.amazonaws.com:5432/postgres"
REPO=977778967406.dkr.ecr.us-east-1.amazonaws.com/taskaws-go

aws cloudformation deploy \
  --stack-name taskaws-go \
  --template-file infra/go/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    DatabaseReaderUrl="$DATABASE_READER_URL" \
    CorsOrigin="*" \
    ImageUrl="$REPO:v1" \
    DesiredCount=0
```

其余参数（`VpcId` / `IgwId` / `PrivateSubnetA` / `PrivateSubnetB` / `DatabaseSecurityGroupId` / `PublicSubnetCidr`）都有默认值，直接用。

---

## 2. 构建（amd64！）+ 推送镜像

> ⚠️ **必须 `--platform linux/amd64`**：Fargate 默认 x86_64，在 Apple Silicon 上原生 build 出的是 arm64，会报 `CannotPullContainerError: image Manifest does not contain descriptor matching platform 'linux/amd64'`。build context 是 `apps/intro-go`（不是仓库根）。

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 977778967406.dkr.ecr.us-east-1.amazonaws.com

docker build --platform linux/amd64 -f apps/intro-go/Dockerfile -t taskaws-go:v1 apps/intro-go
docker tag taskaws-go:v1 $REPO:v1
docker push $REPO:v1
```

---

## 3. 升到 DesiredCount=1（task 拉镜像 → 注册 ALB + CloudMap → 健康）

```bash
aws cloudformation deploy \
  --stack-name taskaws-go \
  --template-file infra/go/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    DatabaseReaderUrl="$DATABASE_READER_URL" \
    CorsOrigin="*" \
    ImageUrl="$REPO:v1" \
    DesiredCount=1
```

CFN 会等 ECS service 稳定（task 跑起来 + ALB 健康检查通过），约 1–2 分钟到 `UPDATE_COMPLETE`。取 ALB 地址：

```bash
ALB=$(aws cloudformation describe-stacks --stack-name taskaws-go \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsUrl'].OutputValue" --output text)
echo "$ALB"   # http://taskaws-go-<id>.us-east-1.elb.amazonaws.com
```

**关键提醒：**

- **`DatabaseReaderUrl` 必须用 RDS reader 端点**（`task-db-reader...`），不要用 writer 或 `localhost` —— Go 服务走只读副本，读写分离。
- **SSL**：RDS 要求 SSL，Go 默认 `sslmode=require`（pgx `require` 不校验证书，等价现有 Node 的 `rejectUnauthorized:false`），无需额外配置。
- **部署顺序**：先部署 `taskaws-go` 栈（创建 CloudMap 命名空间 + 服务），再部署 Lambda —— 否则 Lambda 的 `intro.proxy` 在 Go 起来前会失败。
- **实测**：`intro.taskaws.local` → task 私有 IP（如 `10.0.11.242`），同 VPC 的 Lambda 可解析。ALB `/health` 返回 `{"status":"ok"}`。

---

## 4. 验证

```bash
# 健康检查 —— 期望 {"status":"ok"}
curl -fsS "$ALB/health"

# 介绍接口 —— 期望 JSON 介绍（把 <某个真实 user id> 换成 DB 里的 user id）
curl -s "$ALB/api/intro?userId=<某个真实 user id>"

# SSE 流式 —— 期望逐词流式输出
curl -N "$ALB/api/intro/stream?userId=<id>"
```

ECS 服务状态：

```bash
# 期望 desiredCount = 1
aws ecs describe-services \
  --cluster taskaws-go \
  --services $(aws ecs list-services --cluster taskaws-go --query 'serviceArns[0]' --output text) \
  --query 'services[0].desiredCount'
```

CloudMap 实例注册（期望注册了 intro 实例）：

```bash
SVC_ID=$(aws servicediscovery list-services \
  --query "Services[?Name=='intro'].Id" --output text)
aws servicediscovery list-instances --service-id "$SVC_ID"
```

---

## 4. Lambda → Go（CloudMap 链路）验证

`deploy.yml` 部署 Lambda 时已设：

```
INTRO_SERVICE_URL=http://intro.taskaws.local:8080
```

Lambda 与 Fargate task 在**同一个 VPC 的私有子网**，能通过 CloudMap 私有 DNS 解析 `intro.taskaws.local`，直接走内网打到 Go 服务，不经过 ALB。

**验证方式：**

- 前端调用 tRPC `intro.proxy`（或 `intro.stream`），看是否返回 Go 服务的 JSON / SSE。
- 或在 Lambda 日志里直接 `fetch('http://intro.taskaws.local:8080/health')`，确认返回 `{"status":"ok"}`。

**部署顺序再次强调：**

1. 先部署 `taskaws-go` 栈（创建 CloudMap 命名空间 `taskaws.local` + 服务 `intro`）。
2. 再部署 Lambda（Lambda 启动时才能解析到 `intro.taskaws.local`）。

如果顺序反了，Lambda 启动时 CloudMap DNS 还没就绪，`intro.proxy` 会暂时失败 —— 重启 Lambda 或等 DNS 传播后自愈。

---

## 5. 注意事项 / 坑

- **Fargate task 公网 IP DISABLED** —— 靠 NAT 拉镜像 + 推日志（已确认私有子网 `subnet-0952e2f162d9221c1` / `subnet-02013ba8ad282d639` 经 `nat-1ed6f750f51721085` 出网）。
- **ALB 在新建的公有子网**（`10.0.20.0/24` + `10.0.21.0/24`，IGW 路由），internet-facing。
- **当前 ALB 是 HTTP:80**。生产要 HTTPS 需要 ACM 证书（自有域名）或 Cloudflare Tunnel —— 列为升级项，不在 Phase 2 范围。
- **成本估算**：~1 Fargate（0.5 vCPU / 1GB）≈ **$14/月** + 1 ALB ≈ **$16/月**（不含 NAT，NAT 已有，被其他服务共用）。
- **下线**：

  ```bash
  aws cloudformation delete-stack --stack-name taskaws-go
  ```

  会删 ALB / ECS / CloudMap 服务 / 新建的公有子网和路由表；**不删 RDS / VPC / NAT**（这些是共享基础设施）。

---

## 6. 前端配置（生产）

生产前端需要 `VITE_INTRO_SERVICE_URL` 指向 Go 服务的可访问地址。但：

- **当前 ALB 是 HTTP**，若前端是 HTTPS 会有 **mixed-content**（浏览器拦截）。
- 所以生产推荐二选一：
  1. **Cloudflare Tunnel** 暴露内部 ALB（HTTPS 入口，回源到 HTTP ALB）—— 见 Phase 3。
  2. 给 ALB 加 **ACM 证书 + HTTPS listener**（需自有域名）。
- **本地开发**已用 `http://localhost:8080`（见 `apps/web/.env`），无 mixed-content 问题。

> Phase 2 阶段：前端生产 `VITE_INTRO_SERVICE_URL` 先留空（走 Lambda 的 `intro.proxy` 中转，Lambda 内网直连 Go，不经浏览器 → 无 mixed-content）。Phase 3 接 Cloudflare Tunnel 后再让前端直连 Go 的 HTTPS 地址。
