# MUSE 本地开发指南

更新：2026-11-16。适用于当前可运行的开发版；完整产品边界见 [SPEC](SPEC.md)，分工见 [TEAM_HANDOFF](TEAM_HANDOFF.md)。本指南不会要求把密钥发进聊天或写入前端。

## 1. 准备和启动

需要 Node.js 22.18+、npm、运行中的 Docker Desktop。推荐使用 `.nvmrc` 的 Node 22，与 CI 一致。本次开发环境已验证 Node 24、Docker Desktop 4.99 / Engine 29.9.3 和 PostgreSQL 17；这些是验证记录，不是强制锁定的 Docker Desktop 版本。

首次克隆后：

```sh
npm ci
cp .env.example .env
```

已有 `.env` 不要覆盖。在文件中设置随机 `SESSION_SECRET`，至少 24 字符。先运行衣橱与草稿时，Qoder/Ark 配置可以留空。然后启动：

```sh
npm run dev:full
```

命令依次启动 Docker Compose 数据库、迁移、API、Worker 和 Vite。打开 [http://localhost:5179](http://localhost:5179)。首次 `GET /api/v1/me` 创建本地开发会话和三个空草稿，初始没有个人衣物。

| 服务       | 本地地址 / 位置         | 用途                               |
| ---------- | ----------------------- | ---------------------------------- |
| 前端       | `http://localhost:5179` | 浏览器入口，代理 `/api`            |
| API        | `127.0.0.1:8787`        | 仅监听本机；不直接给手机开放       |
| PostgreSQL | `127.0.0.1:55432`       | Docker Compose 的持久数据库        |
| 私有媒体   | `.local/media/`         | 上传原图、标准化单品图和生成结果   |
| 公开原型   | Sites 演示链接          | 独立静态内容，不连接这台电脑的后端 |

开发会话使用固定身份，是本机联调便利功能；同一服务下的设备共用开发账号。它不是正式多用户登录。当前程序拒绝生产模式启动，避免把开发身份直接公开上线。

Ctrl+C 停止前端、API 和 Worker，数据库及 Docker 数据卷保留。需要停止数据库时运行 `docker compose stop`。不要把删除数据卷作为普通重启操作。

## 2. 手机访问

电脑与手机需要能相互访问。启动输出会列出电脑 IP 候选；手机打开 `http://<电脑IP>:5179`。手机的 `localhost` 指手机自身。

把实际浏览器来源加入服务端配置，例：

```dotenv
APP_ORIGIN=http://localhost:5179
APP_ORIGINS=http://localhost:5179,http://127.0.0.1:5179,http://<电脑IP>:5179
```

将占位 IP 换成实际地址，不使用通配符。修改后重启 API/Worker。写请求同时检查 Origin 和 CSRF；媒体上传和下载返回同源相对路径，手机不需要访问 `8787`。

局域网 HTTP 可以使用文件选择器上传照片；前端在 Web Crypto 不可用时用本地 SHA256 实现完成校验。浏览器相机、正式身份与主屏幕体验仍需 HTTPS 和真机验证。Decart 实时摄像头生成尚未接通。

## 3. 衣橱与体验素材

可先上传一张单品图，确认名字和分类，再加入场景草稿。不要求先完成自动识别或抠图。Live 模式不会默认把公开素材算成个人已拥有衣物。

需要课堂演示数据时，显式运行：

```sh
npm run demo:seed
```

该入口导入 12 件明确标记“体验”的独立单品和三个场景，用途是测试与展示。不要把这些素材描述成用户真实衣橱。单品裁切来源、矩形和 hash 在 `public/assets/garments/manifest.json`；不要将包含四件衣服的 sprite 原图传给图片模型。`npm run db:seed` 仅准备开发用户和空草稿，不等同于导入体验衣橱。

在“我的”中可显式同步过去在本机演示里添加的衣物；原本地记录和备份保留，失败项可续传。当前不会自动迁移所有示例搭配或把公共示例批量变成个人资产。

## 4. 开启真实 Qoder 搭配

仅使用自己的开发资源。配置服务端 `QODER_ACCESS_TOKEN`（PAT 或已置换 SAT）；当前运行时不自动兑换、刷新 SA 凭据。查看资源准备计划：

```sh
npm run qoder:setup
```

需要实际创建/复用本项目开发 Agent 和 Environment 时：

```sh
npm run qoder:setup -- --execute
```

脚本检查可用模型，使用 `packages/qoder/agent.mjs` 的工具定义，固定返回的 Agent 版本，并把资源 ID 写入本机 `.env`。它不启动 Session 或用户 turn；资源创建未知时记录 `.local/qoder-setup.json`，先对账，不反复创建。已有同名 Agent 会复用，**修改工具或指令后仍须显式发布新版本并核对配置**。

运行需要 `QODER_AGENT_ID`、`QODER_AGENT_VERSION`、`QODER_ENVIRONMENT_ID`、`QODER_MAX_CREDIT_COST`；可选 `QODER_MODEL` 用于 setup。修改配置后重启。只有用户点击“AI 帮我搭”才提交任务；选择衣物和保存不会运行模型。

`QODER_MAX_CREDIT_COST` 是上游每 Session 的 credits 上限，不是人民币价格。`DAILY_TASK_LIMIT` 是本地每类任务额度；已发出但费用未知的操作不会因取消或失败直接释放。

## 5. 开启图片试穿

配置 `ARK_API_KEY`、已开通的 `ARK_IMAGE_MODEL`，并设置 `TRYON_ENABLED=true`。当前适配器验证基线为 Seedream 5.5，默认 `doubao-seedream-5-5-261028`；支持对应已开通 Endpoint ID，不自动开通资源或切换模型。

先上传一张原始人物照片，在草稿中选衣，再明确选择单件或整套并点击生成。单件只替换原照片的一件；整套使用当前非空槽位。两者都从原始人物图开始，不拿上一张生成图继续叠加。详细协议与限制见 [SEEDREAM_TRYON](SEEDREAM_TRYON.md)。

输入从私有文件读取并由服务端转换为 data URL，因此本地开发无需把照片开放成公网 URL。每任务只提交一次生成请求。结果未知显示 `unconfirmed`，不会自动重生成；取得产物后下载失败只恢复下载。主动重新生成会创建新任务，可能产生新费用。

## 6. Memory 与 Dream

Memory 是可选能力。设置 `MEMORY_ENABLED=true` 后，为已存在的用户显式准备 Store：

```sh
npm run memory -- provision <用户UUID>
npm run memory -- sync
```

用户 UUID 从 `GET /api/v1/me` 获取。已有 Store 只有在核对归属后才能用 `npm run memory -- bind <用户UUID> <StoreID>` 绑定。服务启动不会批量创建云资源。

偏好通过 `PATCH /preferences` 保存，真实反馈通过 `POST /wear-feedback` 保存；同意同步的记录由维护循环或 `memory -- sync` 写入 `preferences/profile.md` 与 `wear-feedback/<id>.md`。当前设置界面并未覆盖全部 API，可用有会话/CSRF 的本地集成脚本联调。Store 未配置时同步任务保留 `waiting_config`，搭配仍可不带 Memory 运行。照片和生成试穿图不会写进记忆。

Dream 保持 `DREAM_ENABLED=false`。已实现 `memory -- dream <用户UUID>` 和 `memory -- reconcile-dream <任务UUID> --isolation-verified` 的手动开发路径，但真实 Dream 未执行。只有平台隔离和派生内容删除策略通过验收后才可启用；命令中的标记必须对应实际验证，不能用它跳过验证。每日自动整理尚未实现。

## 7. 单独运行与测试

需要分开查看各进程时：

```sh
docker compose up -d --wait
npm run db:migrate
npm run api
# 另一个终端
npm run worker
# 再一个终端
npm run dev
```

`api`、`worker`、迁移和 Memory 命令读取服务端 `.env`；`npm test` 不读取供应商配置。

```sh
npm test
npm run test:db
npm run build
```

测试会从 `src/`、`server/`、`packages/` 和 `skills/` 自动发现 `*.test.mjs`。未提供 `TEST_DATABASE_URL` 时，数据库测试明确显示跳过。`test:db` 创建/使用专门的 `muse_test` 数据库，拒绝任意业务库名，移除测试子进程中的模型凭据；测试使用模拟上游，不发真实模型请求。CI 提供 PostgreSQL 并运行检查；最终验证结果另行记录，不把本地通过等同于线上 CI 已通过。

## 8. 常见情况

| 现象                    | 检查                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| 页面进入演示模式        | API 是否启动；Vite 的 `/api` 代理是否可访问；静态 Sites 本来就是演示          |
| 首次启动报密钥长度不足  | 配置本地 `SESSION_SECRET`，不要把内容贴到报错截图                             |
| `403 origin_rejected`   | 浏览器地址必须精确列入 `APP_ORIGINS`，包含协议和端口；重启 API                |
| `403 csrf_rejected`     | 重新 GET `/me` 并使用该会话的 `X-CSRF-Token`，不要混用不同浏览器 cookie       |
| AI 按钮显示未配置       | 检查服务端资源 ID/版本、模型配置和能力开关，重启后查看 `/capabilities`        |
| 图片链接过期            | 再 GET `/media/{id}`；不要把短期链接永久写死                                  |
| `409 revision_conflict` | 保留本机选择，载入云端或明确重新应用；不静默覆盖                              |
| `unconfirmed`           | 保留原 task ID，核对上游记录；不要换幂等键循环重发                            |
| Docker 命令不存在       | 启动/安装 Docker Desktop；macOS 启动器会查常见安装路径，也可设置 `DOCKER_BIN` |
| 端口被占用              | 检查旧 Vite/API 进程；前端使用固定 5179，API 使用 8787                        |

当前不支持的业务入口包括真实 OIDC、自动衣物识别、购买建议及 Decart。它们返回明确未配置；商品/灵感列表目前为空，静态演示另有标记。账户有云端 Session/Memory 等记录时，删除会冻结账户并显示待人工处理的错误，不能据此宣称供应商数据已全部删除。
