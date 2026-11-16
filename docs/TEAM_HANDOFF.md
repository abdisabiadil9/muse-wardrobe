# MUSE 团队开发交接

规范 v1.1，2026-11-16。先按 [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md) 启动，再读 [SPEC](SPEC.md)、[OpenAPI](contracts/openapi.json) 和负责模块源码。早期 `IMPLEMENTATION_PLAN.md`、`src/integrations/contracts.ts` 仅保留历史参考。

## 已交付的开发基线

React/Lenso 前端已增加 Live 数据源和任务恢复；Fastify、PostgreSQL、独立 Worker、私有本地图片、Qoder 两工具、Seedream 单件/整套和 Memory 同步均有实际实现。数据库中的业务事实与浏览器演示数据分开，切换演示不会伪装成真实任务成功。

已真实验证：Qoder 五件搭配候选和只读 Memory 挂载；Seedream 单件适配器请求、经 API/Worker 的五件整套生成及私有结果保存；Memory Store 建立、偏好文件同步与远端读回。Dream 未真实执行，生产身份/对象存储/商品源/自动识别/实时视频未完成。

## 文件所有权与下一步

| 工作流     | 当前入口                                                         | 后续重点                                                              |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 前端       | `src/Application.tsx`、`LiveApp.tsx`、`api/`、`hooks/useTask.ts` | 真机恢复、空衣橱、设置/反馈界面、旧记录迁移；只由一位整合者改全局状态 |
| API / 数据 | `apps/api/`、`packages/db/`、`packages/domain/`                  | 正式 OIDC、对象存储适配、完整账户删除、限流与运营观测                 |
| Qoder      | `packages/qoder/`、`apps/worker/runtime.mjs`                     | 新 Agent 版本、工具恢复回归、费用对账；不要重写一套平行协议           |
| 图片       | `packages/seedream/`、`skills/seedream-tryon/`                   | 代表性样本质量评估、输出/成本记录、物件遮挡与复杂叠穿                 |
| Memory     | `packages/qoder/memory.mjs`、`apps/worker/memory-command.mjs`    | 同步错误恢复、隐私清理、Dream 租户隔离与派生摘要来源                  |
| 商品       | SPEC 第9节，当前没有真实适配器                                   | 一个获授权的数据源、SKU/价格快照、预算与尺码规则                      |

后端当前用 Node ESM `.mjs`，前端用 TypeScript。OpenAPI v1.1 是公开合同；前端 API 类型与服务端校验需同时保持一致。不要创建同名但不同字段的第二套合同，也不要为了目录整齐搬动现有前端。

## 每位同学的第一次验证

```sh
npm ci
# 仅首次：从 .env.example 建立自己的服务端 .env，配置 SESSION_SECRET
npm run dev:full
npm run test:db
npm run build
```

先验证空衣橱→上传→手动录入→编辑草稿→保存。需要体验素材时显式运行 `npm run demo:seed`，不要默认加载成真实个人资产。再用自己的开发资源开启 AI。数据库测试使用 `muse_test`，不调用付费模型。

Qoder setup、Memory provisioning 及实际图片生成会接触真实资源，按当前开发任务授权执行；不要为验证文档额外创建生产资源或反复生成。`npm run qoder:setup` 默认预览，只有 `--execute` 才联网准备资源。

## 配置边界

| 当前配置                                                          | 谁使用            | 约定                                                     |
| ----------------------------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `APP_ORIGIN` / `APP_ORIGINS`                                      | API               | 精确浏览器来源白名单；手机 IP 改变后更新并重启           |
| `DATABASE_URL` / `TEST_DATABASE_URL`                              | API/Worker / 测试 | 业务库与测试库分开，测试库名以 `muse_test` 开头          |
| `SESSION_SECRET` / `DEV_AUTH_ENABLED`                             | API               | 本地会话；生产启动目前禁止                               |
| `MEDIA_ROOT`                                                      | API/Worker        | 默认 `.local/media`，仅私有文件，不提交                  |
| `QODER_ACCESS_TOKEN`                                              | Qoder / setup     | PAT 或已置换 SAT；不支持把 SA Key 直接作为业务 Bearer    |
| `QODER_AGENT_ID` / `QODER_AGENT_VERSION` / `QODER_ENVIRONMENT_ID` | Worker            | 按任务固定资源版本；setup 不自动升级已有同名 Agent       |
| `QODER_MAX_CREDIT_COST` / `DAILY_TASK_LIMIT`                      | API/Worker        | Session credits 上限与本地任务数额度，二者不等价于人民币 |
| `ARK_API_KEY` / `ARK_IMAGE_MODEL` / `TRYON_ENABLED`               | 图片 Worker/API   | 已开通的模型，默认单次一张输出                           |
| `MEMORY_ENABLED` / `DREAM_ENABLED`                                | API/Worker        | Memory 需用户 Store；Dream 默认关闭且未实测              |

OIDC、S3/TOS/OSS、生产 SAT 自动刷新、Decart 的配置属于后续实现，不要求新同学先填一整套暂未消费的环境变量。所有凭据仅在服务器读取；禁止 `VITE_` 密钥、源码明文、运行日志和截图泄漏。

## 不可破坏的合同

- 客户端只发记录 ID；owner 从会话取得。跨用户衣物、图片、任务、Store 不可引用。
- 草稿保存使用 `expected_revision`；任务绑定 `draft_id/draft_revision` 快照。候选采纳是单独的用户动作。
- 创建/保存带 `Idempotency-Key`。同键异内容返回 409；网络响应丢失用原键查询，不能创建第二次副作用。
- 图片任务必须有 `mode=single|outfit`；single 要求 `target_slot`，outfit 禁止该字段并使用非空草稿槽位。两者都用原始人物图。
- Qoder complete 事件先持久化；仅执行最新 requires_action 指定的 `evt_`；工具结果先存后回传。消息对账只匹配本轮新增事件。
- Worker 租约带令牌；旧进程不能提交新执行者的结果。生成检查点与已保存结果可恢复，未知 POST 不自动再发。
- 原图删除要使相关生成结果不可下载；生成结果发布与取消/输入状态复查在同一事务内。
- Memory 写入先有明确用户记录。更新/删除与同步共用用户锁，不能吞掉较新的删除；Dream 不自动运行。

## 使用两个接入 skill

- [Qoder skill](../skills/qoder-cloud-agent/SKILL.md)：Managed API、事件、Custom Tools、Memory/Dream；应用入口在 `packages/qoder` 与 Worker。
- [Seedream skill](../skills/seedream-tryon/SKILL.md)：输入语义、图序、单次请求与产物恢复；应用入口在 `packages/seedream`。

它们给开发同学和开发 Agent 使用，不上传给面向终端用户的穿搭 Agent，也不附带平台凭据。可复制整个 skill 目录给支持该机制的开发工具；独立使用时遵循 skill 内的依赖说明。

可交给下一位开发者的任务示例：

> 读取 SPEC、OpenAPI 和当前负责模块，为一个明确缺口提交小型变更。保持已有成功结构与恢复语义；先用模拟上游和真实测试库验证正常及失败路径，不调用真实模型。报告改动、测试、影响的接口和真实联调前提。

## PR 与发布标准

每个 PR 标明关联接口、状态变化、错误路径、验证命令和剩余限制。字段变更先更新 OpenAPI，再同步服务端与前端。普通文案或样式不增加无意义测试；状态、权限和副作用改动必须覆盖实际风险。

本地最低检查为 `npm run test:db`、`npm run build`；CI 用 Node 22 与 PostgreSQL 执行检查。真实接入、模型质量和实体手机测试分别记录，不能互相替代。共享代码包不含 `.env`、`.local`、个人媒体、带签名 URL、`node_modules` 或 Git 凭据。

公开 Sites 不随 GitHub 推送自动更新，也不托管当前 Node Worker/PostgreSQL。正式发布前完成 SPEC 的生产待办；本机联调成功不等于可直接公网运营。
