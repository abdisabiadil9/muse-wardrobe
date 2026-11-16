# Seedream 图片试穿实现合同

版本 v1.1，更新 2026-11-16。当前已实现单件与整套图片试穿，并完成一次单件适配器请求和一次五件整套 API/Worker 请求的真实验证；结果已下载、验图并私有保存。样本数量仍不足以说明普遍质量或准确尺码。Decart 实时视频属于后续独立能力。

实现入口：[packages/seedream](../packages/seedream/index.mjs)、[Worker](../apps/worker/runtime.mjs)、[独立 skill](../skills/seedream-tryon/SKILL.md)。公开输入/输出以 [OpenAPI v1.1](contracts/openapi.json) 为准。

## 1. 能力与模型边界

图片模型根据人物和服装参考生成外观预览，不进行物理布料仿真、身体测量或尺码承诺。Qoder 负责搭配建议，Seedream 负责独立的图片任务；上传图片字节不会经 Qoder 转发。

当前验证基线为 Seedream 5.5，默认模型 `doubao-seedream-5-5-261028`。`ARK_IMAGE_MODEL` 可指定该已开通模型或相应 Endpoint ID。适配器不自动开通资源、不降级到其他模型；切换能力版本需要重新验证输入/输出合同。任务冻结模型和 `seedream-tryon-v1` 提示词版本，排队期间配置变化时在发送前拒绝静默换用新配置。

供应商该模型最多支持 10 张参考图；项目只接受 1 张原始人物图和最多 5 张单品图，一次输出 1 张图。每张应用上传不超过 10 MB；格式为 JPEG/PNG/WebP，服务端核对 MIME、解码、尺寸、SHA256 并去除 EXIF。复杂叠穿、鞋、围巾和遮挡仍属于重点质量验收范围。

## 2. 两种明确的产品语义

| 模式     | 输入                                  | 生成要求                                                 |
| -------- | ------------------------------------- | -------------------------------------------------------- |
| `single` | 原始人物照片 + 草稿指定槽位的一件衣服 | 只替换原照片该单品，尽量保持其余衣物、人物与背景         |
| `outfit` | 原始人物照片 + 当前草稿所有非空槽位   | 按整套参考生成，明确内外层、鞋和配饰；未指定服饰保留原图 |

两种模式都从同一张原始人物图重新生成，不拿上一次结果继续叠加。用户在整套里只换选裤子，如果期望保留此前选好的外套和鞋，应以更新后的完整草稿再做 outfit；这与“只替换原照片里的裤子”不同。

操作顺序为：上传/选择人物原图 → 确认草稿与模式 → 同意 `tryon-photo-v1` 所说明的用途 → 点击生成 → 查看原图/结果 → 保存图片或保存搭配。选衣本身不自动调用模型。失败后显示真实错误，不用预生成素材替代成成功结果。

## 3. 自有 API 和冻结快照

`POST /api/v1/tryon-tasks` 使用当前会话、`X-CSRF-Token` 和 `Idempotency-Key`。整套示例：

```json
{
  "draft_id": "00000000-0000-4000-8000-000000000001",
  "draft_revision": 4,
  "person_asset_id": "00000000-0000-4000-8000-000000000002",
  "consent_version": "tryon-photo-v1",
  "mode": "outfit"
}
```

单件将 `mode` 设为 `single`，并增加 `target_slot: "top"`。可用槽位为 `coat/top/bottom/shoes/bag`；outfit 禁止传 target_slot，要求至少一个非空槽位。图中的 UUID 仅示例，真实请求必须引用当前账号的记录。

API 校验：人物必须是本人可用的 `kind=person` 原始资产，不能用 tryon_result；草稿 owner/revision 一致；所有单品必须属于该用户、分类匹配且图片 ready；同意版本正确；本地任务额度足够。客户端不能直接指定模型、提示词、任意 URL 或 owner。

返回 `202 {task_id,status:"queued"}`。任务保存人物 ID/hash、实际参与的单品 ID/hash/属性、完整草稿版本、mode/target_slot、模型与提示词版本、同意时间。适配器同时计算真实输入摘要，用于产物检查点和排障。生成期间修改草稿，不改变本任务输入。

`GET /tasks/{id}` 的 `result` 是 `TryonResult`：

- `kind: "tryon_result"`、`result_asset`（私有 MediaAsset）；
- `draft_id/draft_revision`、`person_asset_id`；
- `mode`、实际使用的 `slots`，single 可带 `target_slot`；
- `model/prompt_version`。

公开结果不使用内部 `result_asset_id` 替代整个 MediaAsset。短期下载链接过期后重新读取任务或 `/media/{id}`。`POST /media/{id}/retain` 表示保存生成图；`POST /outfits` 表示保存搭配，两者分开。

## 4. 输入资产和上游请求

图序固定：原始人物第一张，之后按 `coat → top → bottom → shoes → bag` 过滤实际参与的槽位。提示词图号随最终数组生成。bag 槽也用于围巾等配饰，`garment_kind` 决定描述，不一律写成包。

公开体验衣物已拆成独立资产，来源、裁切范围及 hash 记录在 `public/assets/garments/manifest.json`。CSS sprite 的四件拼图不能作为一件参考图。真实用户可以上传清楚的单品照片，抠图不是录入前置条件；需要替换参考图时保存成新资产并更新草稿版本。

上游只有一次图片生成 POST：

```text
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
```

当前服务器读取已校验的私有文件，生成 `data:<mime>;base64,...` 输入；不要求本机照片可从公网访问。默认参数为 `size="2K"`、`output_format="png"`、`background="opaque"`、`response_format="url"`、`watermark=true`，不发送组图、流式或联网参数。正式对象存储适配以后可使用受控的短期 URL，不能接受客户端任意远端地址。

适配器分两步：

```text
generate(input)             → provider checkpoint（URL/base64、model、prompt_version、usage、request_id）
downloadResult(checkpoint)  → 经过解码校验的图片字节
```

Worker 必须先持久化 checkpoint，再执行下载。图片 API 没有本项目验证过的服务端 task/job 查询接口；本应用的 task_id 属于自己的 PostgreSQL 队列。

## 5. 状态、恢复和取消

公共状态为 queued/running/succeeded/failed/cancelled/unconfirmed；内部进度通过 `stage=preparing/generating/persisting` 表达。未知百分比为 null，不虚构进度。

- 发送前记录操作意图与 dispatching，检查租约、用户冻结和取消意图。只有 pending 操作可以实际发送。
- POST 响应丢失、超时或无法确认的响应内容进入 unconfirmed；保留原 task 与 operation，不自动发第二次生成请求。
- HTTP 200 也要检查顶层/单项 error、有效 data 和产物。明确拒绝不会假成功；无有效产物不能发布结果。
- 已取得 checkpoint 后，下载失败只恢复下载；不会重生成。原生下载要求公共 HTTPS、限制大小和超时、拒绝重定向，并固定已校验 DNS 地址。
- 成功条件是图片可解码、已写入私有文件、且数据库事务内再次确认 owner、输入可用、账户未删除、任务未取消。结果资产、任务成功和应用事件一并提交。
- 结果写文件后才到达的取消仍可阻止发布并移除该文件。客户端关闭不取消 Worker；真正取消先保存意图，但不能承诺已发出的上游请求立即停止或退费。
- 用户主动“重新生成”创建新任务和新幂等键，可能产生新消耗；网络恢复使用原键，不把重发提交当作重新生成。
- 删除原人物或引用衣物图片，使相关已完成生成资产进入删除状态，并取消关联活动任务；后续不能继续下载旧结果。

## 6. 留存、质量与当前验证

人物临时照片和未完成上传默认 24 小时；未收藏生成结果默认 7 天；用户 retain 的结果保留到删除。私有文件与 public 演示素材分离。生成图不写成“真实穿过/尺码合身”的记忆。供应商侧留存仍遵循真实协议，本地删除不等于供应商已同步删除。

已确认的开发验证包括：

- 单件红色针织衫与人物原图的真实适配器生成、下载和查看；
- 五件整套经 MUSE API、持久 Worker 和 Seedream 的真实生成，产物写入私有媒体；
- 离线/真实 PostgreSQL 测试覆盖图序、资产匹配、未知响应不重复 POST、下载恢复、冻结模型、取消发布竞态和删除衍生图。

这些测试不覆盖所有穿搭质量。上线前仍需至少 30 个有授权的代表样本，覆盖不同身形、肤色、姿态、图案、层次和遮挡；分别报告身份一致性、衣物细节、身体结构、成功率、p50/p95 与实际成本。单件与整套分组评估，实体手机和浏览器自动化也分开记录。

## 7. 后续实时视频

`src/integrations/decart.ts` 只保留后续入口；`POST /tryon/client-token` 目前返回未配置。未来 WebRTC 使用独立短期凭据与费用控制，不复用图片任务的完成条件，也不把普通相机画面称为实时 AI 试衣。

协议来源：[图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)、[多图参考教程](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial)。实时视频另按 [Decart 官方接口](https://docs.platform.decart.ai/getting-started/client-tokens) 接入。
