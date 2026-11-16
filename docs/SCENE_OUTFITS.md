# Three scene outfits

Updated: 2026-11-16

## User-visible change

The three occasion controls now select real combinations, not just alternate captions. All default garments are already-owned fixture items; the same brown loafers and bag can serve multiple occasions.

| Scene | Title | Outerwear | Top | Bottoms |
| --- | --- | --- | --- | --- |
| 轻松日常 | 中性色，轻松又利落 | 燕麦西装 `oat` | 白针织 `tee` | 灰褐阔腿裤 `trouser` |
| 周末漫步 | 清浅配色，松弛一点 | 浅紫开衫 `lilac-cardigan` | 白针织 `tee` | 薄荷长裤 `mint-pants` |
| 见面时刻 | 一点红，让今天出彩 | 燕麦西装 `oat` | 红针织 `red-knit` | 牛仔裤 `jeans` |

Each pair differs in at least two visible garment slots. These are curated prototype combinations using existing assets, not live AI output. No new image/model provider is called.

The existing layout, Lenso controls, white/gray/blue palette and editable clothing canvas are retained. The card presents a concise scene-specific styling explanation. After manual changes it reads “我的调整”; **恢复场景推荐** appears beside the daily confirmation action and restores this scene's default garments and layout only. Confirmation/save/try-on remain available.

## State model

`src/sceneOutfits.ts` defines the three presets and pure state operations. Existing top-level `scene`, `outfit`, `canvasLayout` and `confirmedLook` remain the active draft consumed by existing UI. A new `sceneLooks` record stores the independent snapshots:

```ts
sceneLooks: {
  '轻松日常': { outfit, canvasLayout?, confirmedLook? },
  '周末漫步': { outfit, canvasLayout?, confirmedLook? },
  '见面时刻': { outfit, canvasLayout?, confirmedLook? }
}
sceneStateVersion: 1
```

- Before switching, snapshot the departing draft; then load the destination snapshot.
- Before writing localStorage, snapshot the current draft as well. A refresh retains the active scene and any unswitched edits.
- Layout objects are copied per scene. An unedited scene uses default collage geometry, not another scene's custom layout.
- Opening a saved outfit first snapshots the outgoing draft, then loads the saved outfit/layout into its associated scene.
- Restoring recommendations replaces only the current scene outfit/layout and clears that draft's daily confirmation. Saved looks, favorites, uploads, feedback and other scene drafts stay intact.
- Manual garment selection and canvas edits retain the existing controls. Scene selection does not require choosing a whole outfit again.

## Compatibility with existing browser data

The existing `muse-mobile-v1` localStorage key is retained. Stored saved outfits, uploads, favorites and feedback are not reset.

The old UI switched labels without changing the initial neutral combination. When there is no scene-state version or scene map, that exact neutral baseline (without a custom layout or daily confirmation) is upgraded to the active scene's recommendation. Existing manually edited combinations and their layouts migrate into their active scene; the two other scenes start from their own recommendations. Legacy garment ID normalization is preserved.

After migration, the explicit version prevents a manually selected neutral combination from being reinterpreted on later refreshes. Invalid/unrecognized scene labels fall back to 轻松日常; malformed canvas coordinates are ignored instead of leaking into styles.

## Checks

Run:

```sh
node --experimental-strip-types --test src/sceneOutfits.test.mjs
npm run build
```

Eight state tests pass:

1. Three presets differ in at least two slots and contain only owned garments.
2. Legacy neutral baseline migration keeps saved records/favorites/uploads.
3. Legacy manual edits/layout are preserved only in their active scene.
4. Independent manual edits/layout survive switching and a JSON reload.
5. Restore affects only the current scene, keeping other drafts and saved looks.
6. Opening a saved look protects the outgoing scene and uses its own layout.
7. An intentionally neutral edited scene is not remigrated after refresh.
8. An explicitly confirmed or laid-out legacy neutral outfit is preserved.

Browser acceptance completed at 390 × 844 for scene changes, garment replacement, switching back, refresh, per-scene restore, confirmation and try-on return. See [QA record](scene-refresh/QA.md). Layout isolation was covered by state tests; no physical-phone or paid-model verification was performed.

The existing >500 kB Vite chunk warning remains; this change adds only a small local state module and no dependencies or assets.
