# MUSE · 从衣橱开始的今日搭配

面向手机的穿搭应用，使用 React、TypeScript、Vite 和 Lenso UI。当前交付为**可运行的本地开发版**：衣橱、三场景草稿、AI 搭配和图片试穿已连接业务 API 与后台 Worker。

**[手机热点与安装说明](docs/MOBILE_ACCESS.md)** · **[本地启动](docs/LOCAL_DEVELOPMENT.md)** · **[完整 SPEC](docs/SPEC.md)** · **[团队交接](docs/TEAM_HANDOFF.md)** · **[API 契约 v1.1](docs/contracts/openapi.json)** · **[公开交互演示](https://muse-mobile-wardrobe.gentle-dell-0151.chatgpt.site)**

![今日搭配](docs/scene-refresh/published.png)

## 当前可用

- 今日搭配：轻松日常、周末漫步、见面时刻分别保存草稿、排版和锁定；支持自由换衣、版本冲突处理与保存。
- 衣橱：上传单品图片，确认名字和分类后入库；图片私有，支持本机旧衣物的显式同步。
- AI 搭配：Qoder 读取真实衣橱，通过两个 Custom Tools 返回候选；只有用户采纳才修改草稿。
- 图片试穿：选择默认男／女 AI 示例模特，或上传原始人物照片，再选择单件或整套，明确点击生成；Seedream 返回结果后私有转存。刷新、后台恢复、取消和未知请求状态均有对应处理。
- 记忆：确认的偏好与反馈先存数据库，再同步到每用户 Qoder Memory Store；推荐 Session 只读挂载。

截至 2026-11-17，实际创建 3 个 Qoder 搭配任务（2 个成功、1 个中断后待确认），保存 3 张 Seedream 试穿图，完成 Memory 写入和读回。手机尺寸浏览器已验证候选采纳、照片上传、刷新恢复、对比与保存；68 项测试通过。详见 [验收记录](docs/VALIDATION.md)。Dream 只有离线测试和手动命令，**未执行真实 Dream，默认关闭**。

公开 Sites 地址仍是独立的静态交互演示。真实 OIDC 登录、生产对象存储、商品数据源、自动识别、Decart 实时视频及生产发布尚待完成；开发启动会拒绝 `NODE_ENV=production`。生成图用于外观参考，不判断尺码。

## 本地启动

需要 Node.js 22.18+（推荐 `.nvmrc` 的 Node 22）和运行中的 Docker Desktop。项目也已在本机 Node 24 上联调。

```sh
npm ci
cp .env.example .env
# 首次创建后，在 .env 设置至少 24 字符的随机 SESSION_SECRET。
# 已有 .env 时不要重新覆盖；模型凭据只填在服务端。
npm run dev:full
```

打开 [http://localhost:5179](http://localhost:5179)。该命令启动 PostgreSQL 17、迁移、API、Worker 和前端。没有模型配置也可使用本地衣橱与草稿；AI 按能力开关显示未配置，不返回伪造结果。初始衣橱为空，体验素材仅在显式运行 `npm run demo:seed` 后导入。

手机访问电脑可达 IP 的 `5179` 端口，并把该精确来源加入 `APP_ORIGINS`。照片文件选择上传可在局域网 HTTP 下使用；相机及正式身份流程使用 HTTPS。配置、独立启动、恢复和故障排查见 [本地开发指南](docs/LOCAL_DEVELOPMENT.md)。

```sh
npm test         # 自动发现 *.test.mjs；无测试库时数据库用例明确跳过
npm run test:db  # 专用 muse_test 数据库，全套测试；不调用付费模型
npm run build   # 前端类型检查和生产构建
npm run check   # 测试 + 构建；CI 提供 PostgreSQL
```

只看静态原型可运行 `npm run dev`；没有业务 API 时页面明确进入演示模式，已有本地记录保留。

## 工程入口

```text
src/                         手机前端、API client、任务恢复与演示模式
apps/api/                    Fastify 路由、开发会话、CSRF、私有图片
apps/worker/                 持久任务执行、Qoder/Seedream、Memory 命令
packages/db/                 PostgreSQL 迁移、事务、租约与事件记录
packages/domain/             领域校验、公开对象、服务端配置
packages/qoder/              Agent 定义、Managed API、Memory/Dream
packages/seedream/            单件/整套图片请求、产物下载与验证
server/backend/              使用真实 PostgreSQL 的故障与权限测试
server/reference/            可复用的早期协议参考，非服务入口
skills/qoder-cloud-agent/     可移植 Qoder 接入 skill
skills/seedream-tryon/        可移植 Seedream 接入 skill
public/assets/garments/       独立单品体验素材与裁切清单
.local/media/                私有上传和结果；忽略提交
```

新同学先读 [团队交接](docs/TEAM_HANDOFF.md)，再按负责模块进入源码。OpenAPI 是对外合同；旧 `src/integrations/contracts.ts` 仅保留历史参考。不要让多人同时修改前端全局状态。

中央 AI 对话、原生事件展示、灵感/我的与搭配卡片链路见 [AI 对话与搭配内容流](docs/AI_CONVERSATION.md)。这部分保留现有 Agent 和 skill，仅增加受鉴权的原生事件读取接口。

从功能分支提交 PR，说明接口、状态、异常处理和验证结果。GitHub Actions 不调用付费模型，也不会自动更新 Sites。真实配置、个人照片、带签名链接和运行日志不进入提交或分享包。

第三方素材及组件许可见 [public/licenses](public/licenses/README.txt)。本仓库尚未额外授予自有代码与素材开源许可；公开开源前需确认授权。
