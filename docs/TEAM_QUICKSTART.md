# 组员部署：电脑服务 + Android APK

更新：2026-11-17。当前可直接运行的是本地/热点演示版，手机安装 APK 后连接一台正在运行服务的电脑。

## 1. 获取代码

公开仓库可直接克隆；参与推送的组员由仓库所有者添加写入权限，其他人可通过 Fork 和 PR 贡献。安装 Node.js 22.18+ 和 Docker Desktop，并启动 Docker。

```sh
git clone https://github.com/mistake-12/muse-wardrobe.git
cd muse-wardrobe
npm ci
cp .env.example .env
chmod 600 .env
```

`cp` 只在首次配置时执行，不要覆盖已有 `.env`。后续更新只需 `git pull`、`npm ci` 后重启应用。

## 2. 配置密钥

在项目根目录的 `.env` 中填入：

```dotenv
SESSION_SECRET=在本机生成的随机字符串
QODER_ACCESS_TOKEN=自己的Qoder访问令牌
ARK_API_KEY=自己的火山方舟API密钥
ARK_IMAGE_MODEL=doubao-seedream-5-5-261028
TRYON_ENABLED=true
```

生成 SESSION_SECRET：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

保留 `.env.example` 中的本地数据库、端口等默认配置。Seedream 模型或兼容 Endpoint 必须已在该账号开通。

| 配置 | 用途 |
| --- | --- |
| `QODER_ACCESS_TOKEN` | Qoder Cloud Agent 鉴权 |
| `QODER_AGENT_ID`、`QODER_AGENT_VERSION`、`QODER_ENVIRONMENT_ID` | 由下一步初始化脚本填写；与令牌所属账号匹配 |
| `ARK_API_KEY` | Seedream 图片生成鉴权 |
| `ARK_IMAGE_MODEL` | Seedream 模型 ID 或已开通的兼容 Endpoint ID |
| `SESSION_SECRET` | 应用自身的会话签名密钥，不是模型密钥 |

`.env` 已被 Git 忽略，仓库只包含空值示例。API 和 Worker 读取这些配置；前端与 APK 不需要密钥。若团队共用模型账号，请通过团队自己的私密渠道配置，勿写入代码、聊天截图或 `VITE_` 变量。

## 3. 准备 Qoder 资源

```sh
npm run qoder:setup
npm run qoder:setup -- --execute
```

第一条只预览；第二条在对应账号创建/复用开发 Agent 和 Environment，自动将 ID 和固定版本写入 `.env`，不启动搭配 Session。如果脚本提示创建结果未知，按本地日志对账后再操作，不要连续重建。不要把另一账号的资源 ID 与自己的令牌混用。

## 4. 启动电脑服务

```sh
npm run dev:full
```

保持这个终端运行，浏览器打开 `http://localhost:5179`。启动器负责 PostgreSQL、迁移、Fastify API、独立 Worker 和 Vite。必须运行 Worker 才能执行 AI 任务，仅启动前端不够。

首次衣橱为空，可自行上传衣服，或在第二个终端明确导入体验素材：

```sh
npm run demo:seed
```

仅导入素材不调用模型；在界面发送搭配请求或点击生成试穿图时才执行对应模型任务。

Memory 的可选配置及手动 Dream 边界见 [本地指南](LOCAL_DEVELOPMENT.md#6-memory-与-dream)；没有 Store 也能先跑搭配与试穿，不必先启用 Dream。

## 5. 安装 APK 并连接

安装包位于仓库 [Releases](https://github.com/mistake-12/muse-wardrobe/releases) 的 Android 演示发布中，下载 `muse-demo-debug.apk`。公开发布可直接下载，无需仓库成员权限。

1. 手机开热点，让电脑连接；也可让两台设备连接另一部手机的热点。
2. 在项目目录运行 `npm run phone:setup`，记录脚本输出的电脑地址。
3. 停止旧 `dev:full`，重新运行 `npm run dev:full`，使新的 `APP_ORIGINS` 生效。
4. 安装并打开 APK，填写 `http://电脑在热点中的IP:5179`。例如 `http://192.168.43.20:5179`，必须换成实际地址。

不要填写手机的 `localhost`。只需允许电脑防火墙放行演示网络的 5179 端口，不需要对手机开放数据库或 API 的 8787 端口。

这个 APK 是 WebView 演示壳，加载所填电脑地址的最新前端。Lumi、更改后的底栏和历史对话不需要重编译 APK。电脑关机或服务停止，AI 和衣橱服务就不可用；APK 本身无法绕过校园网隔离。Android 7.0+；真机安装与连通情况由组员在各自设备验证。

## 6. 数据和公网部署边界

- 每位组员独立部署时拥有自己的数据库和 `.local/media` 图片目录，不会自动取得这台电脑已有的数据。
- 同一服务目前使用共享开发账号；对话历史索引和收藏按浏览器保存，不跨手机同步。保存搭配、任务和图片在服务端。
- `.env`、`.local/media` 和 Docker 数据卷不会随 `git push` 上传；迁移现有数据需单独导出数据库并传输私有图片。
- 当前程序明确拒绝生产模式启动。若要让所有人从移动数据访问，需要再完成真实登录、HTTPS 同源入口、API/Worker 部署和持久存储；不能把当前共享开发身份直接公开到互联网。已有公开 Sites 仍是静态演示。

模块分工见 [TEAM_HANDOFF](TEAM_HANDOFF.md)，接口见 [OpenAPI](contracts/openapi.json)。接入技能位于 `skills/qoder-cloud-agent/` 与 `skills/seedream-tryon/`，均不含密钥。
