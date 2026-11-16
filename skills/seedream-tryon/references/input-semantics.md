# 输入语义与素材

`single` 使用原始人物＋唯一目标单品，只改变原照片该品类，其他服饰保留原照片。`outfit` 使用原始人物＋草稿当前全部选定单品，表达更新后的整套；未指定槽保持原图，不隐式表示脱掉衣物。删除衣物、换背景、换姿态不是此版本接口能力。

两者都从原始照片重新生成。即使上一轮已经生成裤装，下一轮改上装也不能把上一轮图片自动送入人物位置。想保留先前选择的裤装，应更新草稿并执行 outfit。`person.kind` 必须为 `person`；应用必须从自己的媒体数据库验证类型与归属，不能信任用户传入的类型标签。

上游图序：人物、外套、上装、下装、鞋履、配饰。只保留实际选中槽，再编号。参考图数组的元素没有独立 role 字段；应用的角色映射由 prompt 表达。配饰槽用 `garment_kind: "scarf"` 或 `"bag"` 区分；其他类型描述为配饰。商品标题不作为自由指令拼进 prompt。

输入对象：

```js
{
  mode: 'single',
  target_slot: 'top', // 仅 single 必填；outfit 禁止
  person: { asset_id: 'original-asset', kind: 'person', bytes, mime: 'image/png' },
  snapshot: {
    draft_id: 'draft', draft_revision: 4,
    slots: { top: { asset_id: 'top-asset', ref_id: 'top-item' } }
  },
  garments: [
    { slot: 'top', asset_id: 'top-asset', ref_id: 'top-item', name: '示例上衣', garment_kind: 'knit', bytes, mime: 'image/png' }
  ]
}
```

输入只接受 PNG/JPEG/WebP 字节，不接受任意远端 URL。真实发送前用 sharp 解码并验证格式、单帧、像素与比例。通用官方接口支持范围更广，但应用入口选择这三种以控制处理复杂度。前端上传 HEIC 等格式需要在应用媒体层转换后再交 adapter。

`snapshot` 必须来自已认证、已固定的数据库版本。单件的 `garments` 仅一项；整套必须与 snapshot 中所有非空槽精确相符。缺项、多项、重复槽或 asset/ref 不匹配均拒绝。原图/单品字节复制并计算 hash；hash 不包含临时 URL。

素材准备：每张图仅含对应单品，保留完整边缘与自然可见细节。原图若是已知四宫格，可按可靠矩形裁切；保存来源、裁切坐标、处理版本与 hash。裁切前后都检查，不将错误裁切靠提示词补救。不要求先抠图，清楚的背景照片可直接使用。既有透明图的脏边、遮挡或过低分辨率应重新获取可靠素材，而非模型重画冒充原衣物。

MUSE 当前独立素材 manifest 在 `public/assets/garments/manifest.json`；处理脚本为 `scripts/prepare-garment-assets.py`，使用 Pillow。12 个素材均为示例，来源三张1254×1254透明图集 `products-cutout.png`、`wardrobe-essentials-cutout.png`、`statement-items.png`，按627×627象限确定性裁切并保留Alpha。不要改用不透明原图，否则搭配画布会出现互相覆盖的背景色块。
