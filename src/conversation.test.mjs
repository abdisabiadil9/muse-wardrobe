import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import ReactMarkdown from "react-markdown";
import {
  composeStylingMessage,
  conversationStorageKey,
  displayUserMessage,
  emptyRecord,
  mergeNativeEvents,
  mergeTask,
  projectConversation,
  projectNativeEvents,
  readConversationRecord,
  safeConversationImageUrl,
  safeConversationUrl,
  shouldFollowConversation,
} from "./conversation.ts";
const text = (id, value, type = "agent.message") => ({
  id,
  type,
  content: [{ type: "text", text: value }],
});
test("native event structure retains public text order and pairs tool results to call IDs", () => {
  const events = [
    text("user1", "明天怎么穿", "user.message"),
    text("a1", "Thought: 蓝色也很适合。"),
    {
      id: "call",
      type: "agent.custom_tool_use",
      name: "read_wardrobe",
      input: { categories: ["coat"] },
    },
    text("a2", "看看衣橱里的选择。"),
    {
      id: "result",
      type: "user.custom_tool_result",
      custom_tool_use_id: "call",
      content: [{ type: "text", text: '{"garments":[]}' }],
    },
    text("a3", "**推荐这套。**"),
    {
      id: "idle",
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    },
  ];
  const parts = projectNativeEvents(events);
  assert.deepEqual(
    parts.map((part) => part.id),
    ["user1", "a1", "call", "a2", "a3"],
  );
  assert.equal(parts[1].type, "text");
  assert.equal(parts[1].phase, "intermediate");
  assert.equal(parts[2].status, "succeeded");
  assert.deepEqual(parts[2].output, [
    { type: "text", text: '{"garments":[]}' },
  ]);
  assert.equal(parts.at(-1).phase, "final");
});
test("requires_action and text keywords never turn intermediate messages into final answers or tools", () => {
  const parts = projectNativeEvents([
    text("a", "Action: 保留外套。"),
    {
      id: "i",
      type: "session.status_idle",
      stop_reason: { type: "requires_action" },
    },
  ]);
  assert.deepEqual(parts, [
    {
      id: "a",
      type: "text",
      text: "Action: 保留外套。",
      phase: "intermediate",
    },
  ]);
});
test("native built-in results pair with tool_use_id and failed status stays failed", () => {
  const parts = projectNativeEvents([
    {
      id: "tool",
      type: "agent.tool_use",
      name: "Read",
      input: { path: "/redacted" },
    },
    {
      id: "result",
      type: "agent.tool_result",
      tool_use_id: "tool",
      is_error: true,
    },
  ]);
  assert.equal(parts[0].status, "failed");
  assert.equal(parts[0].output, undefined);
});
test("duplicate events and replayed native IDs do not duplicate messages or move a tool row", () => {
  const initial = [
    text("u", "你好", "user.message"),
    { id: "c", type: "agent.custom_tool_use", name: "read_wardrobe" },
  ];
  const merged = mergeNativeEvents(initial, [
    initial[0],
    text("a", "搭好了"),
    {
      id: "r",
      type: "user.custom_tool_result",
      custom_tool_use_id: "c",
      output: { count: 2 },
    },
  ]);
  assert.deepEqual(
    merged.map((event) => event.id),
    ["u", "c", "a", "r"],
  );
  assert.deepEqual(
    projectNativeEvents(merged).map((part) => part.id),
    ["u", "c", "a"],
  );
  assert.equal(projectNativeEvents(merged)[1].status, "succeeded");
});
test("needs-input continuation remains another chronological user turn with its own stable ID", () => {
  const parts = projectNativeEvents([
    text("u1", "搭一套", "user.message"),
    text("a1", "什么场合？"),
    {
      id: "i1",
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    },
    text("u2", "去上课", "user.message"),
    text("a2", "好的"),
  ]);
  assert.deepEqual(
    parts.map((part) => [part.id, part.type]),
    [
      ["u1", "user"],
      ["a1", "text"],
      ["u2", "user"],
      ["a2", "text"],
    ],
  );
  assert.equal(parts[1].phase, "final");
  assert.equal(parts[3].phase, "intermediate");
});
test("task snapshots never regress on stale event sequence", () => {
  const done = { id: "t", last_event_seq: 10, status: "succeeded" };
  assert.equal(
    mergeTask(done, { id: "t", last_event_seq: 9, status: "running" }),
    done,
  );
});
test("owner scoped pending requests restore exact idempotency key, payload and source draft", () => {
  const record = {
    ...emptyRecord(),
    ids: ["t"],
    messages: { t: "上课穿什么" },
    contexts: { t: { scene: "daily", draftId: "d", revision: 2 } },
    pending: {
      key: "stable-key",
      path: "/styling-tasks",
      message: "换一件",
      body: { message: "完整原始请求" },
      context: { scene: "weekend", draftId: "d2", revision: 4 },
    },
  };
  const storage = {
    getItem: (key) =>
      key === conversationStorageKey("one") ? JSON.stringify(record) : null,
  };
  assert.deepEqual(readConversationRecord(storage, "one"), record);
  assert.deepEqual(readConversationRecord(storage, "two"), emptyRecord());
  assert.deepEqual(
    readConversationRecord({ getItem: () => "broken-json" }, "one"),
    emptyRecord(),
  );
});
test("follow-up context respects API maximum and never truncates latest request to fit history", () => {
  const prompt = "请保留我的蓝外套";
  const message = composeStylingMessage(prompt, [
    { assistant: "此前建议".repeat(1800) },
  ]);
  assert.ok(message.length <= 2000);
  assert.ok(message.endsWith(prompt));
  assert.equal(
    composeStylingMessage("新".repeat(2000), [{}]),
    "新".repeat(2000),
  );
});
test("initial native user JSON unwraps actual prompt while plain text stays intact", () => {
  assert.equal(
    displayUserMessage(
      JSON.stringify({
        message: "明天上课",
        scene: "daily",
        instruction: "internal",
      }),
    ),
    "明天上课",
  );
  assert.equal(displayUserMessage("保留外套"), "保留外套");
  assert.equal(
    displayUserMessage('{"message":"普通JSON文本"}'),
    '{"message":"普通JSON文本"}',
  );
});
test("bottom-follow stops while reading upward and resumes only near bottom", () => {
  assert.equal(shouldFollowConversation(1000, 300, 400), false);
  assert.equal(shouldFollowConversation(1000, 590, 400), true);
  assert.equal(shouldFollowConversation(200, 0, 400), true);
});
test("safe streaming markdown tolerates partial fences and rejects raw HTML and unsafe URLs", () => {
  const render = (value) =>
    renderToStaticMarkup(
      React.createElement(
        ReactMarkdown,
        {
          skipHtml: true,
          urlTransform: safeConversationUrl,
          components: {
            img: ({ alt }) => React.createElement("span", {}, alt),
          },
        },
        value,
      ),
    );
  assert.doesNotThrow(() => render('推荐 **蓝色\n\n```json\n{"coat":'));
  const html = render(
    "<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![x](data:image/svg+xml,bad)",
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("data:image"));
  assert.equal(
    safeConversationUrl("https://example.com"),
    "https://example.com",
  );
});

test("saved initial prompt replaces wrapped contextual user payload while later answers stay native", () => {
  const events = [
    text(
      "u1",
      JSON.stringify({ scene: "daily", message: "此前搭配上下文 + 当前请求" }),
      "user.message",
    ),
    text("a1", "想保留外套吗？"),
    text("u2", "保留", "user.message"),
  ];
  const parts = projectConversation(events, "明天上课怎么穿");
  assert.equal(parts[0].text, "明天上课怎么穿");
  assert.equal(parts[2].text, "保留");
});
test("inline media allows protected app media and owned assets while blocking arbitrary remote images", () => {
  const origin = "https://muse.example";
  const media =
    "/api/v1/media/12345678-1234-1234-1234-123456789abc/content?token=signed";
  assert.equal(safeConversationImageUrl(media, origin), origin + media);
  assert.equal(
    safeConversationImageUrl("https://tracker.example/pixel.png", origin),
    "",
  );
  assert.equal(safeConversationImageUrl("data:image/svg+xml,bad", origin), "");
  assert.equal(safeConversationImageUrl("javascript:alert(1)", origin), "");
  assert.equal(
    safeConversationImageUrl("/assets/wardrobe.jpg", origin, [
      "/assets/wardrobe.jpg",
    ]),
    origin + "/assets/wardrobe.jpg",
  );
  assert.equal(
    safeConversationImageUrl(origin + "/assets/wardrobe.jpg", origin, [
      "/assets/wardrobe.jpg",
    ]),
    origin + "/assets/wardrobe.jpg",
  );
  assert.equal(
    safeConversationImageUrl("https://signed.example/outfit.png?x=1", origin, [
      "https://signed.example/outfit.png?x=1",
    ]),
    "https://signed.example/outfit.png?x=1",
  );
});
