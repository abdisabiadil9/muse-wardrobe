import type { Api, MediaAsset } from "./api/client";

export type PersonSource = "female" | "male" | "upload";
export type PersonSelection = { source: PersonSource; pendingUpload: boolean };
export const exampleModels = {
  female: { label: "女模特", image: "/assets/models/female.png" },
  male: { label: "男模特", image: "/assets/models/male.png" },
} as const;

export function personInputKeys(owner: string) {
  const prefix = `muse-live:${owner}`;
  return {
    selection: `${prefix}:person-selection`,
    // Keep the existing key exclusively for the user's own uploaded photo.
    upload: `${prefix}:person`,
    female: `${prefix}:model-person:v1:female`,
    male: `${prefix}:model-person:v1:male`,
  };
}

export function restorePersonSelection(
  saved: unknown,
  personalAssetId: string | null,
): PersonSelection {
  if (saved && typeof saved === "object" && "source" in saved) {
    const source = saved.source;
    if (source === "female" || source === "male" || source === "upload") {
      return {
        source,
        pendingUpload:
          source === "upload" &&
          "pendingUpload" in saved &&
          saved.pendingUpload === true,
      };
    }
  }
  return {
    source: personalAssetId ? "upload" : "female",
    pendingUpload: false,
  };
}

export function samePersonInput(
  selection: PersonSelection,
  personalAssetId: string | undefined,
  context: { personSource?: PersonSource; personAssetId?: string } | undefined,
) {
  if (!context?.personAssetId || selection.pendingUpload) return false;
  // Task records created before model selection always used an uploaded photo.
  if (selection.source !== (context.personSource || "upload")) return false;
  return (
    selection.source !== "upload" || personalAssetId === context.personAssetId
  );
}

/** Called only by the explicit Generate action, never when selecting a card. */
export async function preparePersonAsset({
  selection,
  file,
  personalAsset,
  modelAssetId,
  api,
  fetcher = fetch,
}: {
  selection: PersonSelection;
  file: Blob | null;
  personalAsset: MediaAsset | null;
  modelAssetId?: string | null;
  api: Pick<Api, "get" | "upload">;
  fetcher?: typeof fetch;
}): Promise<MediaAsset> {
  if (selection.source === "upload") {
    if (file) return api.upload(file, "person");
    if (selection.pendingUpload)
      throw new Error("新照片还没有上传，请重新选择照片后再生成。");
    if (personalAsset?.kind === "person" && personalAsset.status === "ready")
      return personalAsset;
    throw new Error("请上传人物照片，或选择一位 AI 示例模特。");
  }
  if (modelAssetId) {
    try {
      const asset = await api.get<MediaAsset>(`/media/${modelAssetId}`);
      if (asset.kind === "person" && asset.status === "ready") return asset;
    } catch (error) {
      // A removed model copy may be re-uploaded. Connection/auth failures must
      // remain failures rather than silently replacing the selected input.
      if (
        !error ||
        typeof error !== "object" ||
        !("status" in error) ||
        error.status !== 404
      )
        throw error;
    }
  }
  const response = await fetcher(exampleModels[selection.source].image);
  if (!response.ok)
    throw new Error("示例模特图片暂不可用，请稍后重试或上传照片。");
  const blob = await response.blob();
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(blob.type) ||
    !blob.size
  )
    throw new Error("示例模特图片未准备好，请稍后重试或上传照片。");
  return api.upload(blob, "person");
}
