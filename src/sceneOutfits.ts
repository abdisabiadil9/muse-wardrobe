import type { Outfit, Slot } from './data';
import type { CanvasLayout } from './components/StyleStudio';

export const sceneNames = ['轻松日常', '周末漫步', '见面时刻'] as const;
export type SceneName = (typeof sceneNames)[number];
export type LookConfirmation = { day: string; signature: string };
export type SceneLook = {
  outfit: Outfit;
  canvasLayout?: CanvasLayout;
  confirmedLook?: LookConfirmation;
  locks?: Slot[];
};
export type SceneLooks = Record<SceneName, SceneLook>;
export type SceneState = SceneLook & {
  scene: string;
  sceneLooks?: Partial<SceneLooks>;
  sceneStateVersion?: number;
};

type ScenePreset = { title: string; description: string; outfit: Outfit };
/** Curated demo combinations from existing owned garments, not a live AI result. */
export const scenePresets: Record<SceneName, ScenePreset> = {
  轻松日常: {
    title: '中性色，轻松又利落',
    description: '燕麦与柔白叠穿，灰褐裤装收住轮廓',
    outfit: {
      coat: 'oat',
      top: 'tee',
      bottom: 'trouser',
      shoes: 'shoe',
      bag: 'bag',
    },
  },
  周末漫步: {
    title: '清浅配色，松弛一点',
    description: '浅紫开衫搭薄荷绿，穿一点轻盈心情',
    outfit: {
      coat: 'lilac-cardigan',
      top: 'tee',
      bottom: 'mint-pants',
      shoes: 'shoe',
      bag: 'bag',
    },
  },
  见面时刻: {
    title: '一点红，让今天出彩',
    description: '红色针织遇上丹宁，西装添一点利落',
    outfit: {
      coat: 'oat',
      top: 'red-knit',
      bottom: 'jeans',
      shoes: 'shoe',
      bag: 'bag',
    },
  },
};
const slots: Slot[] = ['coat', 'top', 'bottom', 'shoes', 'bag'];
export const toSceneName = (value: string): SceneName =>
  sceneNames.includes(value as SceneName) ? (value as SceneName) : '轻松日常';
export const sameOutfit = (a: Outfit, b: Outfit) =>
  slots.every((slot) => a[slot] === b[slot]);
export const normalizeOutfit = (outfit: Outfit): Outfit => ({
  ...outfit,
  top: outfit.top === 'cotton' ? 'tee' : outfit.top,
  shoes: outfit.shoes === 'sneaker' ? 'shoe' : outfit.shoes,
  bag: outfit.bag === 'camel' ? 'scarf' : outfit.bag,
});
const validOutfit = (value: unknown): value is Outfit =>
  Boolean(
    value &&
    typeof value === 'object' &&
    slots.every(
      (slot) =>
        typeof (value as Outfit)[slot] === 'string' &&
        (value as Outfit)[slot].length,
    ),
  );
function copyLayout(layout?: CanvasLayout): CanvasLayout | undefined {
  if (
    !layout ||
    !slots.every(
      (slot) =>
        layout[slot] &&
        ['x', 'y', 'width', 'rotation'].every((key) =>
          Number.isFinite(layout[slot][key as keyof CanvasLayout[Slot]]),
        ),
    )
  )
    return undefined;
  return Object.fromEntries(
    slots.map((slot) => [slot, { ...layout[slot] }]),
  ) as CanvasLayout;
}
function copyLook(look: SceneLook): SceneLook {
  return {
    outfit: normalizeOutfit(look.outfit),
    locks: [...(look.locks || [])],
    canvasLayout: copyLayout(look.canvasLayout),
    confirmedLook: look.confirmedLook ? { ...look.confirmedLook } : undefined,
  };
}
function recommendedLook(scene: SceneName): SceneLook {
  return {
    outfit: { ...scenePresets[scene].outfit },
    canvasLayout: undefined,
    confirmedLook: undefined,
    locks: [],
  };
}
function seedLooks(): SceneLooks {
  return Object.fromEntries(
    sceneNames.map((scene) => [scene, recommendedLook(scene)]),
  ) as SceneLooks;
}

/** Active top-level fields remain the app's draft; snapshot them before serialization/switch. */
export function rememberCurrentScene<T extends SceneState>(
  state: T,
): T & { scene: SceneName; sceneLooks: SceneLooks; sceneStateVersion: 1 } {
  const scene = toSceneName(state.scene);
  const sceneLooks = seedLooks();
  for (const name of sceneNames) {
    const look = state.sceneLooks?.[name];
    if (look && validOutfit(look.outfit)) sceneLooks[name] = copyLook(look);
  }
  sceneLooks[scene] = copyLook(state);
  return { ...state, scene, sceneLooks, sceneStateVersion: 1 };
}

/** Migrate v1 browser storage without touching saved looks, uploads, feedback or favorites. */
export function hydrateSceneState<T extends SceneState>(
  state: T,
): T & { scene: SceneName; sceneLooks: SceneLooks; sceneStateVersion: 1 } {
  const scene = toSceneName(state.scene);
  const existing = state.sceneLooks?.[scene];
  let outfit = validOutfit(state.outfit)
    ? normalizeOutfit(state.outfit)
    : existing && validOutfit(existing.outfit)
      ? normalizeOutfit(existing.outfit)
      : { ...scenePresets[scene].outfit };
  // The old selector only changed its label. Its untouched neutral baseline is not a per-scene customization.
  const legacyBaseline =
    !state.sceneStateVersion &&
    !state.sceneLooks &&
    !state.canvasLayout &&
    !state.confirmedLook &&
    sameOutfit(outfit, scenePresets['轻松日常'].outfit);
  const changedDuringMigration =
    legacyBaseline && !sameOutfit(outfit, scenePresets[scene].outfit);
  if (legacyBaseline) outfit = { ...scenePresets[scene].outfit };
  return rememberCurrentScene({
    ...state,
    scene,
    outfit,
    canvasLayout: copyLayout(state.canvasLayout),
    confirmedLook: changedDuringMigration ? undefined : state.confirmedLook,
  });
}

export function switchScene<T extends SceneState>(
  state: T,
  destination: string,
): T & { scene: SceneName; sceneLooks: SceneLooks; sceneStateVersion: 1 } {
  const snapshot = rememberCurrentScene(state);
  const scene = toSceneName(destination);
  return { ...snapshot, scene, ...copyLook(snapshot.sceneLooks[scene]) };
}

/** Importing a saved look first preserves the outgoing scene's draft. */
export function openLookInScene<T extends SceneState>(
  state: T,
  scene: string,
  look: SceneLook,
): T & { scene: SceneName; sceneLooks: SceneLooks; sceneStateVersion: 1 } {
  const target = switchScene(state, scene);
  return rememberCurrentScene({
    ...target,
    ...copyLook(look),
    confirmedLook: undefined,
  });
}

export function restoreSceneRecommendation<T extends SceneState>(
  state: T,
): T & { scene: SceneName; sceneLooks: SceneLooks; sceneStateVersion: 1 } {
  const snapshot = rememberCurrentScene(state);
  return rememberCurrentScene({
    ...snapshot,
    ...recommendedLook(snapshot.scene),
  });
}

export function hasSceneChanges(state: SceneState): boolean {
  return (
    !sameOutfit(state.outfit, scenePresets[toSceneName(state.scene)].outfit) ||
    Boolean(state.canvasLayout)
  );
}
