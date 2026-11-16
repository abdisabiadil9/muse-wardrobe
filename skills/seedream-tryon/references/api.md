# Seedream API 合同

核对日期2026-11-16：[官方 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)、[官方多图教程](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial)。

上游为 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，Bearer服务端Key。默认模型 `doubao-seedream-5-5-261028`；可配置对应 `ep-` 端点，但能力配置仍固定为已验证5.5。不能从前端指定模型。5.5参考图最多10张，单图输出；本skill最多人物＋5件。请求字段固定为 `model,prompt,image,size:"2K",output_format:"png",background:"opaque",response_format:"url",watermark:true`，不发送组图、stream或联网字段。

adapter 使用 data URL，由已验证文件字节构造；不会把任意用户URL转给供应商。每图≤30 MB、宽高均>14、比例1/16至16、像素≤36M。输出 URL 在生成后24小时内失效；尽快存入自己受权限控制的存储。

## 模块接口

```js
import {
  SeedreamAdapter,
  buildSeedreamRequest,
  resolveTryonInput,
} from './seedream-client.mjs';
const preview = buildSeedreamRequest(input); // 纯函数，无网络/凭据读取
const adapter = new SeedreamAdapter({
  apiKey: serverSecret,
  model: configuredModel,
});
const checkpoint = await adapter.generate(input); // 一次 POST
await privateRepository.saveCheckpoint(checkpoint);
const result = await adapter.downloadResult(checkpoint); // 只有 GET / 本地base64解码
await privateRepository.saveImage(result.bytes, result.mime);
```

`generate` 仅接受上述输入合同。返回checkpoint：`version:1`、`url`或`b64_json`（二者之一）、`mime`、可取得的`request_id`、`usage`、模型/能力配置、`prompt_version`、`input_hash`、模式/目标槽、原始人物asset、草稿ID/revision、接收时间。不返回完整请求、Key或单品字节。checkpoint包含私人短时URL/产物，不能显示到日志或提交仓库。

`downloadResult` 返回 `bytes,mime,width,height,sha256,request_id,usage`。可以使用无Key的 `new SeedreamAdapter()` 恢复下载。下载拒绝非HTTPS、重定向、内网地址、超限响应，解码后核验真实格式。可配置 `allowedDownloadHosts` 对产物域名进一步限制。下载失败不会调用generate。

`SeedreamError` 的 `code` 为本地稳定分类，非供应商错误码；`provider_code` 仅在供应商返回合法代码时保留。`outcome` 为 `rejected / unknown / invalid_response / download_failed`，`retryable`固定false，意为没有可自动重复的生成请求。输出错误详情不包含供应商原始message，防止反射私人数据。

## 状态解释

| 情况                            | adapter行为            | 应用行为                                |
| ------------------------------- | ---------------------- | --------------------------------------- |
| 输入/图片无效                   | POST前拒绝             | 修正素材后创建新任务                    |
| HTTP错误或顶层error             | PROVIDER_REJECTED      | 记录实际provider_code，不自动换模型重试 |
| 发送后网络失败、响应无法读取    | POST_OUTCOME_UNKNOWN   | unconfirmed；不重发                     |
| HTTP200空结果、多图或不合法产物 | INVALID_RESPONSE       | 不显示成功；需要对账，不重发            |
| 成功checkpoint已保存，下载失败  | RESULT_DOWNLOAD_FAILED | 用同一checkpoint恢复下载                |
| 解码和转存完成                  | 返回真实图片属性       | 才可标记succeeded                       |

5.5没有在本次公开文档中验证到图片任务查询/取消接口。本方task_id与供应商request_id不同，不臆造 `/images/tasks/*`。应用取消生成中的任务不承诺停止供应商计费；未收到可验证终态就保留未知。
