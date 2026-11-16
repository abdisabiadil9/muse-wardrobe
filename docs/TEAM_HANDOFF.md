# MUSE 团队开发交接

从 [SPEC.md](SPEC.md) 开始，随后按岗位读 [API合同](contracts/openapi.json)、[Qoder skill](../skills/qoder-cloud-agent/SKILL.md)、[Seedream试穿](SEEDREAM_TRYON.md)。规范版本v1.0，2026-11-16。旧IMPLEMENTATION_PLAN仅保留历史参考。

## 可以现在运行的内容

项目要求Node22；前端工程位于仓库根目录：

```sh
npm ci
npm run dev -- --port 5179
npm run build
node --experimental-strip-types --test src/sceneOutfits.test.mjs
node --test server/reference/protocol.test.mjs
node --test skills/qoder-cloud-agent/scripts/request.test.mjs
```

前端当前使用本地数据。`server/reference/`只有协议参考，没有Fastify服务器、登录、数据库或真实云资源。不要给参考代码写一个.env后就宣称全链路接通。

## 分工与接口边界

| 工作流 | 负责范围 | 首个可合并任务 |
|---|---|---|
| 前端 | src/components、状态层、API client | 用OpenAPI生成类型/Mock，替换衣橱和任务状态的数据源，保留示例模式 |
| 后端 | apps/api、apps/worker（待建）、数据库迁移 | 登录、media/garments/draft CRUD、owner过滤、revision与幂等 |
| Qoder | Agent配置、事件消费、工具执行器、Memory | read_wardrobe/propose_outfit最小闭环，断线恢复与越权测试 |
| 图片 | Seedream adapter、试穿任务、产物存储 | 1张人物+1件上装的真实联调，记录样本质量和费用 |
| 商品 | 授权商品适配器、预算和尺码规则 | 返回真实SKU快照及来源时间，不要求多个平台同时接通 |

建议后端新增apps/api与apps/worker共用packages/contracts、packages/domain；不要现在为了目录整齐搬动现有前端。现有src/integrations/contracts.ts是早期原型草案（camelCase与旧路由），已标deprecated；新开发不能以它生成服务端接口。OpenAPI是对外契约，内部ORM自由选择但不能改变金额、归属、版本和任务语义。

## 配置变量（仅名称与示例，不含密钥）

| 变量 | 谁使用 | 说明 |
|---|---|---|
| APP_ORIGIN | API | 自有HTTPS域名；开发为本地 |
| DATABASE_URL | API/Worker | PostgreSQL连接，仅服务端 |
| OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET | API | 选定身份提供方，回调同源 |
| SESSION_SECRET | API | cookie/session密钥，按环境独立 |
| OBJECT_ENDPOINT / OBJECT_BUCKET / OBJECT_REGION | API/Worker | 私有S3兼容存储配置 |
| OBJECT_ACCESS_KEY_ID / OBJECT_SECRET_ACCESS_KEY | API/Worker | 最小权限对象存储凭据 |
| QODER_ACCESS_TOKEN | 开发脚本 | PAT或已置换SAT，只存在服务端环境 |
| QODER_SA_KEY | 生产Worker | 用官方SDK/认证接口置换SAT，不直接调用业务API |
| QODER_AGENT_ID / QODER_AGENT_VERSION / QODER_ENVIRONMENT_ID | Worker | 真实资源与固定版本 |
| QODER_MAX_CREDIT_COST | Worker | 每任务credit上限，按实测配置 |
| ARK_API_KEY / ARK_IMAGE_MODEL | 图片Worker | 已开通Model/Endpoint，默认候选见Seedream文档 |
| TRYON_ENABLED / DREAM_ENABLED | API/Worker | 通过验收后才打开；默认false |
| DECART_API_KEY / DECART_MODEL_ID | 后续实时Worker/API | 可选；当前不启用 |

API Key不能使用VITE_前缀，也不能写进manifest、Git或前端配置。提交.env.example只留空值和说明；真实.env忽略。同学各自使用dev资源，不分享生产PAT。

## 使用Qoder skill

开发工具支持项目skill时，直接读取 `skills/qoder-cloud-agent/SKILL.md`。Codex可复制整个 `qoder-cloud-agent` 目录到 `~/.codex/skills/`；其他工具不确定发现目录时直接把文件路径交给Agent读取，不臆造专用配置路径。

可交给开发Agent的任务：

> 读取docs/SPEC.md和skills/qoder-cloud-agent/SKILL.md，为MUSE实现Qoder Managed API适配器与read_wardrobe/propose_outfit工具循环。先用离线mock完成测试，凭据只从服务端环境读取。不要新建生产资源或执行付费任务。输出改动、测试结果和需要真实联调的配置项。

这个skill是给**开发同学/开发Agent**用的，不是让穿搭Agent在运行时获得平台管理员凭据；不要把它连同服务端密钥挂载给MUSE用户的Session。

## 联调顺序

1. 确认OpenAPI可导入，前端用mock切通成功/失败/取消/刷新场景。
2. 后端提供dev身份、测试衣橱、任务快照和事件流；两账号越权用例先通过。
3. Qoder开发者用自己的dev凭据列出模型/Agent/Environment，明确选定资源；先单任务两工具，再做重连和重复回传。
4. 图片开发者用有授权照片和衣服，先验证单件换装、产物转存、超时不重复生成，再做多件。
5. 接Memory，Dream隔离没验收时保持关闭。
6. staging自有HTTPS站真机测试，配置真实额度、日志、备份与删除周期，再开启给用户。

## 完成定义

PR必须带关联SPEC/API、真实与mock边界、至少一个错误路径的测试。接口字段变化先更新OpenAPI。没有真实上游请求返回的结果，不写“已接通”；没有真机测试，不写“iOS已验收”。照片、授权链接和凭据不放PR说明或测试截图。

开发包仅包括文档、OpenAPI、skill和协议参考，不是完整后端。原型源码在项目仓库；可分享的zip不包含node_modules、.env、Git凭据或用户本地存储。
