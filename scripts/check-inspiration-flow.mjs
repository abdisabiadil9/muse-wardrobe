// Browser fixtures only. No requests reach EveryInfra, Qoder or Seedream.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.MUSE_UI_URL || 'http://127.0.0.1:5182';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [],
  unexpected = [],
  bodies = [],
  keys = [];
page.on('pageerror', (e) => errors.push(e.message));
const owner = 'inspiration-browser-fixture',
  now = new Date().toISOString();
let enabled = true,
  ready = false,
  loseNext = false,
  stylingMessage = '',
  tasks = {};
const note = {
  id: 'abcdef0123456789abcdef01',
  title: '周末的奶油白与牛仔蓝',
  text: '用柔软的基础单品组合轻松的日常感。',
  images: ['https://sns-img.xhscdn.com/browser-fixture.webp'],
  author: '浏览器测试作者',
  tags: ['简约', '日常'],
  source: 'xiaohongshu',
  url: 'https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01',
  is_summary: true,
  is_video: false,
  sponsored: null,
};
const full = {
  ...note,
  is_summary: false,
  text: '完整笔记测试：奶油白针织衫搭配直筒牛仔裤。保持干净的色彩和宽松但有结构的廓形。',
};
const products = {
  kind: 'product_search_result',
  query: '白色衬衫',
  fetched_at: now,
  cached: false,
  price_notice: '以商品页为准',
  data: [
    {
      id: '637637661300',
      title: '测试白色衬衫',
      images: ['https://img.alicdn.com/fixture.jpg'],
      price: 49.9,
      currency: 'CNY',
      price_basis: 'promotion',
      shop_name: null,
      is_tmall: null,
      listed_price_in_range: true,
      source: 'taobao',
      owned: false,
    },
    {
      id: '637637661301',
      title: '预算外商品',
      images: [],
      price: 199,
      currency: 'CNY',
      price_basis: 'list',
      shop_name: '测试店铺',
      is_tmall: true,
      listed_price_in_range: false,
      source: 'taobao',
      owned: false,
    },
  ],
};
const respond = (r, v, status = 200) =>
  r.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(v),
  });
await context.route('https://sns-img.xhscdn.com/**', (r) =>
  r.fulfill({
    path: 'public/assets/models/female.png',
    contentType: 'image/png',
  }),
);
await context.route('https://img.alicdn.com/**', (r) =>
  r.fulfill({
    path: 'public/assets/garments/tee.png',
    contentType: 'image/png',
  }),
);
await context.route('**/api/**', async (r) => {
  const req = r.request(),
    url = new URL(req.url()),
    path = url.pathname.replace('/api/v1', '');
  if (!url.pathname.startsWith('/api/')) return r.continue();
  if (path === '/capabilities')
    return respond(r, {
      mode: 'live',
      inspiration: enabled,
      ai_styling: true,
      image_tryon: true,
      realtime_tryon: false,
      memory: false,
      dream: false,
    });
  if (path === '/me')
    return respond(r, {
      id: owner,
      display_name: '测试',
      timezone: 'Asia/Shanghai',
      csrf_token: 'fixture',
      quota: { styling_remaining: 10, tryon_remaining: 10 },
    });
  if (path === '/garments')
    return respond(r, {
      data: [
        {
          id: 'g-top',
          name: '基础上装',
          category: 'top',
          image_asset_id: 'a-top',
          source: 'upload',
          revision: 0,
        },
      ],
      next_cursor: null,
    });
  if (path === '/media/a-top')
    return respond(r, {
      id: 'a-top',
      kind: 'garment',
      status: 'ready',
      download_url: '/assets/garments/tee.png',
    });
  if (path === '/outfits') return respond(r, { data: [], next_cursor: null });
  if (path.startsWith('/outfit-drafts/')) {
    const scene = path.split('/').at(-1);
    return respond(r, {
      id: 'd-' + scene,
      scene,
      revision: 0,
      slots: {
        top: {
          source: 'wardrobe',
          ref_id: 'g-top',
          asset_id: 'a-top',
          locked: false,
        },
      },
      canvas_layout: {},
      updated_at: now,
    });
  }
  if (path === '/inspirations')
    return respond(r, {
      data: ready ? [note] : [],
      fetched_at: ready ? now : null,
      stale: !ready,
      next_cursor: null,
    });
  if (path === '/inspiration-tasks') {
    bodies.push(req.postDataJSON());
    keys.push(req.headers()['idempotency-key']);
    if (loseNext) {
      loseNext = false;
      return r.abort('connectionfailed');
    }
    const id = 'inspiration-' + bodies.length,
      body = bodies.at(-1);
    tasks[id] = {
      id,
      type: 'inspiration',
      status: body.action === 'note' ? 'succeeded' : 'queued',
      stage: 'fetching_inspiration',
      error: null,
      result:
        body.action === 'note'
          ? {
              kind: 'inspiration_result',
              data: [full],
              fetched_at: now,
              cached: false,
            }
          : null,
    };
    return respond(r, { task_id: id, status: tasks[id].status }, 202);
  }
  if (path === '/styling-tasks') {
    stylingMessage = req.postDataJSON().message;
    return respond(r, { task_id: 'style-fixture', status: 'queued' }, 202);
  }
  if (path === '/tasks/style-fixture')
    return respond(r, {
      id: 'style-fixture',
      type: 'styling',
      status: 'running',
      stage: 'reading_wardrobe',
      result: null,
      error: null,
      last_event_seq: 0,
      created_at: now,
    });
  if (path.endsWith('/agent-events'))
    return respond(r, {
      data: stylingMessage
        ? [
            {
              id: 'evt_user',
              type: 'user.message',
              content: [{ type: 'text', text: stylingMessage }],
            },
            {
              id: 'evt_source',
              type: 'agent.custom_tool_use',
              name: 'search_inspirations',
              input: { style_id: 'city' },
            },
            {
              id: 'evt_source_result',
              type: 'user.custom_tool_result',
              custom_tool_use_id: 'evt_source',
              is_error: false,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    kind: 'inspiration_result',
                    data: [note],
                    fetched_at: now,
                    cached: false,
                  }),
                },
              ],
            },
            {
              id: 'evt_product',
              type: 'agent.custom_tool_use',
              name: 'search_products',
              input: { keyword: '白色衬衫' },
            },
            {
              id: 'evt_product_result',
              type: 'user.custom_tool_result',
              custom_tool_use_id: 'evt_product',
              is_error: false,
              content: [{ type: 'text', text: JSON.stringify(products) }],
            },
          ]
        : [],
      next_cursor: null,
    });
  if (path.endsWith('/events'))
    return r.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `id: 1\nevent: agent.events_updated\ndata: {}\n\n`,
    });
  if (path.startsWith('/tasks/inspiration-')) {
    const t = tasks[path.split('/').at(-1)];
    if (ready && t.status === 'queued')
      Object.assign(t, {
        status: 'succeeded',
        result: {
          kind: 'inspiration_result',
          data: [note],
          fetched_at: now,
          cached: false,
        },
      });
    return respond(r, t);
  }
  unexpected.push(`${req.method()} ${path}`);
  return respond(r, { error: { message: 'Unexpected fixture route' } }, 404);
});
try {
  await page.goto(base + '/?screen=discover');
  await expect(page.locator('.inspo-style-rail button')).toHaveCount(12);
  assert.equal(bodies.length, 0, 'browsing must never submit a source request');
  await page.getByRole('button', { name: '看廓形、单品和适用场景' }).click();
  await expect(page.locator('.inspo-definition')).toContainText('代表单品');
  await page.getByRole('button', { name: /找「.*」的图片/ }).click();
  await expect.poll(() => bodies.length).toBe(1);
  await expect(page.locator('.inspo-status')).toContainText(
    '离开页面后也能恢复',
  );
  await page.reload();
  await expect(page.locator('.inspo-status')).toContainText(
    '离开页面后也能恢复',
  );
  assert.equal(bodies.length, 1, 'refresh must not resubmit');
  ready = true;
  await expect(page.locator('.inspo-note')).toHaveCount(1, { timeout: 7000 });
  await expect(page.locator('.inspo-note img')).toBeVisible();
  assert.equal(
    await page
      .locator('.inspo-note img')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await mkdir('.local/inspiration-check', { recursive: true });
  await page.locator('.inspo-source-section').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '.local/inspiration-check/mobile-library.png',
  });
  await page.locator('.inspo-note').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  assert.equal(bodies.length, 1, 'opening existing summary is free');
  await page.getByRole('button', { name: '读取完整笔记' }).click();
  await expect(page.getByText('已读取笔记全文')).toBeVisible();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].action, 'note');
  await page.screenshot({ path: '.local/inspiration-check/mobile-detail.png' });
  await page.getByRole('button', { name: '变成我的穿搭' }).click();
  const compose = page.getByRole('textbox', { name: '告诉 Lumi 你的穿搭想法' });
  await expect(compose).toHaveValue(/完整笔记测试/);
  await expect(compose).toHaveValue(/未进行图片视觉分析/);
  assert.ok((await compose.inputValue()).length <= 2000);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => stylingMessage).toContain('完整笔记测试');
  await expect(page.getByLabel('Lumi 找到的图文灵感')).toBeVisible();
  await expect(
    page.getByLabel('Lumi 找到的图文灵感').locator('img'),
  ).toBeVisible();
  await page.getByRole('button', { name: '照这套搭配' }).click();
  await expect(compose).toHaveValue(/周末的奶油白与牛仔蓝/);
  await expect(page.getByLabel('Lumi 找到的淘宝商品')).toBeVisible();
  await expect(page.getByText('推广参考价', { exact: true })).toBeVisible();
  await expect(page.getByText('划线价', { exact: true })).toBeVisible();
  await expect(page.getByText('参考价超出预算范围')).toBeVisible();
  await page.getByRole('button', { name: '看看怎么搭' }).first().click();
  await expect(compose).toHaveValue(/还没有购买/);
  await expect(
    page.getByRole('link', { name: '查看淘宝商品' }),
  ).toHaveAttribute('href', 'https://item.taobao.com/item.htm?id=637637661300');
  await page.screenshot({ path: '.local/inspiration-check/agent-cards.png' });
  // Restore an interrupted application POST with the exact original idempotency key.
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: '灵感', exact: true })
    .click();
  loseNext = true;
  await page
    .getByRole('textbox', { name: '搜索穿搭或粘贴小红书笔记链接' })
    .fill('轻松极简');
  await page.getByRole('button', { name: '搜索或导入笔记' }).click();
  await expect(page.getByRole('button', { name: '恢复原请求' })).toBeVisible();
  const before = bodies.length;
  await page.reload();
  await expect(page.getByRole('button', { name: '恢复原请求' })).toBeVisible();
  assert.equal(bodies.length, before);
  await page.getByRole('button', { name: '恢复原请求' }).click();
  await expect.poll(() => bodies.length).toBe(before + 1);
  assert.equal(keys.at(-1), keys.at(-2));
  // Link import is a separate explicit action, never a hidden detail fan-out.
  await expect(page.locator('.inspo-note')).toHaveCount(1);
  await page
    .getByRole('textbox', { name: '搜索穿搭或粘贴小红书笔记链接' })
    .fill('分享 https://xhslink.com/a/fixture');
  await page.getByRole('button', { name: '搜索或导入笔记' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  assert.equal(bodies.at(-1).action, 'note');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  enabled = false;
  await page.reload();
  await expect(
    page.getByText('图文灵感暂未开通。你可以先用上面的风格说明搭配。'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /找「.*」的图片/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '用我的衣橱搭这套风格' }),
  ).toBeEnabled();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS: 12 styles, image/detail/import, task refresh, no automatic paid requests, stable recovery key, Lumi handoff and unconfigured fallback.',
  );
} catch (error) {
  console.error({
    errors,
    unexpected,
    body: (await page.locator('body').innerText()).slice(0, 2500),
  });
  throw error;
} finally {
  await browser.close();
}
