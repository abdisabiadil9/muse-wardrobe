# Qoder Managed API 接入参考

核对日期：2026-11-16。这里是可导入、已做本地协议测试的服务端模块，**不是已部署的 API 服务**。没有读取任何真实凭据、创建云资源或发送真实用户数据。前端仍用演示数据。

## 文件与运行

- `qoder-client.mjs`：重导出 `skills/qoder-cloud-agent/scripts/qoder-client.mjs`，交接时保留两个目录；固定中国站 origin 的 HTTP adapter；Session、消息、SSE、工具结果、Memory、Dream。
- `muse-tools.mjs`：Agent 声明、两项最小业务工具、待执行工具识别和任务状态映射。
- `protocol.test.mjs`：使用注入的假 HTTP 传输验证协议，不调用云端。

需要支持内置 `fetch`、`AbortSignal.any` 的 Node.js（建议使用维护中的 LTS）。在项目根目录运行：

```sh
node --test server/reference/protocol.test.mjs
```

生产接入优先考虑官方 `qca-sdk` 的 `ManagedClient`。本参考用标准 fetch 明确展示线上协议，避免把 Ark 或 Forward 的契约混进来。若换 SDK，锁定版本并保留本测试所表达的恢复和权限要求。

## 真正接入时的使用方式

调用方须先完成 MUSE 用户登录和 task 归属验证；所有 ID 从后端数据库取，不能直接采信前端传入的 Qoder ID。

```js
import { QoderClient } from './qoder-client.mjs';

const qoder = new QoderClient({ accessToken: process.env.QODER_ACCESS_TOKEN });
// 开发用 PAT；正式服务用 SAT，定期换取新令牌并更新 adapter 实例。
const session = await qoder.createSession({
  agentId: config.agentId,
  agentVersion: config.agentVersion,
  environmentId: config.environmentId,
  memoryStoreId: authenticatedUser.currentMemoryStoreId,
  taskId: task.id,
  maxCreditCost: config.maxSessionCreditCost,
});
// 必须持久化 session.id 与 task/user 的映射，并记录每次写请求的意图。
const connection = await qoder.connectEvents(session.id);
// 连接成功后启动 worker 消费器，再发消息。不能先 await 整个消费循环。
const consuming = consumeInWorker(connection.events, task);
await qoder.sendMessage(session.id, '按本次任务的已确认场合和衣橱生成搭配建议');
// consuming 的生命周期由 worker 管理，不与手机页面的连接绑定。
```

`config`、数据库、`consumeInWorker` 和用户鉴权是**待实现的应用层**，不是这个模块已经提供的服务。

消费器的必要顺序：

1. 将完整事件按 `(session_id, event_id)` 持久化；仅把消息文本/任务进度等需要的内容发给前端。
2. 收到 `agent.custom_tool_use` 先缓存调用。等最新 `session.status_idle.stop_reason.type === 'requires_action'` 后，按 `event_ids` 找到待处理调用。
3. 在数据库领取 `(session_id, event_id)`，防止多个 worker 重复执行。调用 `executeReadOnlyTool`，传入后端认证得到的 owner 和受 owner 限制的 repository。
4. 保存工具结果，再调用 `sendToolResult`；失败先查历史，不重新执行业务动作。工具校验失败回传 `is_error: true` 和稳定的错误码，不回传内部堆栈。
5. `propose_outfit` 返回内部 `outfit_candidate`，不能直接当公共 `OutfitProposal`。应用校验category/锁定/owner/revision，持久化并生成 proposal_id、补齐 draft_revision 后再发布；`taskState` 也只是内部协议信号，按SPEC映射公共状态。有效结果单独存为候选。只有当前 turn 正常结束、候选校验通过且用户未取消时，任务才标记成功。`end_turn` 也可能来自取消，不能仅靠它判断业务成功。
6. 完整事件处理后才推进 checkpoint。重连使用 `Last-Event-ID`；第一次启动/进程重启/检测到缺口时分页补历史并与实时事件按 ID 合并。

## 参考实现的边界

没有 HTTP 路由、身份系统、PostgreSQL 仓库、持久任务队列、自动重连、分布式领取或真实商品搜索；不要直接把这个目录暴露成公网服务。SSE 默认只消费完整事件，没有启用文本增量；若加增量预览，需区分共用 ID 的多个 delta 与最终完整事件。

`connectEvents` 的 `close()` 只关闭本地订阅，不取消云端 turn；用户点击取消时，应用还需调用 Qoder 的 cancel 端点并持久化取消状态。

Dream 的显式 Session 列表是输入范围，不替代应用归属验证或平台权限隔离。多用户生产环境还应验证 Dream 的回顾范围，必要时用 Qoder 业务空间/服务账号隔离租户。

官方来源：[工具](https://docs.qoder.cn/cloud-agents/agent-tools)、[权限与 pending action](https://docs.qoder.cn/cloud-agents/permission-policies)、[Session](https://docs.qoder.cn/cloud-agents/sessions-create)、[发送事件](https://docs.qoder.cn/cloud-agents/api/sessions/events/send)、[SSE](https://docs.qoder.cn/cloud-agents/api/sessions/events/overview)、[Memory](https://docs.qoder.cn/cloud-agents/memory-stores)、[Dream](https://docs.qoder.cn/cloud-agents/create-a-dream)、[TypeScript SDK](https://docs.qoder.cn/cloud-agents/sdk/typescript)。
