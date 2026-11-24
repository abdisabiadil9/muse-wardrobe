# Railway：带口令的组内 MVP

已在 Railway 完成容器构建与公网基础链路验收；云端真实模型生成尚未在本轮调用验证。它使用共用演示衣橱，不是个人账号系统。前端、API、Worker 在一个应用服务内运行；PostgreSQL 为另一个服务。

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
OUTBOUND_IPV4_ONLY=true
EVERYINFRA_API_KEY=填入EveryInfra服务端密钥
EVERYINFRA_MONTHLY_SEARCH_LIMIT=1000
EVERYINFRA_MONTHLY_NOTE_LIMIT=200
EVERYINFRA_MONTHLY_TAOBAO_SEARCH_LIMIT=100
EVERYINFRA_DAILY_USER_LIMIT=20
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
- 2026-11-17：Railway Docker 构建与部署成功。公网验证了健康检查、口令登录、未登录 API 拒绝、静态前端、搭配保存、图片上传与私有读取；Qoder / Seedream 服务端变量已配置。本轮未发起付费模型请求。
- 云端使用新数据库，衣橱初始为空。本机数据不会自动上传；请通过应用上传或主动导入。
- Railway CLI 提示旧版 railway.json 配置将在 2026-12-01 停用；当前服务的健康检查、重启策略和单实例设置也已直接写入平台。后续维护时需按官方迁移指引迁移仓库配置。

官方参考：[快速开始](https://docs.railway.com/quick-start)、[Variables](https://docs.railway.com/variables)、[PostgreSQL](https://docs.railway.com/databases/postgresql)、[Volumes](https://docs.railway.com/volumes)、[计费](https://docs.railway.com/pricing/plans)。

## Seedream 网络排查

2026-11-17 云端检查发现 Node 默认双栈连接访问 Ark 出现 ETIMEDOUT，启用 `OUTBOUND_IPV4_ONLY=true` 后无需密钥的连通性探测可收到 HTTP 401 和 request ID。该开关仅作用于 Worker，未改变模型或自动重试策略。网络探测不等于真实生成验收。

生成响应先存入私有 `provider_operations.output`（checkpoint），含图片 URL、request_id 和用量，再下载到媒体磁盘；只有保存完才向前端展示图片。排查只查看状态和脱敏错误字段，不输出图片 data URL、签名 URL 或密钥。未知结果不自动重发，供应商请求编号不存在时不能用本地 task ID 冒充。

## 对话事件与 Agent 工具（2026-11-17）

已实测公网 `/tasks/:id/events` 返回 `text/event-stream`、历史事件与持续心跳。Worker 直接订阅 Qoder 原生 SSE，完整事件先去重入库，再以 `agent.events_updated` 携带经过过滤的 `native_event` 推给前端，保留原始事件 ID、type 和工具关联；不暴露密钥、思考块或内置工具私有输出。前端直接合并事件，快照/历史用于补齐断线，15 秒低频轮询兜底。首次恢复与后台刷新分开，避免反复出现恢复提示。

基础工具：Read、Write、Edit、Glob、Grep、Bash、WebFetch、WebSearch、ImageSearch，运行于 Qoder 沙箱；保留 read_wardrobe / propose_outfit。Seedream 试穿仍由应用执行，不额外启用 Qoder 图片/视频生成。配置升级可运行 `node scripts/qoder-update-tools.mjs` 预览，`--execute` 更新已有 Agent 并固定本机版本；随后将 Railway 的 QODER_AGENT_VERSION 同步为返回版本并部署。已有任务继续使用创建时的版本，不强行修改执行中的 Session。

## 灵感与淘宝版本发布（2026-11-17）

部署 `09577420-c9b1-460c-a7dc-324de24e6b78` 已成功，线上固定 Qoder Agent v6，EveryInfra Key 从 Railway 服务端 Variables 读取。使用当前工作区的必要源文件快照部署，不上传 `.env`、`.local`、本机数据库或私照；没有推送 Git 提交。新增来源缓存、用量表和字段自动迁移，原 PostgreSQL 与 `/data` 卷保持复用。

已验证公网健康检查、原演示口令、未登录访问被拒绝、12 件衣物与私有图片保留、12 种风格定义和新前端包。云容器能读取原 EveryInfra 淘宝/小红书任务并解析图片，无新增付费查询；Agent 读回确认含 `search_products` 等 6 个业务工具。云端 Memory/Dream 保持原值 false，不在本次部署中擅自创建记忆绑定。

## 原生 Skill 与 GitHub（2026-11-24）

Agent v7 已绑定固定版本的 `muse-style-discovery`。本次将累计的灵感/淘宝功能与原生 Skill 发布器一并提交 GitHub；应用应同步 `QODER_AGENT_VERSION=7`。发布器产生的 `QODER_STYLE_SKILL_ID` / `QODER_STYLE_SKILL_VERSION` 仅用于后续发布回执，运行时通过固定 Agent 版本获取绑定。现有会话保留原快照，Memory/Dream 开关不随 Skill 发布自动改变。
