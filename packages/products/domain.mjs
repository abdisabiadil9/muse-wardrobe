import { AppError } from "../domain/index.mjs";
import { digest } from "../db/index.mjs";
export const TAOBAO_SEARCH_PRICE_USD = 0.0135;
export const productTools = [
  {
    type: "custom",
    name: "search_products",
    description:
      "搜索淘宝/天猫服装商品，返回图片、来源链接、参考价格与价格口径。仅在用户想购买或明确寻找缺失单品时调用；商品不属于用户衣橱。每次一页最多五件，不自动读详情。价格、店铺和销量可能缺失，返回价格可能不满足筛选条件，以商品页为准。",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", minLength: 1, maxLength: 100 },
        min_price: { type: "number", minimum: 0, maximum: 1000000 },
        max_price: { type: "number", minimum: 0, maximum: 1000000 },
        sort: { type: "string", enum: ["relevance", "popular", "price_desc"] },
        tmall_only: { type: "boolean" },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
];
export function productInput(args, owner) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).some(
      (k) =>
        !["keyword", "min_price", "max_price", "sort", "tmall_only"].includes(
          k,
        ),
    )
  )
    throw new AppError(400, "invalid_product_search", "商品搜索参数无效");
  if (typeof args.keyword !== "string")
    throw new AppError(400, "invalid_keyword", "请提供商品关键词");
  const keyword = args.keyword.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!keyword || keyword.length > 100)
    throw new AppError(400, "invalid_keyword", "商品关键词须为 1–100 字");
  const params = { keyword, limit: 5 };
  for (const key of ["min_price", "max_price"])
    if (args[key] !== undefined) {
      if (
        typeof args[key] !== "number" ||
        !Number.isFinite(args[key]) ||
        args[key] < 0 ||
        args[key] > 1000000
      )
        throw new AppError(400, "invalid_price", "预算须为有效的人民币金额");
      params[key] = args[key];
    }
  if (
    params.min_price !== undefined &&
    params.max_price !== undefined &&
    params.min_price > params.max_price
  )
    throw new AppError(400, "invalid_price", "最低预算不能高于最高预算");
  if (args.sort !== undefined) {
    if (!["relevance", "popular", "price_desc"].includes(args.sort))
      throw new AppError(400, "invalid_sort", "该商品排序不可用");
    if (args.sort !== "relevance") params.sort = args.sort;
  }
  if (args.tmall_only !== undefined) {
    if (typeof args.tmall_only !== "boolean")
      throw new AppError(400, "invalid_filter", "天猫筛选须为布尔值");
    if (args.tmall_only) params.tmall_only = true;
  }
  return {
    platform: "taobao",
    action: "search",
    params,
    cache_hours: 6,
    cache_key: digest({
      version: 1,
      platform: "taobao",
      scope: owner,
      action: "search",
      params,
    }),
  };
}
export function productImage(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value.startsWith("//") ? "https:" + value : value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port ||
      !["alicdn.com", "taobaocdn.com"].some(
        (d) => u.hostname === d || u.hostname.endsWith("." + d),
      )
    )
      return null;
    u.protocol = "https:";
    return u.href.length <= 2048 ? u.href : null;
  } catch {
    return null;
  }
}
const text = (value, max) =>
  typeof value === "string" ? value.slice(0, max) : "";
function price(value) {
  if (
    typeof value === "string" &&
    !/^(0|[1-9]\d{0,8})(\.\d{1,4})?$/.test(value)
  )
    return null;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100000000
    ? n
    : null;
}
export function normalizeProducts(payload, input) {
  if (
    !Object.hasOwn(payload, "results") ||
    (payload.results !== null && !Array.isArray(payload.results))
  )
    throw new AppError(502, "invalid_source_result", "商品来源返回结构不完整");
  const rows = payload.results ?? [],
    seen = new Set();
  const data = rows
    .slice(0, 20)
    .flatMap((row) => {
      const id =
        typeof row?.id === "number" && Number.isSafeInteger(row.id)
          ? String(row.id)
          : row?.id;
      if (typeof id !== "string" || !/^\d{5,20}$/.test(id) || seen.has(id))
        return [];
      const images = [
        ...new Set(
          [row.image_url, ...(Array.isArray(row.images) ? row.images : [])]
            .map(productImage)
            .filter(Boolean),
        ),
      ].slice(0, 3);
      const currency = row.currency === "CNY" ? "CNY" : null,
        value = currency ? price(row.price) : null;
      const basis =
        value !== null &&
        ["page", "list", "promotion"].includes(row.price_basis)
          ? row.price_basis
          : null;
      const inBudget =
        value === null
          ? null
          : (input.params.min_price === undefined ||
              value >= input.params.min_price) &&
            (input.params.max_price === undefined ||
              value <= input.params.max_price);
      seen.add(id);
      return [
        {
          id,
          url: `https://item.taobao.com/item.htm?id=${id}`,
          title: text(row.title, 180),
          images,
          price: value,
          currency,
          price_basis: basis,
          shop_name: text(row.shop_name, 100) || null,
          is_tmall: typeof row.is_tmall === "boolean" ? row.is_tmall : null,
          listed_price_in_range: inBudget,
          source: "taobao",
          owned: false,
        },
      ];
    })
    .slice(0, 5);
  if (rows.length && !data.length)
    throw new AppError(
      502,
      "invalid_source_result",
      "商品来源缺少有效商品标识",
    );
  return {
    kind: "product_search_result",
    data,
    query: input.params.keyword,
    fetched_at: new Date().toISOString(),
    cached: false,
    price_notice:
      "搜索价格可能是页面价、划线价或推广价，不保证筛选命中；以商品页和结算页为准。",
  };
}
