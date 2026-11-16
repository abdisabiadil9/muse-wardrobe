---
name: seedream-tryon
description: 用火山方舟 Seedream 把原始人物照片与选定单品参考图合成为试穿效果；用于应用接入、离线请求预览、明确授权的生成与产物恢复，不处理实时视频试衣或尺码判定。
---

# Seedream 图片试穿

面向开发同学及开发 Agent 的可移植 skill。核对日期：2026-11-16。默认版本 `doubao-seedream-5-5-261028`，本目录包含可运行的离线样例与 HTTP adapter；不等于业务后端已部署。

## 选择入口

- 确定单件、整套、照片来源和参考图：读 [输入语义](references/input-semantics.md)。
- 实现或排查上游请求：读 [API 合同](references/api.md)。
- 接入应用任务、保存结果和恢复：读 [应用集成](references/integration.md)。

## 工作边界

1. 先确定人物原图、所选衣物和单件/整套意图。修改一件草稿单品不必然等于“只修改原照片这一件”；若用户要保留已选其他衣物，应按更新后的整套重新生成。
2. 每次使用同一个原始人物 asset，不能把上次试穿结果默认为下一轮原图。图1是人物，后续单品按 `coat/top/bottom/shoes/bag` 排序；图号根据实际数组生成，围巾与包分别描述。
3. 输入为真正独立的单品图片；四宫格的 CSS 展示或整套截图不构成单品参考。优先确定性裁切已有素材，保留来源/hash；不要生成重画商品来冒充原物。
4. 普通规划、写代码或验证文档使用本地预览和 mock，不附带付费测试。用户已明确授权的生成直接在该范围内执行；本 skill 不扩张权限、预算、人物素材范围或账户权限。不要把凭据放命令参数、代码、前端、示例、日志或对话中。
5. API Key 只在服务端发送时读取。`request.mjs` 默认不读取凭据、不联网；`--execute` 才执行真实动作。模型固定在服务器配置，前端不能指定任意计费模型。
6. POST 只发送一次。响应未知时保留 `unconfirmed`，不得自动再次生成。先持久化成功 checkpoint，再下载图片；保存失败只恢复下载。checkpoint 含短时产物链接，应作为私人运行数据保存，不提交仓库。
7. 生成图是外观预览。不能写回“尺码合适”“真实穿过”等事实；留存 AI 标识。身份、服装、身体结构和遮挡质量需要实际图片检查，离线测试不代表生成效果通过。

## 运行随附工具

需要 Node.js ≥22.18；真实执行图片解码需要 `sharp`（随附 package.json 固定版本）。首次独立使用时在本 skill 目录运行 `npm install`。离线请求预览无需安装 sharp；不会加载图片解码依赖。

```sh
node scripts/request.mjs --help
node scripts/request.mjs generate --input assets/single.example.json
node scripts/request.mjs generate --input assets/outfit.example.json
node --test scripts/request.test.mjs
```

随附图片为 MUSE 已有生成示例的确定性裁切，用于演示请求结构，不是用户照片或真实商品档案。替换成已授权素材时，按 JSON 中相对于输入文件的路径填写。不要把用户照片放进 skill 包。

有实际生成授权、已选定输入且已配置服务端 `ARK_API_KEY` 后：

```sh
node scripts/request.mjs generate --input /absolute/input.json --execute --checkpoint /absolute/new-checkpoint.json
node scripts/request.mjs download --checkpoint /absolute/new-checkpoint.json --output /absolute/new-result.png --execute
```

生成命令只得到并保存 checkpoint；下载命令只取得同一产物，不再提交图片生成。文件默认拒绝覆盖。下载预览省略 `--execute`。不要为排查认证自动轮换账户、Key、端点或模型。

## 交付与维护

验证参考图次序、快照匹配、原始人物类型、缺图失败、200错误响应、不确定 POST 无重发、下载恢复和旧版本结果隔离。输出中区分“离线测试”“真实请求”和“尚未验收”。保存错误使用脱敏错误码与 request_id，不回显供应商原始错误文本或签名URL。

MUSE 仓库内唯一手写实现为 `packages/seedream/index.mjs`。本 skill 的 `scripts/seedream-client.mjs` 是同步导出副本，可独立携带运行；通过 `node packages/seedream/sync-skill.mjs` 更新，仓库测试检查逐字节一致。不要分别维护两套 adapter。

官方入口：[图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)、[多图融合教程](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial)。更新模型时重新核对能力与字段，不沿用不兼容参数。
