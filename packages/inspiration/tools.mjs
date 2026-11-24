import { one } from '../db/index.mjs';
import { AppError } from '../domain/index.mjs';
import { styles, inspirationInput } from './domain.mjs';
import { enqueueInspiration } from './enqueue.mjs';
import { productTools, productInput } from '../products/domain.mjs';
const styleId = { type: 'string', enum: styles.map((s) => s.id) };
export const inspirationTools = [
  ...productTools,
  {
    type: 'custom',
    name: 'get_style_definition',
    description:
      '免费读取 MUSE 编辑定义的风格、配色、廓形、单品与搭配公式。省略 style_id 返回全部 12 种；不代表已经分析图片。',
    input_schema: {
      type: 'object',
      properties: { style_id: styleId },
      additionalProperties: false,
    },
  },
  {
    type: 'custom',
    name: 'search_inspirations',
    description:
      '按风格或公开关键词查小红书图文，返回图片 URL、摘要、作者和原文链接。优先 style_id 共享缓存；每次最多一页，无自动详情或翻页。后端执行收费与恢复控制，不传私人衣橱/照片/个人信息。',
    input_schema: {
      type: 'object',
      properties: {
        style_id: styleId,
        keyword: { type: 'string', minLength: 1, maxLength: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'custom',
    name: 'read_inspiration_note',
    description:
      '按用户提供或搜索结果中的小红书 URL 读取一篇完整笔记及图片。仅在摘要不足或用户选择笔记时调用，不批量展开搜索结果。',
    input_schema: {
      type: 'object',
      properties: {
        style_id: styleId,
        url: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
export const inspirationToolNames = new Set(
  inspirationTools.map((t) => t.name),
);
export function agentInspirationResult(result) {
  if (result.kind === 'product_search_result') {
    const output = {
      ...result,
      data: result.data.map((p) => ({ ...p, images: p.images.slice(0, 1) })),
    };
    while (JSON.stringify(output).length > 12000 && output.data.length > 1)
      output.data.pop();
    return output;
  }
  // Never send source access tokens to the Agent. Image URLs remain provider-approved.
  const output = {
    ...result,
    data: result.data.slice(0, 8).map((n) => ({
      ...n,
      url: `https://www.xiaohongshu.com/explore/${n.id}`,
      images: n.images.slice(0, 3),
      text: n.text.slice(0, 1500),
    })),
  };
  while (JSON.stringify(output).length > 12000 && output.data.length > 1)
    output.data.pop();
  if (JSON.stringify(output).length > 12000 && output.data[0]) {
    output.data[0].text = output.data[0].text.slice(0, 300);
    output.data[0].images = output.data[0].images.slice(0, 1);
    output.data[0].tags = [];
  }
  return output;
}
/** Only local DB work inside the task fence. Network happens in a child source task. */
export async function prepareInspirationTool(
  db,
  task,
  session,
  call,
  config,
  prior,
) {
  const args = call.input;
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new TypeError('Invalid source tool input');
  const allowed =
    call.name === 'search_products'
      ? ['keyword', 'min_price', 'max_price', 'sort', 'tmall_only']
      : call.name === 'get_style_definition'
        ? ['style_id']
        : call.name === 'search_inspirations'
          ? ['style_id', 'keyword']
          : ['style_id', 'url'];
  if (Object.keys(args).some((k) => !allowed.includes(k)))
    throw new TypeError('Unknown source tool argument');
  if (
    args.style_id !== undefined &&
    !styles.some((s) => s.id === args.style_id)
  )
    throw new TypeError('Unknown style');
  if (call.name === 'get_style_definition')
    return {
      result: {
        kind: 'style_definitions',
        data: args.style_id
          ? styles.filter((s) => s.id === args.style_id)
          : styles,
      },
    };
  const input =
    call.name === 'search_products'
      ? productInput(args, task.owner_id)
      : inspirationInput(
          {
            action: call.name === 'search_inspirations' ? 'search' : 'note',
            ...args,
          },
          task.owner_id,
        );
  let sourceId = prior?.source_task_id;
  if (!sourceId) {
    const count = await one(
      db,
      "SELECT count(*)::int AS count FROM tool_calls WHERE session_id=$1 AND name IN ('search_inspirations','read_inspiration_note','search_products')",
      [session.qoder_session_id],
    );
    if (count.count >= 3)
      throw new AppError(
        429,
        'inspiration_turn_limit',
        '本次对话最多三次来源查询，请使用已有结果继续',
      );
    const ack = await enqueueInspiration(
      db,
      { ...input, parent_task_id: task.id },
      task.owner_id,
      config,
    );
    sourceId = ack.task_id;
    await db.query(
      "INSERT INTO tool_calls(session_id,call_event_id,owner_id,name,input,state,source_task_id) VALUES($1,$2,$3,$4,$5,'waiting_source',$6) ON CONFLICT(session_id,call_event_id) DO NOTHING",
      [
        session.qoder_session_id,
        call.id,
        task.owner_id,
        call.name,
        args,
        sourceId,
      ],
    );
  }
  const source = await one(
    db,
    "SELECT * FROM tasks WHERE id=$1 AND owner_id=$2 AND type='inspiration'",
    [sourceId, task.owner_id],
  );
  if (!source) throw new AppError(404, 'source_not_found', '来源任务不可用');
  if (['queued', 'running', 'waiting_tools'].includes(source.status))
    return { pending: true };
  if (source.status === 'succeeded')
    return { result: agentInspirationResult(source.result) };
  throw new AppError(
    502,
    source.error?.code ?? 'source_failed',
    source.error?.message ??
      '来源内容不可用；请用已有资料继续，不重复提交相同查询',
  );
}
