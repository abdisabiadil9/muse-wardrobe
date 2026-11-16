# 认证、资源和请求合同

核对：2026-11-16。以下路径均相对 `https://api.qoder.com.cn/api/v1/cloud`。

## 认证

开发：PAT放服务端环境`QODER_ACCESS_TOKEN`。生产：SA Key通过 `POST https://openapi.qoder.com.cn/api/v1/serviceToken/exchange` 换SAT，Bearer为SA Key，请求体：

```json
{"grant_type":"client_credentials","audience":"qoder","scope":"qca.access","ttl_seconds":3600}
```

响应access_token才用于业务Bearer。SAT有效期最大43200秒，过期重新置换；生产在到期前刷新并单飞，避免每个请求都换token。脚本不执行令牌置换，避免将access_token打印到终端。官方SDK可管理凭据；CN区域不能和全球站混用。

```ts
import { ManagedClient } from 'qca-sdk';
const client = new ManagedClient({
  baseURL: 'https://api.qoder.com.cn/api/v1/cloud',
  pat: process.env.QODER_PAT,
});
```

上面是PAT配置示例；正式SA凭据对象以当前SDK文档为准，不同时配置PAT与SA。官方SDK要求Node>=20.12。

## 资源API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /models | 当前账号可用模型，创建Agent时使用返回id |
| GET/POST | /agents | 列表/创建Agent |
| GET/POST | /agents/{agent_id} | 获取/更新Agent，更新产生版本按返回核对 |
| GET/POST | /environments | 列表/创建执行环境 |
| GET/POST | /sessions | 列表/创建任务会话 |
| GET | /sessions/{session_id} | 状态快照 |
| POST | /sessions/{session_id}/events | 发送用户消息或工具结果 |
| GET | /sessions/{session_id}/events | JSON历史，分页与恢复 |
| GET | /sessions/{session_id}/events/stream | SSE |
| POST | /sessions/{session_id}/cancel | 取消当前turn；不删除整个会话 |
| POST | /memory_stores | 创建独立记忆仓库 |
| POST/GET | /dreams | 发起/查询列表；单任务GET /dreams/{id} |

默认不要每次请求都创建Agent或Environment。先GET核对已有资源，只有开发任务需要时创建；失败未知时不要重复创建。创建Agent支持Idempotency-Key，其他写接口是否支持须逐项核对，不能假定普遍支持。

Environment最小请求：`{"name":"muse-dev","config":{"type":"cloud"}}`。它不是MUSE后端托管服务器。

Agent最小示例见 `../assets/agent.json`；model需替换为GET/models返回的实际可用值。工具schema为JSON Schema的object；name/description/input_schema必需；Custom Tool不配置permission_policy。内置Read可独立配置always_allow，实际业务权限仍由工具后端实施。

Session示例见 `../assets/session.json`。固定agent.id/version、environment_id及预算；需要记忆时挂载该用户Store，未开启记忆时省略resources（参考createSession的memoryStoreId可不传）。预算单位是Qoder credits，不是人民币；示例1.00只是测试上限占位，不能作为成本承诺。首次创建idle，发送user.message才启动。

## 消息与工具结果

```json
{"events":[{"type":"user.message","content":[{"type":"text","text":"请用我的衣橱为周末搭一套"}]}]}
```

```json
{"events":[{"type":"user.custom_tool_result","custom_tool_use_id":"evt_CALL_EVENT_ID","content":[{"type":"text","text":"{\"garments\":[]}"}],"is_error":false}]}
```

content是内容块数组，工具JSON作为text字符串回传。错误用is_error=true和可恢复的业务错误码，不泄露堆栈或其他用户数据。

GET历史用 `order=asc&limit=100`，沿next_page分页；page不能与before_id/after_id混用。发送事件时409可能表示Session正在执行，不等于服务排队成功。按任务状态串行发送补问。

取消：有活跃turn返回202，idle时返回200 no-op；关闭本地HTTP/SSE不等于取消云端。

来源：[认证](https://docs.qoder.cn/cloud-agents/api-authentication)、[SDK](https://docs.qoder.cn/cloud-agents/sdk/typescript)、[模型](https://docs.qoder.cn/cloud-agents/list-models-new)、[Agent](https://docs.qoder.cn/cloud-agents/agents-create)、[Environment](https://docs.qoder.cn/cloud-agents/environments-create)、[Session](https://docs.qoder.cn/cloud-agents/sessions-create)、[事件发送](https://docs.qoder.cn/cloud-agents/api/sessions/events/send)、[分页](https://docs.qoder.cn/cloud-agents/api/sessions/events/list)、[取消](https://docs.qoder.cn/cloud-agents/sessions-cancel)。
