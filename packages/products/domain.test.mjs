import test from "node:test";
import assert from "node:assert/strict";
import {
  productInput,
  normalizeProducts,
  productImage,
  TAOBAO_SEARCH_PRICE_USD,
} from "./domain.mjs";
import { EveryInfra } from "../inspiration/everyinfra.mjs";
import { agentInspirationResult } from "../inspiration/tools.mjs";
test("Taobao search uses catalog vocabulary, bounded first-page requests and owner cache", () => {
  const input = productInput(
    {
      keyword: "白色 衬衫",
      min_price: 50,
      max_price: 200,
      sort: "popular",
      tmall_only: true,
    },
    "alice",
  );
  assert.deepEqual(input.params, {
    keyword: "白色 衬衫",
    limit: 5,
    min_price: 50,
    max_price: 200,
    sort: "popular",
    tmall_only: true,
  });
  assert.equal(input.platform, "taobao");
  assert.equal(input.cache_hours, 6);
  assert.equal(TAOBAO_SEARCH_PRICE_USD, 0.0135);
  assert.equal(
    productInput(
      { keyword: "白衬衫", sort: "relevance", tmall_only: false },
      "alice",
    ).cache_key,
    productInput({ keyword: "白衬衫" }, "alice").cache_key,
  );
  assert.notEqual(
    input.cache_key,
    productInput(
      {
        keyword: "白色 衬衫",
        min_price: 50,
        max_price: 200,
        sort: "popular",
        tmall_only: true,
      },
      "bob",
    ).cache_key,
  );
  for (const value of [
    { keyword: "x", sort: "price_asc" },
    { keyword: "x", tmall_only: "false" },
    { keyword: "x", page: 2 },
    { keyword: "x", user_id: "someone" },
    { keyword: "x", min_price: 100, max_price: 50 },
    { keyword: "x", max_price: NaN },
  ])
    assert.throws(() => productInput(value, "alice"));
});
test("Product cards preserve price basis, absent shop/price and out-of-range references without claiming ownership", () => {
  const input = productInput({ keyword: "白衬衫", max_price: 100 }, "alice");
  const rows = [
    {
      id: "637637661300",
      title: "白衬衫",
      price: 49.9,
      currency: "CNY",
      price_basis: "promotion",
      image_url: "https://img.alicdn.com/item.jpg",
    },
    {
      id: "637637661301",
      title: "高价参考",
      price: 199,
      currency: "CNY",
      price_basis: "list",
    },
    {
      id: "637637661302",
      title: "缺少价格",
      price: null,
      currency: "CNY",
      image_url: "https://evil.example/tracker",
    },
    { id: "637637661303", title: "币种不明", price: 20 },
  ];
  const result = normalizeProducts({ results: rows }, input);
  assert.equal(result.data[0].price, 49.9);
  assert.equal(result.data[0].price_basis, "promotion");
  assert.equal(result.data[0].shop_name, null);
  assert.equal(result.data[0].owned, false);
  assert.equal(result.data[1].listed_price_in_range, false);
  assert.equal(result.data[2].price, null);
  assert.equal(result.data[2].listed_price_in_range, null);
  assert.deepEqual(result.data[2].images, []);
  assert.equal(result.data[3].price, null);
  assert.deepEqual(normalizeProducts({ results: [] }, input).data, []);
  assert.throws(() => normalizeProducts({ results: { items: rows } }, input));
  assert.equal(
    productImage("//img.alicdn.com/test.jpg"),
    "https://img.alicdn.com/test.jpg",
  );
  assert.equal(
    productImage("http://img.alicdn.com/test.jpg"),
    "https://img.alicdn.com/test.jpg",
  );
  assert.equal(productImage("https://alicdn.com.evil.example/tracker"), null);
});
test("Taobao async requests cannot drift into arbitrary platforms or billable detail fan-out", async () => {
  let sent;
  const api = new EveryInfra({
    apiKey: "fixture",
    fetchImpl: async (_url, opts) => {
      sent = JSON.parse(opts.body);
      return Response.json({ job_id: "job_taobao" }, { status: 202 });
    },
  });
  await api.submit("search", { keyword: "白衬衫", limit: 5 }, "taobao");
  assert.deepEqual(sent, {
    platform: "taobao",
    action: "search",
    params: { keyword: "白衬衫", limit: 5 },
    mode: "async",
  });
  assert.throws(() => api.submit("product_detail", { url: "12345" }, "taobao"));
  assert.throws(() => api.submit("search", { keyword: "x" }, "unknown"));
});
test("Agent product result stays within public event size even for long image URLs", () => {
  const input = productInput({ keyword: "衬衫" }, "alice");
  const result = normalizeProducts(
    {
      results: Array.from({ length: 5 }, (_, i) => ({
        id: String(637637661300 + i),
        title: "a".repeat(180),
        image_url: "https://img.alicdn.com/" + "a".repeat(1900),
        price: 1,
        currency: "CNY",
        price_basis: "page",
      })),
    },
    input,
  );
  assert.ok(JSON.stringify(agentInspirationResult(result)).length <= 12000);
});
