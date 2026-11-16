# MUSE 开发交接包 v1.0

更新：2026-11-16。这个包可直接发给开发同学。

1. 先看 docs/SPEC.md：产品闭环、手机部署、架构、数据、任务与验收。
2. 按 docs/TEAM_HANDOFF.md 分工；docs/contracts/openapi.json 可导入接口工具或生成客户端类型。
3. Qoder 开发读取 skills/qoder-cloud-agent/SKILL.md；整个 skill 目录可复制安装。
4. 图片开发读取 docs/SEEDREAM_TRYON.md。
5. server/reference 是离线验证的协议参考；应用登录、数据库、Worker、真实模型和商品服务仍待实现。

## 无凭据验证（Node22）

```sh
node --test server/reference/protocol.test.mjs skills/qoder-cloud-agent/scripts/request.test.mjs
node skills/qoder-cloud-agent/scripts/request.mjs request --method GET --path /agents
```

默认只预览请求，不读取token、不联网。不要把 .env、真实照片、平台凭据交给前端或提交到仓库。

这个交接包不含前端工程。运行 npm ci / npm run dev 需要完整的 muse-mobile 源码仓库。公开原型：https://muse-mobile-wardrobe.gentle-dell-0151.chatgpt.site
