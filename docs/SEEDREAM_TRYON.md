# Seedream 图片试穿实现合同

版本：1.0，核对日期2026-11-16。首发使用图片试穿；Decart实时视频保留为独立可选能力。本文件是实现规格，没有运行真实用户照片或付费生成。

## 1. 能力和选择

官方多图融合教程直接给出人物换服装的输入形式。Seedream可接收人物参考图和服装参考图，适合本项目的外观预览。它不是有真实体积、布料参数与人体测量的物理试衣系统，不能据生成结果推断尺码或保证版型/Logo百分之百保真。

当前参考模型：Seedream 5.5，官方示例ID `doubao-seedream-5-5-261028`。`ARK_IMAGE_MODEL` 由服务器配置已开通的Model ID或Endpoint ID，固定模型版本与prompt_version写入任务快照；不能从前端随意指定任意计费模型。若改为4.5/5.0lite等版本，重新验证参考图上限、输出格式及其他参数，不能照搬5.5的全部字段。

5.5最多10张输入参考图；MUSE首期最多6张：1张人物＋最多5张单品。先验证单上装和上下装组合，再开放外套叠穿/鞋包整体效果。模型支持多图并不意味着每种组合质量已验收。

## 2. 用户交互

“试穿这套” → 确认当前套装 → 上传/选本人照片 → 展示照片用途与保存选择 → 用户点击“生成试穿图” → 后台任务 → 原图/效果图对比 → 保存/重新生成/回搭配。

没有真实服务配置时显示“示例预览”，不可把示例图替换成用户照片后假称生成成功。照片建议单人、正面、光线清楚、衣物无遮挡；输入质量不佳给提示，允许用户重选。浏览器拍照是可选录入方式，不要求常开摄像头。

## 3. MUSE接口与任务快照

`POST /api/v1/tryon-tasks`，登录＋Idempotency-Key：

```json
{
  "draft_id":"uuid",
  "draft_revision":4,
  "person_asset_id":"uuid",
  "consent_version":"tryon-photo-v1"
}
```

API负责校验用户同意与照片归属、draft revision、每件单品的图片可用性、数量和额度；服务器按不可变快照解析garment asset IDs。前端不传签名URL、prompt、模型Key或owner ID。

返回202 `{task_id,status:"queued"}`。任务快照包含：person asset/hash、有序garment refs/hash、outfit snapshot、模型/端点标识、prompt_version、尺寸、用户同意版本及时间、输入摘要hash。UI可看到“正在生成”，没有上游百分比时不伪造95%进度。

## 4. 实际上游请求

```http
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Authorization: Bearer <服务端ARK_API_KEY>
Content-Type: application/json
```

以下为5.5请求示例，签名链接由后端从自己已验证的私有对象生成：

```json
{
  "model":"doubao-seedream-5-5-261028",
  "prompt":"以图1中的人物为主体，保留面部、发型、体型、姿态及背景。将上装替换为图2的衣服，下装替换为图3的衣服。保持参考衣物的颜色、纹理、图案和轮廓，形成自然合理的穿着关系。只输出一张同一人物的穿搭效果图。",
  "image":["https://storage.example/person-signed","https://storage.example/top-signed","https://storage.example/bottom-signed"],
  "size":"2K",
  "output_format":"png",
  "response_format":"url",
  "watermark":true
}
```

图序是合同：image[0]永远人物，后续按coat/top/bottom/shoes/bag固定顺序构建，prompt中的图号根据实际数组生成，不能缺件后还引用旧图号。输出目标为单图；5.5不使用`sequential_image_generation`、组图或流式参数。模板中文保持简洁，衣物名称来自数据但需作为描述引用，不能让商品文案注入额外指令。

上游支持URL或data URL；优先短时签名URL，发请求前生成并留足上游抓取时间。签名链接只允许由服务端对象存储适配器产生，不允许客户端指定任意URL；不把照片URL发送到商品搜索或记忆。

## 5. 响应、保存与恢复

HTTP成功仍需检查顶层error、data数组、每项error和实际URL/base64。v1要求得到1个有效结果，验证图片可解码和尺寸后转存本方私有存储，DB写入result_asset_id后才标succeeded。

官方URL有效期为生成后24小时内，不能永久保存这个URL作为相册地址。优先支持配置TOS订阅产物自动转存；使用返回URL下载时限制HTTPS、响应大小、超时和可访问目标，禁止跟随到内网地址。下载失败可以重试下载同一产物，不要重新生成。

状态：queued → preparing → generating → persisting → succeeded。另有failed、cancel_requested/cancelled、unconfirmed。展示状态沿用总任务合同，具体细节放stage。

- 客户端关闭不影响Worker执行。
- 上游POST网络超时/响应丢失时，无法据此确认是否已生成并计费，进入unconfirmed。图片API这里没有已验证的按task ID查询能力；不要臆造`/images/tasks/{id}`轮询，也不要无条件重发。
- 人工确认或用户主动“重新生成”创建新attempt，使用新幂等键，并告知可能产生新消耗。应用幂等键只能避免重复提交本方任务。
- 取消排队任务可以阻止发送；生成中的取消是本方意图，不保证停止供应商计费。晚到结果按取消/删除策略处理，不自动展示。
- Worker在发送前记录dispatching；进程在远端请求期间崩溃，恢复成unconfirmed而非盲重试。记录上游request_id供排障；真正有产物URL时可继续persisting。
- 用户生成途中修改搭配，结果仍标明原搭配版本；可选择对当前新搭配重新生成。

## 6. 质量与隐私验收

准备至少30个有授权样本，覆盖身形、肤色、长短发、图案衣服、外套叠穿、宽松/贴身、遮挡和不同背景。由人工分别评分身份一致性、衣物颜色/纹理/图案保真、身体结构、遮挡合理性，统计可用率、p50/p95耗时和真实成本。另做单件与多件效果对比；不能只用一张最好的展示图判断可上线。

照片和结果默认私人，下载/分享需用户操作。EXIF移除；按SPEC的保留期清理；删除照片时取消相关排队任务并清理衍生图。生成图保留AI标识，不作为尺码事实写进Memory。供应商留存边界由真实服务条款决定，不能由本地删除推断上游同步删除。

## 7. Decart的保留位置

`src/integrations/decart.ts`继续作为后续实时视频适配层，能力开关默认关闭。其模型ID在真接入时重新核对；现有占位值不能当作已验证可用。`src/integrations/contracts.ts`及Decart参考是历史草案，路径/camelCase/响应字段需要迁移到新版OpenAPI的 `/api/v1/tryon/client-token`、CSRF与幂等合同后才可启用，不能直接复制连生产。用户主动打开实时试穿后，后台签短期token，手机WebRTC直连；这条链路不与Seedream图片任务的状态/接口混用。

来源：[火山方舟图片生成API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)、[多图融合与换装教程](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial)、[Decart客户端凭证](https://docs.platform.decart.ai/getting-started/client-tokens)。
