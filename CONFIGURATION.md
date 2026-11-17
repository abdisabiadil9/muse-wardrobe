# MUSE 配置与启动

## 首次运行

安装 Node.js 22.18+ 和 Docker Desktop，启动 Docker 后执行：

```sh
git clone https://github.com/mistake-12/muse-wardrobe.git
cd muse-wardrobe
npm ci
cp .env.example .env
```

在本机编辑项目根目录 `.env`。只在首次运行时复制模板，已有文件不要覆盖。

## 必填与模型配置

| 变量 | 填写内容 |
| --- | --- |
| `SESSION_SECRET` | 本机生成的随机会话密钥，至少 24 字符 |
| `DATABASE_URL` | 本地沿用模板；Docker PostgreSQL 仅绑定 `127.0.0.1:55432` |
| `QODER_ACCESS_TOKEN` | 自己的 Qoder Cloud Agents PAT 或 SAT |
| `QODER_AGENT_ID` | Qoder 初始化脚本写入的 Agent ID |
| `QODER_AGENT_VERSION` | 初始化脚本固定的版本 |
| `QODER_ENVIRONMENT_ID` | 初始化脚本写入的 Environment ID |
| `QODER_MAX_CREDIT_COST` | 每 Session 的 Qoder credits 上限，不是人民币价格 |
| `ARK_API_KEY` | 自己的火山方舟 API 密钥，供 Seedream 使用 |
| `ARK_IMAGE_MODEL` | 已开通的模型或兼容 Endpoint；模板默认 `doubao-seedream-5-5-261028` |
| `TRYON_ENABLED` | 图片试穿开关，模板为 `true` |
| `APP_ORIGINS` | 允许访问的完整来源，以逗号分隔，包含协议与端口 |
| `MEDIA_ROOT` | 私有图片目录，默认 `.local/media` |

生成会话密钥，再将输出填写到 `.env` 的 `SESSION_SECRET`：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

没有配置模型密钥时可先使用衣橱和草稿；AI 功能会明确显示未配置。

## 初始化 Qoder 并启动

填写 `QODER_ACCESS_TOKEN` 后运行：

```sh
npm run qoder:setup -- --execute
npm run dev:full
```

第一条创建/复用该账号的开发 Agent 和 Environment，并把资源 ID 和版本写回 `.env`；不启动搭配请求。第二条启动数据库、迁移、API、Worker 和前端。打开 http://localhost:5179 。仅启动前端无法执行真实 AI 任务。

首次衣橱为空。在另一终端可运行 `npm run demo:seed` 导入明确标记的体验衣物；也可自行上传。实际发送搭配请求、生成试穿图会使用账号模型额度。

Memory 为可选配置，Dream 默认关闭；详见 [本地开发指南](docs/LOCAL_DEVELOPMENT.md)。更换密钥、模型或允许访问来源后重启服务。

## Android APK 与手机热点

从 [Releases](https://github.com/mistake-12/muse-wardrobe/releases) 下载 `muse-demo-debug.apk`。电脑连上手机热点后：

```sh
npm run phone:setup
# 停止旧服务，再运行：
npm run dev:full
```

在 APK 中填写脚本输出的电脑地址，例如 `http://192.168.43.20:5179`，不能填写手机的 localhost。APK 是 WebView 演示壳，需要电脑服务在线，不包含密钥、数据库或离线模型。

## 密钥与数据

- 真实密钥仅在部署者的 `.env` 中，由服务端 API/Worker 使用。不得添加 `VITE_` 前缀，也不要放进前端或 APK。
- `.env`、`.env.*`（模板除外）、私有媒体、运行日志和私钥文件已被 Git 忽略。公开仓库不会提供任何可用的模型凭据。
- 模板数据库账号/密码是可见的本地开发默认值，不是云数据库凭据。不要直接用于公网部署。
- 各组员部署的数据独立；共享现有数据需另行备份数据库和私有媒体。对话历史索引目前保存在各设备浏览器中。
- 当前版本使用共享开发身份，程序拒绝生产模式启动。正式公网部署还需真实登录、HTTPS、持久存储及 API/Worker 服务配置；不能直接暴露开发服务。

详细交接步骤见 [团队快速开始](docs/TEAM_QUICKSTART.md)，实现边界见 [SPEC](docs/SPEC.md)。
