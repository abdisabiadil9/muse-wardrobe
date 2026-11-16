# 应用任务集成

本skill不依赖Qoder或某个业务框架。MUSE用例为：手机 → 业务API → 持久任务 → Worker → Seedream → 私人存储。图片字节直接由Worker发给Seedream；搭配Agent不接触Key，也不负责自行重复调用图片生成。

业务请求建议：`POST /api/v1/tryon-tasks`，登录、CSRF和Idempotency-Key，body含 `draft_id,draft_revision,person_asset_id,consent_version,mode`，single另含`target_slot`。应用负责owner校验、同意版本、媒体ready状态、原始人物kind、不可变草稿、额度预留。adapter中的类型校验不能代替这些权限检查。

先固定输入并创建任务，然后Worker取得租约；完成图片校验后记录dispatching再发送。成功响应checkpoint先写数据库，再进入persisting。真实下载与私有存储成功后写入result_asset，最后标succeeded。UI公共状态用queued/running/succeeded等，内部步骤用stage；没有真实进度时progress为null。

恢复规则：

- 排队任务尚未发送可取消；手机关闭不取消Worker。
- Worker在dispatching中丢失且没有checkpoint，按unconfirmed处理；过期租约不能成为再次POST的理由。
- 有checkpoint就继续downloadResult，检查是否已经有相同结果asset，重复保存必须幂等。
- 生成中取消只记录意图；晚到结果按删除/隐藏策略处置。
- 草稿编辑后，运行中任务仍绑定旧revision。结果注明原版本，不能覆盖当前新搭配。用户重新生成创建新业务attempt、新幂等键。
- 应用Idempotency-Key只防止本方重复创建，不自动赋予上游幂等。

默认照片策略由业务SPEC负责，不在通用skill写死保存期限。照片与结果私人访问，移除EXIF，删除原图时清理衍生结果与排队任务。生成checkpoint仅服务恢复，短时产物URL不作为永久相册地址。不要把试穿生成结果写成Memory里的真实穿着或尺码反馈。

真实上线验收至少覆盖身份一致、单品颜色/图案、身体结构、遮挡/层次、单件/整套差异、延迟、成本和失败恢复。模型参数通过与离线测试通过不能替代真实质量验收。模型升级必须明确版本并复验，不静默fallback。

仓库生产实现：`packages/seedream/index.mjs`。独立skill打包副本：`scripts/seedream-client.mjs`；运行`node packages/seedream/sync-skill.mjs`同步，`packages/seedream/index.test.mjs`检查完全一致。`npm install`仅供独立包准备依赖，不执行真实生成。
