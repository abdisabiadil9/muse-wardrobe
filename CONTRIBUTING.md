# 开发协作

1. 先读 `docs/SPEC.md` 和 `docs/TEAM_HANDOFF.md`，确认本次负责的模块。
2. 从最新 `main` 创建分支，例如 `feat/wardrobe-api`、`feat/seedream-tryon`、`fix/scene-state`。
3. 修改公共接口时同步更新 `docs/contracts/openapi.json`；所有资源查询保留 owner 约束，所有金额使用整数分。
4. `npm run check` 通过后提交 Pull Request。说明改了什么、如何验证、哪些仅为 mock、哪些真实服务仍待配置。
5. 不提交 `.env`、访问令牌、真实用户照片、数据库导出、生成的授权链接或本机依赖。开发者使用各自的 dev 资源。
6. AI 任务须覆盖重复提交、断线恢复、取消、未知上游结果和越权；免费离线测试与真实付费联调分开。

前端原型可在没有凭据时运行；不要通过伪造成功结果掩盖后端尚未配置。现有公开站点由项目维护者单独发布，普通 PR 不自动发布。
