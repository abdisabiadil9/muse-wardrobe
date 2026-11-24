import { useState } from 'react';
import { ImageOff, Sparkles, ArrowUpRight } from 'lucide-react';
import {
  productPriceLabels,
  productReferencePrompt,
  type ProductReference,
  type ProductSearchResult,
} from '../products';
import './agent-inspiration.css';
function safeImage(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      ['alicdn.com', 'taobaocdn.com'].some(
        (d) => u.hostname === d || u.hostname.endsWith('.' + d),
      )
      ? u.href
      : '';
  } catch {
    return '';
  }
}
function read(output: unknown): ProductSearchResult | null {
  try {
    const text = Array.isArray(output)
      ? output
          .filter((b) => b?.type === 'text')
          .map((b) => b.text)
          .join('')
      : output;
    const result = typeof text === 'string' ? JSON.parse(text) : text;
    if (result?.kind !== 'product_search_result' || !Array.isArray(result.data))
      return null;
    return {
      ...result,
      data: result.data
        .filter(
          (p: ProductReference) =>
            typeof p?.id === 'string' &&
            /^\d{5,20}$/.test(p.id) &&
            typeof p.title === 'string' &&
            Array.isArray(p.images),
        )
        .slice(0, 5)
        .map((p: ProductReference) => ({
          ...p,
          url: `https://item.taobao.com/item.htm?id=${p.id}`,
          images: p.images.map(safeImage).filter(Boolean),
        })),
    };
  } catch {
    return null;
  }
}
function ProductCard({
  product,
  onImage,
  onUse,
}: {
  product: ProductReference;
  onImage: (url: string, alt: string) => void;
  onUse: (text: string) => void;
}) {
  const [failed, setFailed] = useState(false),
    url = product.images[0];
  const priced =
    typeof product.price === 'number' &&
    Number.isFinite(product.price) &&
    product.price >= 0 &&
    product.currency === 'CNY';
  return (
    <article className="ai-inspiration-card ai-product-card">
      {url && !failed ? (
        <button
          className="ai-inspiration-image"
          aria-label={`查看商品图片：${product.title}`}
          onClick={() => onImage(url, product.title)}
        >
          <img
            src={url}
            alt={product.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </button>
      ) : (
        <div className="ai-inspiration-no-image">
          <ImageOff size={20} />
          图片暂不可用
        </div>
      )}
      <h4>{product.title || '淘宝商品'}</h4>
      <div className="ai-product-price">
        <small>
          {priced
            ? productPriceLabels[
                product.price_basis as keyof typeof productPriceLabels
              ] || '参考价'
            : '价格未返回'}
        </small>
        {priced && <strong>¥{product.price!.toFixed(2)}</strong>}
      </div>
      {product.listed_price_in_range === false && (
        <p className="ai-product-budget">参考价超出预算范围</p>
      )}
      <p className="ai-product-shop">{product.shop_name || '店铺信息未返回'}</p>
      <a
        href={product.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        查看{product.is_tmall ? '天猫' : '淘宝'}商品
        <ArrowUpRight size={12} />
      </a>
      <button
        className="ai-inspiration-use"
        onClick={() => onUse(productReferencePrompt(product))}
      >
        <Sparkles size={13} />
        看看怎么搭
      </button>
    </article>
  );
}
export default function AgentProductCards({
  output,
  onImage,
  onUse,
}: {
  output: unknown;
  onImage: (url: string, alt: string) => void;
  onUse: (text: string) => void;
}) {
  const result = read(output);
  if (!result) return null;
  return (
    <section className="ai-product-results" aria-label="Lumi 找到的淘宝商品">
      {result.data.length ? (
        <div className="ai-inspiration-results">
          {result.data.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onImage={onImage}
              onUse={onUse}
            />
          ))}
        </div>
      ) : (
        <p className="ai-product-notice">
          这次没有找到可展示的商品，可以换一个更具体的关键词。
        </p>
      )}
      <p className="ai-product-notice">
        {result.fetched_at
          ? `${new Date(result.fetched_at).toLocaleString('zh-CN')} 查询 · `
          : ''}
        价格以商品页和结算页为准。商品尚未加入衣橱。
      </p>
    </section>
  );
}
