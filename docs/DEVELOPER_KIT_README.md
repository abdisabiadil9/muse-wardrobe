# MUSE 开发交接包 v1.1

更新：2026-11-17。完整可运行代码在 [GitHub 仓库](https://github.com/mistake-12/muse-wardrobe)。此 ZIP 提供规格、API 合同和两份可移植 skill，不替代完整源码仓库。

1. 先读 `docs/SPEC.md`，再按 `docs/LOCAL_DEVELOPMENT.md` 启动本地服务。
2. `docs/TEAM_HANDOFF.md` 说明分工；`docs/contracts/openapi.json` 提供应用 API。
3. Qoder 接入使用 `skills/qoder-cloud-agent/`；图片试穿使用 `skills/seedream-tryon/`。复制整个目录，不只复制 SKILL.md。
4. `docs/SEEDREAM_TRYON.md` 解释单件、整套、人物原图及失败恢复。
5. `docs/VALIDATION.md` 记录本轮验证及尚未验证内容。

仓库已经包含 Fastify、PostgreSQL、持久 Worker、真实 Qoder 与 Seedream 接入。Dream 手动路径已实现但真实运行未验收；正式公网登录、实时商品和 Decart 仍留后续。

安装 skill：把对应目录复制到自己开发工具支持的 skill 目录。Seedream skill 独立执行时在其目录运行 `npm install`；默认请求预览不会读取密钥或联网。真实执行必须在已授权范围内显式使用 `--execute`。

密钥由每位同学自行配置在服务端 `.env`。此包不含真实凭据、用户照片或云端生成产物。公开原型继续作为独立演示，不连接本地业务后端。
