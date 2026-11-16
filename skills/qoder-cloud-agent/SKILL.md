---
name: qoder-cloud-agent
description: 为应用集成 Qoder Cloud Agents 中国站 Managed API，处理 Agent、Session、SSE、Custom Tools、原生 Memory 和 Dream；用于开发、联调与排障，不用于 Qoder IDE 编程操作或 Forward API。
---

# Qoder Cloud Agent 接入

给开发同学及开发Agent使用的可移植skill。核对日期2026-11-16，协议为中国站Managed API。读取项目SPEC确定业务边界；本skill不授予创建云资源、发送用户数据或付费调用的额外权限。只有文档/实现请求时用离线样例和mock完成，不为“验证文档”消耗云额度。

## 选择入口

- 首次搭建、资源和认证：读 [api.md](references/api.md)。
- 实现SSE与工具循环、排查卡住或重复调用：读 [runtime.md](references/runtime.md)。
- 接入Memory/Dream：读 [memory.md](references/memory.md)。
- MUSE实际工具/任务约束：读项目 `docs/SPEC.md` 第6节；独立使用此skill时由调用方提供业务repository，不擅自创建数据库。

## 必须保留的协议边界

1. CN Managed基址固定为 `https://api.qoder.com.cn/api/v1/cloud`；使用PAT或SAT。SA Key只能换SAT，不能直接当业务Bearer。不要把Forward的identity/template字段混进Managed Session。
2. 凭据仅从服务器环境或密钥管理读取；不写源码、前端、日志、截图或提示词。开发skill不要上传到面向终端用户的Agent并附上平台凭据。
3. Agent配置可复用；Session按业务任务隔离，Memory按用户隔离。工具执行时owner从已认证任务取，拒绝模型传入其他user_id。
4. 先建立SSE，再发首次消息；无游标连接只接尾部。恢复必须补历史/分页、保存游标并去重；EOF、agent.message和thread idle都不是任务完成。
5. Custom Tools由应用后端执行。按最新 `session.status_idle.stop_reason.event_ids` 解析待执行事件；回传 `custom_tool_use_id` 必须是调用事件的 `evt_` ID，不是工具名/另一个工具内部ID。
6. 工具结果先持久化再回传；POST超时可能已成功，先对账，不能自动重复副作用。应用幂等键不自动等于上游幂等。
7. 内置 `enabled_tools: []` 会开启全部内置工具；无工具需求则省略工具集，不用空白名单表达关闭。
8. Dream生成新Store副本；校验、同步期间变更、比较版本后切换当前Store。只传同用户Session列表仍需验证平台级隔离。

## 随附脚本

需要Node22；无第三方依赖。

```sh
node scripts/request.mjs --help
node scripts/request.mjs request --method GET --path '/agents?limit=20'
node scripts/request.mjs request --method POST --path /sessions --body assets/session.json
node --test scripts/request.test.mjs
```

默认只是本地预览，不读取token、不联网。选定真实资源、替换样例ID并确认调用在用户任务范围内后，加 `--execute` 才会联网；凭据从 `QODER_ACCESS_TOKEN` 读取。不要把token放命令参数。

```sh
node scripts/request.mjs request --method GET --path '/agents?limit=20' --execute
node scripts/request.mjs stream --session sess_REAL_ID --last-event-id evt_REAL_ID --execute
```

脚本不自动分页、不自动重试、不自动执行Custom Tools，流默认60秒超时；输出含用户会话数据时不要提交到仓库。`scripts/qoder-client.mjs`提供更具体的Session/事件/Memory/Dream方法，可注入fetch做离线测试，仍需应用实现持久队列、恢复与鉴权。

生产可使用官方`qca-sdk`的`ManagedClient`并锁版本。脚本只是可审查的协议调用入口，不替代完整生产运行时。

## 开发完成标准

验证：跨用户引用被拒绝；工具重复事件不重复执行；未知写入先对账；断线/刷新恢复；没有有效候选不假成功；Dream副本提升和并发更新正确。报告必须区分离线测试、已实际发出的请求和待配置项。权限/认证失败停止该线上分支；未确认的写入保留原任务ID，不换key/账号“试到成功”。

官方来源入口：[文档](https://docs.qoder.cn/cloud-agents/agents-list)。具体字段来源已列在相应reference中；遇到版本不符先核对该接口的官方契约，不能根据其他平台的SDK猜字段。
