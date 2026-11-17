import { useEffect, useState } from 'react';
import { Shirt } from 'lucide-react';
import type { Garment } from '../data';
import type { Api, MediaAsset } from '../api/client';
export default function LiveGarmentImage({
  item,
  assetId,
  api,
  className = '',
}: {
  item: Garment;
  assetId?: string;
  api: Api;
  className?: string;
}) {
  const [url, setUrl] = useState(item.image || ''),
    [failed, setFailed] = useState(false),
    [retried, setRetried] = useState(false);
  useEffect(() => {
    setUrl(item.image || '');
    setFailed(false);
    setRetried(false);
  }, [item.id, item.image]);
  const refresh = async () => {
    if (!assetId || retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    try {
      const asset = await api.get<MediaAsset>(`/media/${assetId}`);
      if (!asset.download_url || asset.download_url === url) setFailed(true);
      else setUrl(asset.download_url);
    } catch {
      setFailed(true);
    }
  };
  return url && !failed ? (
    <img
      className={`item-image ${className}`}
      src={url}
      alt={item.name}
      loading="lazy"
      decoding="async"
      onError={() => void refresh()}
    />
  ) : (
    <div
      className={`item-image live-empty-slot ${className}`}
      role="img"
      aria-label={`${item.name}，暂无可用照片`}
    >
      <Shirt size={26} />
      <span>{item.id ? '待补照片' : '选择衣物'}</span>
    </div>
  );
}
