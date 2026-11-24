import test from "node:test";
import assert from "node:assert/strict";
import { agentDefinition, agentPatch, basicTools } from "./agent.mjs";
import { readFileSync } from "node:fs";
const skillBinding = {
  type: "custom",
  skill_id: "skill_fixture",
  version: "1234567890",
};
test("Agent requires immutable Skill binding and keeps all six business tools", () => {
  const a = agentDefinition("auto", { skillBinding });
  assert.deepEqual(a.tools[0].enabled_tools, basicTools);
  assert.ok(
    basicTools.length &&
      !basicTools.includes("ImageGen") &&
      !basicTools.includes("VideoGen"),
  );
  assert.deepEqual(
    a.tools.filter((t) => t.type === "custom").map((t) => t.name),
    [
      "read_wardrobe",
      "propose_outfit",
      "search_products",
      "get_style_definition",
      "search_inspirations",
      "read_inspiration_note",
    ],
  );
  assert.deepEqual(a.skills, [skillBinding]);
  const skill = readFileSync(
    new URL("./skills/muse-style-discovery/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.ok(!a.system.includes(skill));
  assert.throws(() => agentDefinition("auto"), /pinned/);
  assert.throws(
    () =>
      agentDefinition("auto", {
        skillBinding: { ...skillBinding, version: "latest" },
      }),
    /pinned/,
  );
});
test("Agent patch preserves unrelated Skills and tools, replacing owned duplicates once", () => {
  const other = { type: "custom", skill_id: "skill_other", version: "777" };
  const mcp = { type: "mcp_toolset", mcp_server_name: "other" };
  const custom = {
    type: "custom",
    name: "other_tool",
    input_schema: { type: "object" },
  };
  const current = {
    model: "unchanged",
    metadata: { keep: "yes" },
    tools: [{ type: "custom", name: "SEARCH_PRODUCTS" }, mcp, custom],
    skills: [{ ...skillBinding, version: "1" }, other],
  };
  const p = agentPatch(current, agentDefinition("auto", { skillBinding }));
  assert.deepEqual(p.skills, [other, skillBinding]);
  assert.ok(p.tools.includes(mcp) && p.tools.includes(custom));
  assert.equal(
    p.tools.filter((t) => t.name?.toLowerCase() === "search_products").length,
    1,
  );
  assert.equal(p.model, undefined);
  assert.equal(p.metadata, undefined);
});
