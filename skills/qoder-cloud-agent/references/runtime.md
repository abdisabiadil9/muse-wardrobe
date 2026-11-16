# 事件消费与Custom Tools运行时

## 顺序

1. 业务API持久化task和输入版本，返回task_id。
2. Worker创建/复用Session，保存映射。
3. 首次建立SSE成功，再发送user.message；立即启动消费，不能等整个流结束才发消息。
4. 将完整事件按(session_id,event_id)去重落库，处理成功后更新checkpoint。
5. 读取最新session.status_idle的stop_reason：requires_action则按event_ids定位调用事件；只执行agent.custom_tool_use，内置工具审批走另外的确认协议，不能混为Custom Tool。
6. 校验工具白名单、JSON Schema、任务owner、资源归属、版本与额度；领取工具租约。
7. 执行并持久化result，再回传user.custom_tool_result；回传响应未知先查历史。
8. 只有最新会话轮结束、有经验证结果且没有取消意图，才标业务成功。

## 事件形状（示例）

```json
{"id":"evt_CALL","type":"agent.custom_tool_use","name":"read_wardrobe","input":{"category":"top"}}
```

```json
{"id":"evt_IDLE","type":"session.status_idle","stop_reason":{"type":"requires_action","event_ids":["evt_CALL"]}}
```

回传关联evt_CALL。requires_action可能含多个调用，依赖操作按顺序执行；独立只读工具可并行，但每个结果需独立去重。不认识的工具拒绝并返回错误，不能执行任意shell或任意URL。

## 断线与写入未知

首次无Last-Event-ID只从当前尾部接收。已有Session恢复需GET历史分页，重建最新状态并接续SSE；有本地checkpoint则从checkpoint后恢复，缺checkpoint时全量补历史。补历史和建立流的竞态用订阅缓冲+历史合并或最后历史游标接续处理。

首期不请求event_deltas。启用增量时，event_start/event_delta/最终buffered可能同ID；增量不是完整业务事件，不能按同ID统一丢弃，也不能将增量游标当成已处理完整事件。

SSE heartbeat是注释；EOF/断线只表示连接结束。session.status_idle/end_turn可能对应取消，业务cancel flag必须参与判断。session.thread_status_idle不是会话完成。模型最后一句自然语言不代替结构化工具结果。

写入超时/连接丢失/5xx可能已执行：保留operation意图、task_id、session_id、call_event_id；查询对应历史。确认已有回传则继续，不重新运行工具。对不上时标unconfirmed，不能为了得到成功响应盲发同一操作。

Exactly-once不能靠SSE提供。数据库唯一约束、租约、结果缓存和事务outbox由应用实现。SDK resumableStream只负责连接续传，不负责你的业务幂等。

## 最小持久记录

task(owner,idempotency_key,input_revision,status)、session(agent_version,memory_store_id,cursor)、events(unique session/event)、tool_calls(unique session/call,result,return_state)、outbox。日志保留上游request_id和错误类型，不输出token和私人照片URL。

来源：[工具](https://docs.qoder.cn/cloud-agents/agent-tools)、[事件流](https://docs.qoder.cn/cloud-agents/api/sessions/events/stream)、[初始连接变更](https://docs.qoder.cn/cloud-agents/sse-initial-connection-behavior-change)、[事件概览](https://docs.qoder.cn/cloud-agents/api/sessions/events/overview)。
