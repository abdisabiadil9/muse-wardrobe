// Browser contract check. All API calls are intercepted; no provider requests.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.MUSE_UI_URL || 'http://127.0.0.1:5179';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const owner = 'browser-fixture';
const now = new Date().toISOString();
const categoryImages = {
  coat: 'oat',
  top: 'tee',
  bottom: 'jeans',
  shoes: 'shoe',
  bag: 'bag',
};
const garments = Object.entries(categoryImages).map(([category, name]) => ({
  id: `g-${category}`,
  name: `测试${category}`,
  category,
  image_asset_id: `a-${category}`,
  source: 'upload',
  revision: 0,
}));
const allSlots = Object.fromEntries(
  garments.map((g) => [
    g.category,
    {
      source: 'wardrobe',
      ref_id: g.id,
      asset_id: g.image_asset_id,
      locked: false,
    },
  ]),
);
const drafts = Object.fromEntries(
  ['daily', 'weekend', 'meeting'].map((scene) => [
    scene,
    {
      id: `d-${scene}`,
      scene,
      revision: 0,
      slots: { top: allSlots.top },
      canvas_layout: {},
      updated_at: now,
    },
  ]),
);
const assets = Object.fromEntries(
  garments.map((g) => [
    g.image_asset_id,
    {
      id: g.image_asset_id,
      kind: 'garment',
      status: 'ready',
      download_url: `/assets/garments/${categoryImages[g.category]}.png`,
    },
  ]),
);
garments.push({
  id: 'g-top-alt',
  name: '另一件上装',
  category: 'top',
  image_asset_id: 'a-top-alt',
  source: 'upload',
  revision: 0,
});
assets['a-top-alt'] = { ...assets['a-top'], id: 'a-top-alt' };
let task, imageTask;
let native = [];
let stylingRequests = 0,
  tryonRequests = 0,
  patchRequests = 0;
const saved = [];
const unknown = [];
const respond = (route, value, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  });
await page.route('**/api/**', async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const path = url.pathname.replace('/api/v1', ''),
    method = request.method();
  const body = () => request.postDataJSON();
  if (path === '/capabilities')
    return respond(route, {
      mode: 'live',
      ai_styling: true,
      image_tryon: true,
      realtime_tryon: false,
      memory: false,
      dream: false,
    });
  if (path === '/me')
    return respond(route, {
      id: owner,
      display_name: 'MUSE 测试',
      timezone: 'Asia/Shanghai',
      csrf_token: 'fixture',
      quota: { styling_remaining: 10, tryon_remaining: 10 },
    });
  if (path === '/garments')
    return respond(route, { data: garments, next_cursor: null });
  if (path.startsWith('/outfit-drafts/')) {
    const scene = path.split('/').at(-1);
    if (method === 'PATCH') {
      patchRequests++;
      if (body().expected_revision !== drafts[scene].revision)
        return respond(
          route,
          { error: { code: 'conflict', message: '版本冲突' } },
          409,
        );
      drafts[scene] = {
        ...drafts[scene],
        ...body(),
        revision: drafts[scene].revision + 1,
      };
    }
    return respond(route, drafts[scene]);
  }
  if (path === '/outfits') {
    if (method === 'POST') {
      const draft = Object.values(drafts).find((d) => d.id === body().draft_id);
      const record = {
        id: `saved-${saved.length}`,
        draft_id: draft.id,
        source_revision: draft.revision,
        snapshot: structuredClone(draft),
        created_at: now,
      };
      saved.push(record);
      return respond(route, record, 201);
    }
    return respond(route, { data: saved, next_cursor: null });
  }
  if (path === '/styling-tasks') {
    stylingRequests++;
    task = {
      id: 'style-fixture',
      type: 'styling',
      status: 'running',
      stage: 'reading_wardrobe',
      last_event_seq: 1,
      result: null,
      error: null,
      created_at: now,
    };
    native = [
      {
        id: 'evt-user',
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ scene: 'daily', message: body().message }),
          },
        ],
      },
      {
        id: 'evt-text',
        type: 'agent.message',
        content: [
          { type: 'text', text: '先看看你的衣橱，再选一套舒服的组合。' },
        ],
      },
      {
        id: 'evt-tool',
        type: 'agent.custom_tool_use',
        name: 'read_wardrobe',
        input: {},
      },
    ];
    return respond(route, { task_id: task.id, status: 'queued' }, 202);
  }
  if (path.endsWith('/agent-events')) {
    const after = url.searchParams.get('after');
    const index = native.findIndex((event) => event.id === after);
    return respond(route, {
      data: after ? native.slice(index + 1) : native,
      next_cursor: null,
    });
  }
  if (path.endsWith('/events'))
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `id: ${Date.now()}\nevent: agent.events_updated\ndata: {}\n\n`,
    });
  if (path === '/tasks/style-fixture') return respond(route, task);
  if (path === '/tasks/image-fixture') return respond(route, imageTask);
  if (path === '/media/uploads') {
    assets.person = {
      id: 'person',
      kind: 'person',
      status: 'ready',
      download_url: '/assets/models/female.png',
    };
    return respond(route, {
      asset_id: 'person',
      upload_url: '/api/v1/fixture-upload',
      method: 'PUT',
      expires_at: now,
    });
  }
  if (path === '/fixture-upload') return route.fulfill({ status: 204 });
  if (path.startsWith('/media/')) {
    const id = path.split('/')[2];
    return respond(route, assets[id]);
  }
  if (path === '/tryon-tasks') {
    tryonRequests++;
    const draft = Object.values(drafts).find((d) => d.id === body().draft_id);
    assets.result = {
      id: 'result',
      kind: 'tryon_result',
      status: 'ready',
      download_url: '/assets/models/female.png',
    };
    imageTask = {
      id: 'image-fixture',
      type: 'tryon',
      status: 'succeeded',
      last_event_seq: 2,
      created_at: now,
      error: null,
      result: {
        kind: 'tryon_result',
        result_asset: assets.result,
        draft_id: draft.id,
        draft_revision: draft.revision,
        mode: 'outfit',
        slots: structuredClone(draft.slots),
        person_asset_id: 'person',
        model: 'fixture',
        prompt_version: 'fixture',
      },
    };
    return respond(route, { task_id: imageTask.id, status: 'queued' }, 202);
  }
  unknown.push(`${method} ${path}`);
  return respond(
    route,
    { error: { message: 'Unexpected fixture route', code: 'fixture_route' } },
    404,
  );
});

try {
  await page.goto(`${base}/?screen=today`);
  await expect(
    page.getByRole('heading', { name: '今日搭配', exact: true }),
  ).toBeVisible();
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: 'AI 搭配', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Lumi' })).toBeVisible();
  await page
    .getByRole('textbox', { name: '告诉 Lumi 你的穿搭想法' })
    .fill('明天上课，帮我搭一套。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const tool = page.locator('.ai-tool-trigger').first();
  await expect(tool).toContainText('进行中');
  await tool.click();
  native.push({
    id: 'evt-result',
    type: 'user.custom_tool_result',
    custom_tool_use_id: 'evt-tool',
    content: [{ type: 'text', text: '找到 5 件衣物' }],
    is_error: false,
  });
  await expect(tool).toContainText('已完成');
  await expect(tool).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText('先看看你的衣橱，再选一套舒服的组合。', { exact: true }),
  ).toHaveCount(1);
  native.push({
    id: 'evt-image',
    type: 'agent.message',
    content: [
      { type: 'text', text: '![衣橱里的针织衫](/assets/garments/tee.png)' },
    ],
  });
  const inlineImage = page.getByRole('button', { name: '衣橱里的针织衫' });
  await expect(inlineImage).toBeVisible();
  await inlineImage.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  native.push({
    id: 'evt-long',
    type: 'agent.message',
    content: [
      {
        type: 'text',
        text: Array.from(
          { length: 18 },
          (_, i) => `${i + 1}. 衣物配色与场合说明，用于检查阅读时的位置稳定。`,
        ).join('\n\n'),
      },
    ],
  });
  await expect(page.locator('.ai-markdown li')).toHaveCount(18);
  const viewport = page.locator('.ai-chat-viewport');
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  native.push({
    id: 'evt-later',
    type: 'agent.message',
    content: [{ type: 'text', text: '新的说明已经到达，原有内容保持不变。' }],
  });
  await expect(
    page.getByRole('button', { name: '回到最新消息' }),
  ).toBeVisible();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThan(5);
  await page.getByRole('button', { name: '回到最新消息' }).click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(10);
  if (patchRequests !== 0)
    throw new Error('AI execution changed the draft before adoption');
  native.push(
    {
      id: 'evt-final',
      type: 'agent.message',
      content: [
        { type: 'text', text: '**这套适合上课。** 用柔白针织搭配直筒牛仔裤。' },
      ],
    },
    {
      id: 'evt-idle',
      type: 'session.status_idle',
      stop_reason: { type: 'end_turn' },
    },
  );
  task = {
    ...task,
    status: 'succeeded',
    stage: null,
    last_event_seq: 2,
    result: {
      kind: 'outfit_proposal',
      task_id: task.id,
      proposal_id: 'proposal-fixture',
      draft_revision: 0,
      garment_ids: Object.values(allSlots).map((slot) => slot.ref_id),
      slots: allSlots,
      reason: '柔白针织与直筒牛仔裤，舒服又利落。',
      owned_count: 5,
      new_cost_fen: 0,
    },
  };
  await expect(
    page.getByRole('button', { name: '查看这套搭配并调整' }),
  ).toBeVisible();
  await expect(tool).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(
    page.getByRole('button', { name: '查看这套搭配并调整' }),
  ).toBeVisible();
  if (stylingRequests !== 1 || patchRequests !== 0)
    throw new Error('Reload resubmitted or adopted a proposal');
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '今天想怎么穿？' }),
  ).toBeVisible();
  await expect(page.locator('.ai-round')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '今天想怎么穿？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '历史对话' })).toBeVisible();
  await expect(page.locator('.ai-history-item')).toHaveCount(2);
  await page
    .locator('.ai-history-item')
    .filter({ hasText: '明天上课，帮我搭一套。' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '查看这套搭配并调整' }),
  ).toBeVisible();
  if (stylingRequests !== 1)
    throw new Error('Creating or switching conversations started generation');
  await page.getByRole('button', { name: '查看这套搭配并调整' }).click();
  await expect(page.getByText('这套里的单品', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏搭配', exact: true }).click();
  await page.getByRole('button', { name: '用这套', exact: true }).click();
  await expect.poll(() => patchRequests).toBe(1);
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: '今日', exact: true })
    .click();
  await expect(page.locator('.content-look-card').first()).toBeVisible();
  await page.locator('.content-look-card').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.artifacts/home-outfit-cards.png' });
  const background = await page
    .locator('.content-piece .item-image')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (background !== 'rgba(0, 0, 0, 0)')
    throw new Error('Garment card reintroduced an opaque image rectangle');
  await page.locator('.content-look-card').first().click();
  await page.getByRole('button', { name: '生成上身图', exact: true }).click();
  await expect(page.getByText('女模特', { exact: true })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成试穿图', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '保存试穿图', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '保存试穿图', exact: true }).click();
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: '我的', exact: true })
    .click();
  await page.getByRole('button', { name: '上身图', exact: true }).click();
  await expect(page.locator('.content-look-photo').first()).toBeVisible();
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: 'AI 搭配', exact: true })
    .click();
  await expect(page.getByAltText('整套 AI 试穿效果')).toBeVisible();
  await page.getByRole('button', { name: '查看这套搭配并调整' }).click();
  await page.getByRole('button', { name: '调整这套', exact: true }).click();
  await page.getByRole('button', { name: '画布选择上装', exact: true }).click();
  await page
    .getByRole('button', { name: '今日选衣：另一件上装', exact: true })
    .click();
  await expect.poll(() => drafts.daily.slots.top.ref_id).toBe('g-top-alt');
  await expect(page.locator('[data-muse-sheet="wardrobe"]')).toHaveCount(0);
  if (drafts.weekend.revision !== 0 || drafts.meeting.revision !== 0)
    throw new Error('Editing one look changed another scene');
  if (imageTask.result.slots.top.ref_id !== 'g-top')
    throw new Error('Editing a look changed previous image provenance');
  if (tryonRequests !== 1)
    throw new Error('Changing a garment automatically generated another image');
  await page
    .locator('.muse-tabbar-dock')
    .getByRole('link', { name: '灵感', exact: true })
    .click();
  await expect(page.locator('.inspiration-image')).toHaveCount(3);
  await page.locator('.inspiration-image').first().click();
  await page
    .getByRole('button', { name: '用这个灵感搭配', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: '告诉 Lumi 你的穿搭想法' }),
  ).not.toHaveValue('');
  if (stylingRequests !== 1 || tryonRequests !== 1)
    throw new Error(
      'Navigation or inspiration automatically started generation',
    );
  // A new conversation must send only its own request, never previous chat context.
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  let secondMessage;
  const secondTask = {
    ...task,
    id: 'style-second',
    status: 'needs_input',
    result: null,
    question: '你想搭配什么场合？',
  };
  await page.route('**/api/v1/styling-tasks', async (route) => {
    secondMessage = route.request().postDataJSON().message;
    stylingRequests++;
    await respond(route, { task_id: secondTask.id, status: 'queued' }, 202);
  });
  await page.route('**/api/v1/tasks/style-second', (route) =>
    respond(route, secondTask),
  );
  await page.route('**/api/v1/tasks/style-second/agent-events?*', (route) =>
    respond(route, { data: [], next_cursor: null }),
  );
  await page
    .getByRole('textbox', { name: '告诉 Lumi 你的穿搭想法' })
    .fill('周末去看展');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => secondMessage).toBe('周末去看展');
  await expect(
    page.getByText('你想搭配什么场合？', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '查看这套搭配并调整' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('你想搭配什么场合？', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.screenshot({ path: '.artifacts/chat-history.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page
    .locator('.ai-history-item')
    .filter({ hasText: '明天上课，帮我搭一套。' })
    .click();
  await expect(
    page.getByRole('button', { name: '查看这套搭配并调整' }),
  ).toBeVisible();
  if (stylingRequests !== 2)
    throw new Error('History replay submitted another task');
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error('Horizontal overflow');
  for (const size of [
    { width: 320, height: 650 },
    { width: 390, height: 500 },
    { width: 430, height: 900 },
    { width: 1024, height: 700 },
  ]) {
    await page.setViewportSize(size);
    const composer = await page.locator('.ai-compose').boundingBox();
    const dock = await page.locator('.muse-tabbar-dock').boundingBox();
    if (!composer || !dock || composer.y + composer.height > dock.y)
      throw new Error(
        `Composer hidden by navigation at ${JSON.stringify(size)}`,
      );
    await page
      .getByRole('button', { name: '新建对话', exact: true })
      .click({ trial: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (errors.length || unknown.length)
    throw new Error(JSON.stringify({ errors, unknown }));
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/style-flow-chat.png' });
  console.log(
    'PASS: native timeline, stable expansion, explicit adoption, refresh recovery, home card, try-on result, isolated conversation history, mobile layout, mine, inspiration. No provider calls.',
  );
} catch (error) {
  console.error({ errors, unknown });
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/style-flow-failure.png' });
  throw error;
} finally {
  await browser.close();
}
