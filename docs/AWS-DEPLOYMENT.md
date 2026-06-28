# AWS Deployment Guide

## 前置要求

1. **AWS Account** - 有权限创建 Lambda、S3、CloudFront、RDS
2. **GitHub Repository** - 已 push 到 GitHub
3. **AWS CLI** - 本地已安装并配置 `aws configure`

## 部署流程

### 1. 配置 GitHub Secrets

在 GitHub repository Settings → Secrets and variables → Actions 中添加：

```bash
AWS_ACCESS_KEY_ID           # AWS IAM access key
AWS_SECRET_ACCESS_KEY       # AWS IAM secret key
AWS_REGION                  # us-east-1 (或你的 region，可选)
AWS_LAMBDA_ROLE_ARN         # Lambda execution role ARN
AWS_S3_BUCKET               # S3 bucket name (前端静态文件)
AWS_S3_BUCKET_LAMBDA_CODE   # S3 bucket for Lambda code upload
AWS_CLOUDFRONT_DISTRIBUTION_ID  # CloudFront distribution ID (可选)
DATABASE_URL                # RDS PostgreSQL connection string
BETTER_AUTH_SECRET          # Better Auth secret (>=32 chars)
FRONTEND_URL                # 前端 CloudFront/S3 URL (https://xxx.cloudfront.net)
# BETTER_AUTH_URL 和 CORS_ORIGIN 会自动更新为 Lambda URL 和 FRONTEND_URL
```

### 2. 创建 AWS 资源

#### Lambda Function URL (后端)

```bash
# 创建 S3 bucket for Lambda code storage
aws s3 mb s3://taskaws-lambda-code-<ACCOUNT_ID>

# 创建 Lambda execution role
aws iam create-role \
  --role-name taskaws-lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

# 添加 basic execution policy + S3 access
aws iam attach-role-policy \
  --role-name taskaws-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy \
  --role-name taskaws-lambda-role \
  --policy-name S3Access \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::taskaws-lambda-code-<ACCOUNT_ID>/*"}]}'

# GitHub Actions 会自动创建 Lambda + Function URL (无需手动操作)
```

#### S3 + CloudFront (前端)

```bash
# 创建 S3 bucket
aws s3 mb s3://taskaws-web-<ACCOUNT_ID>

# 配置 S3 bucket policy (public read)
aws s3api put-bucket-policy \
  --bucket taskaws-web-<ACCOUNT_ID> \
  --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::taskaws-web-<ACCOUNT_ID>/*"}]}'

# 配置 S3 website (for SPA routing fallback)
aws s3api put-bucket-website \
  --bucket taskaws-web-<ACCOUNT_ID> \
  --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'

# 创建 CloudFront distribution
# IMPORTANT: Use S3 website endpoint (not REST endpoint) for SPA routing
# S3 website endpoint: taskaws-web-<ACCOUNT_ID>.s3-website.<region>.amazonaws.com
aws cloudfront create-distribution \
  --origin-domain-name taskaws-web-<ACCOUNT_ID>.s3-website.us-east-1.amazonaws.com \
  --default-root-object index.html

# Or configure CloudFront custom error response (if using REST endpoint)
# aws cloudfront update-distribution \
#   --id <DISTRIBUTION_ID> \
#   --default-cache-behavior ErrorCode=403,ResponseCode=200,ResponsePagePath=/index.html
```

#### RDS PostgreSQL (数据库)

```bash
# 创建 RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier taskaws-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username postgres \
  --master-user-password <password> \
  --allocated-storage 20 \
  --publicly-accessible

# 等待 RDS available 后获取 endpoint
aws rds describe-db-instances \
  --db-instance-identifier taskaws-db \
  --query DBInstances[0].Endpoint.Address \
  --output text

# DATABASE_URL format: postgresql://postgres:<password>@<endpoint>:5432/postgres
```

### 3. GitHub Actions 自动部署

Push 到 `main` branch 后自动触发：

1. **Test** - Type check + Build
2. **Deploy Lambda** - Update Lambda function code + Get Function URL
3. **Deploy Frontend** - Set `VITE_SERVER_URL` → Build → Sync to S3 → Invalidate CloudFront

### 4. 本地开发测试

```bash
# 启动 PostgreSQL (Docker)
docker-compose up -d

# 运行数据库 migration
pnpm db:migrate

# 启动开发服务器
pnpm dev
# 前端: http://localhost:5173
# 后端: http://localhost:3000
```

## 环境变量

### 本地开发 (apps/server/.env)

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
```

### 生产环境 (AWS)

- **Lambda** - 通过 environment variables 配置（AWS Console）
- **前端** - `VITE_SERVER_URL` 在 GitHub Actions 中自动注入 Lambda Function URL

## 验证部署

```bash
# 测试 Lambda health
curl https://<lambda-url>.lambda-url.us-east-1.on.aws/

# 测试前端
curl https://<cloudfront-domain>.cloudfront.net/

# 测试 tRPC
curl https://<lambda-url>.lambda-url.us-east-1.on.aws/trpc/healthCheck
```

## 注意事项

1. **Lambda Function URL CORS** - 必须配置 AllowOrigins 为前端域名
2. **Better Auth Secret** - Lambda 环境变量必须设置 `BETTER_AUTH_SECRET`
3. **Database Connection** - Lambda 需要访问 RDS (VPC configuration)
4. **Session Cookie** - `sameSite: "none"` + `secure: true` (HTTPS required)

## 成本估算

- Lambda: ~$0.20 per 1M requests
- S3: ~$0.023 per GB storage + $0.0004 per 1K requests
- CloudFront: ~$0.085 per GB transfer
- RDS db.t3.micro: ~$15/month

**Total**: ~$15-20/month for low traffic