import type { Garment, Outfit, Slot } from '../data';
import type { CanvasLayout } from '../components/StyleStudio';
import type {
  ApiGarment,
  ApiOutfit,
  ApiSlots,
  Draft,
  OutfitProposal,
  Scene,
} from './client';
export const scenes = ['daily', 'weekend', 'meeting'] as const;
export const sceneLabels: Record<Scene, string> = {
  daily: '轻松日常',
  weekend: '周末漫步',
  meeting: '见面时刻',
};
export const sceneKey = (label: string): Scene =>
  scenes.find((s) => sceneLabels[s] === label) || 'daily';
export const slots: Slot[] = ['coat', 'top', 'bottom', 'shoes', 'bag'];
const categories = {
  coat: '外套',
  top: '上装',
  bottom: '下装',
  shoes: '鞋履',
  bag: '配饰',
} as const;
export const emptyOutfit = (): Outfit => ({
  coat: '',
  top: '',
  bottom: '',
  shoes: '',
  bag: '',
});
export const toOutfit = (value: ApiSlots): Outfit =>
  Object.fromEntries(slots.map((s) => [s, value[s]?.ref_id || ''])) as Outfit;
export const toGarment = (g: ApiGarment, image = ''): Garment => ({
  id: g.id,
  name: g.name,
  garmentKind: g.garment_kind,
  en: 'From your wardrobe',
  category: categories[g.category],
  color: g.color || '未记录',
  material: g.material || '未记录',
  price: 0,
  owned: true,
  image,
  reason: '你确认加入衣橱的衣物。',
  style: '我的衣橱',
});
export const toSaved = (o: ApiOutfit) => ({
  id: o.id,
  title: `${sceneLabels[o.snapshot.scene]} · 已保存`,
  scene: sceneLabels[o.snapshot.scene],
  outfit: toOutfit(o.snapshot.slots),
  canvasLayout: Object.keys(o.snapshot.canvas_layout).length
    ? (o.snapshot.canvas_layout as CanvasLayout)
    : undefined,
  worn: o.worn_date,
});
export function draftSlots(
  outfit: Outfit,
  garments: ApiGarment[],
  existing: ApiSlots,
): ApiSlots {
  return Object.fromEntries(
    slots
      .filter((s) => outfit[s])
      .map((s) => {
        const g = garments.find((g) => g.id === outfit[s]);
        if (!g || g.category !== s)
          throw new Error('有衣物已不可用，请重新选择。');
        return [
          s,
          {
            source: 'wardrobe' as const,
            ref_id: g.id,
            asset_id: g.image_asset_id,
            locked: existing[s]?.locked || false,
          },
        ];
      }),
  );
}
export function validateProposal(
  proposal: OutfitProposal,
  draft: Draft,
  garments: ApiGarment[],
) {
  if (proposal.draft_revision !== draft.revision)
    throw new Error(
      '这份建议生成后，搭配已经有变化。请保留当前选择，重新生成建议。',
    );
  if (!proposal.slots || !Object.keys(proposal.slots).length)
    throw new Error('这次建议没有可用衣物，请重新尝试。');
  for (const slot of slots) {
    const next = proposal.slots[slot],
      current = draft.slots[slot];
    if (current?.locked && (!next || next.ref_id !== current.ref_id))
      throw new Error('这份建议改变了已固定衣物，请重新生成。');
    if (
      next &&
      !garments.some(
        (g) =>
          g.id === next.ref_id &&
          g.image_asset_id === next.asset_id &&
          g.category === slot &&
          next.source === 'wardrobe',
      )
    )
      throw new Error('建议中的衣物已不可用，请刷新衣橱后重试。');
  }
  return proposal.slots;
}
export const draftBody = (draft: Draft) => ({
  expected_revision: draft.revision,
  slots: draft.slots,
  canvas_layout: draft.canvas_layout,
});
export const draftContent = (draft: Draft) =>
  JSON.stringify([draft.slots, draft.canvas_layout]);
export function tryonRequest(
  draft: Draft,
  personAssetId: string,
  mode: 'single' | 'outfit',
  target?: Slot,
) {
  if (!Object.keys(draft.slots).length)
    throw new Error('先选择衣物，再生成试穿图。');
  if (mode === 'single' && (!target || !draft.slots[target]))
    throw new Error('请选择当前搭配中的一件衣服。');
  return {
    draft_id: draft.id,
    draft_revision: draft.revision,
    person_asset_id: personAssetId,
    consent_version: 'tryon-photo-v1',
    mode,
    ...(mode === 'single' ? { target_slot: target } : {}),
  };
}
