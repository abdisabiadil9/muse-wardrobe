# Railway：带口令的组内 MVP

当前提供部署代码，首次 Railway 构建、平台网络和真实模型连通性仍需在你的账号内验收。它使用共用演示衣橱，不是个人账号系统。前端、API、Worker 在一个应用服务内运行；PostgreSQL 为另一个服务。

## 1. 注册并连接仓库

打开 https://railway.com/ ，注册并登录自己的账号。连接 GitHub，授权访问 `mistake-12/muse-wardrobe`。如果使用组员自己的账号，可先 fork 仓库，再连接其 fork。计费套餐、试用资格和使用上限以后台显示为准；Hobby 当前为 $5/月起，包含 $5 用量，超出另计，模型额度不包含在 Railway 费用内。

在控制台创建项目，添加 GitHub Repo 服务，选择此仓库的 `main` 分支，根目录保持仓库根目录。仓库的 `Dockerfile` 和 `railway.json` 已指定构建方式。不要配置 `npm run dev:full`；云端不运行 Docker-in-Docker 或 Vite。

## 2. 添加数据库和磁盘

- 项目内 New → Database → PostgreSQL。应用与数据库选择同一个区域。
- 应用服务添加 Volume，挂载到 `/data`。这是衣服原图、人物照片和生成图的持久存储，数据库自己的 Volume 不能替代它。
- 保持应用单实例，不开启自动休眠；Worker 需要继续处理已经提交的任务。
- 数据库使用私网连接，无需开启数据库 Public Access。

## 3. 配置应用 Variables

进入应用服务的 Variables，可用 Raw Editor。不要把本地 `.env` 整份原样复制：localhost 数据库和本机来源不适用于云端。

```dotenv
NODE_ENV=production
APP_MODE=team_demo
PORT=8080
API_PORT=8787
API_HOST=127.0.0.1
MEDIA_ROOT=/data/media
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=替换成至少32字节随机字符串
DEMO_PASSWORD=替换成至少24字符的组内演示口令
DAILY_TASK_LIMIT=10
QODER_ACCESS_TOKEN=填入现有Qoder密钥
QODER_AGENT_ID=填入现有AgentID
QODER_AGENT_VERSION=填入现有版本
QODER_ENVIRONMENT_ID=填入现有EnvironmentID
QODER_MAX_CREDIT_COST=1.00
ARK_API_KEY=填入现有Seedream密钥
ARK_IMAGE_MODEL=doubao-seedream-5-5-261028
TRYON_ENABLED=true
MEMORY_ENABLED=false
DREAM_ENABLED=false
```

`${{Postgres.DATABASE_URL}}` 中的 `Postgres` 必须与实际服务名一致，最好通过 Railway 的 Reference Variable 选择数据库变量。不要使用本机 `127.0.0.1:55432` 数据库地址。云端是新数据库，没有本地 Memory Store 绑定，因此先关闭 Memory；配置独立绑定后再启用。

在本地生成随机值（分别执行两次，填 SESSION_SECRET 和 DEMO_PASSWORD）：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

模型变量仅填平台后台，不提交 GitHub，不使用 `VITE_` 前缀。Docker 构建上下文排除了本机 `.env`、日志、私有照片和 APK；Dockerfile 不将密钥作为构建参数传入。

## 4. 生成域名并部署

应用 Settings → Networking → Generate Domain，目标端口填写 **8080**。默认自动读取 Railway 注入的 `RAILWAY_PUBLIC_DOMAIN`，无需手填 APP_ORIGIN。如使用自定义域名，设置 `APP_ORIGIN=https://你的域名`，不带末尾斜杠。

Review / Deploy 应用变量与挂载变更。首次没有域名或配置不完整时启动会失败；补齐后重新部署即可。不要把平台提供的域名误填到内部 API 8787 端口。

启动会自动迁移数据库、检查媒体目录可写，再启动内部 API、Worker 和公网口令入口。`/healthz` 用于 Railway 健康检查。Worker 异常退出会结束服务，由平台的 on-failure 策略重启；图片保存在 `/data/media`，重建容器不应丢失。

## 5. 验收

1. 打开 HTTPS 域名，先看到演示口令页；未登录不能读取业务 API。
2. 输入 DEMO_PASSWORD，进入应用。首次云端衣橱为空，需要上传衣物。
3. 上传单品、保存搭配，刷新确认保留；手机用同一公网地址，不需要同一 Wi-Fi。
4. 再各运行一次搭配和试穿，核对任务结果和模型账单。注册或部署本身不会主动生成图片。
5. 重启应用，重新输入演示口令后确认图片仍能加载。容器重启会使演示入口会话失效，但不应删除数据。

APK 可填写相同 HTTPS 地址，仍需要 Android 真机验证。对话历史索引目前保存在当前浏览器；云端部署不会自动带过去本机聊天索引、衣橱和照片。数据库与媒体磁盘应定期备份。

## Worker 为什么常驻

API 把用户点击生成产生的任务写入数据库，然后立即返回 task ID；Worker 领取任务，执行 Qoder 工具循环或 Seedream 请求，保存结果并记录状态。用户关闭页面后，后台工作可以继续。Worker 空闲时主要做数据库检查，并不持续生成内容；平台运行资源仍有成本。

将来可以改成队列触发或托管 Workflow，这属于替换执行方式，后台任务职责仍然存在。当前同容器单实例能减少迁移工作，后续对象存储接通后再拆分 API 和 Worker。

## 边界与验证记录

- 普通 API 开发入口仍拒绝 production；只有专用 `start:demo` 入口允许受口令保护的 team_demo，内部 API 强制 loopback。
- 知道口令的人共享开发用户数据和额度；公开招募用户前必须接入独立登录与用户隔离。
- 本轮数据库测试 102 项通过；本机按 production/team_demo 启动，已验证口令、健康检查、API 会话/CSRF、图片上传与私有读取，不发模型请求。
- 本机 Docker Hub 基础镜像拉取两次收到 EOF，尚未完成容器构建验证。Railway 将自行构建，首次结果以 Deployments 的构建日志为准。

官方参考：[快速开始](https://docs.railway.com/quick-start)、[Variables](https://docs.railway.com/variables)、[PostgreSQL](https://docs.railway.com/databases/postgresql)、[Volumes](https://docs.railway.com/volumes)、[计费](https://docs.railway.com/pricing/plans)。
