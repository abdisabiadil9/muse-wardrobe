import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  loadStyleSkill,
  skillForm,
  archiveMatches,
  PublishClient,
  publishStyleSkill,
} from "./skill-publisher.mjs";
const pkg = await loadStyleSkill();
const archive = zipSync(
  Object.fromEntries(pkg.files.map((f) => [f.path, f.bytes])),
);
function fixture({
  existing = false,
  lose = false,
  reject = false,
  invisible = false,
} = {}) {
  const state = {
    id: "skill_fixture",
    versions: existing
      ? [
          {
            version: "1000",
            name: pkg.name,
            directory: pkg.name,
            skill_id: "skill_fixture",
            bytes: zipSync({
              [pkg.name + "/SKILL.md"]: strToU8("old release"),
            }),
          },
        ]
      : [],
    created: existing,
    writes: 0,
    forms: [],
    journal: {},
    saved: [],
  };
  const client = {
    async list(path) {
      if (path.startsWith("/skills?"))
        return state.created && !invisible
          ? [
              {
                id: state.id,
                metadata: { muse_app: "muse-mobile", muse_skill: pkg.name },
              },
            ]
          : [];
      return invisible ? [] : state.versions.map(({ bytes, ...v }) => v);
    },
    async request(path, body) {
      if (body) {
        state.writes++;
        state.forms.push(body);
        if (reject)
          throw Object.assign(new Error("rejected"), { uncertain: false });
        state.created = true;
        const v = {
          version: String(2000 + state.writes),
          name: pkg.name,
          directory: pkg.name,
          skill_id: state.id,
          bytes: archive,
        };
        state.versions.unshift(v);
        if (lose)
          throw Object.assign(new Error("network lost"), { uncertain: true });
        return path === "/skills"
          ? { id: state.id, latest_version: v.version }
          : v;
      }
      const v = state.versions.find((v) => path.includes("/" + v.version));
      if (!v) throw new Error("missing version");
      return path.endsWith("/content")
        ? v.bytes
        : (({ bytes, ...meta }) => meta)(v);
    },
  };
  const run = () =>
    publishStyleSkill({
      client,
      pkg,
      journal: state.journal,
      persist: async () => state.saved.push(structuredClone(state.journal)),
    });
  return { state, client, run };
}
test("native upload is an exact allowlisted tree and archive readback detects extra/tampered files", async () => {
  const form = skillForm(pkg, true),
    files = form.getAll("files");
  assert.deepEqual(
    files.map((f) => f.name),
    pkg.files.map((f) => f.path),
  );
  assert.ok(
    files.every(
      (f) => f.name.startsWith(pkg.name + "/") && !f.name.includes(".."),
    ),
  );
  assert.equal(archiveMatches(archive, pkg), true);
  assert.equal(
    archiveMatches(
      zipSync({
        ...Object.fromEntries(pkg.files.map((f) => [f.path, f.bytes])),
        [pkg.name + "/unexpected.md"]: strToU8("untrusted"),
      }),
      pkg,
    ),
    false,
  );
  assert.equal(JSON.parse(form.get("metadata")).muse_skill, pkg.name);
});
test("create, verify content, pin, and rerun without another upload", async () => {
  const f = fixture();
  const b = await f.run();
  assert.equal(b.version, "2001");
  assert.equal(b.type, "custom");
  assert.equal(f.state.saved[0].skill.status, "dispatching");
  assert.equal(f.state.journal.skill.status, "confirmed");
  assert.deepEqual(await f.run(), b);
  assert.equal(f.state.writes, 1);
});
test("changed content creates a new immutable version on the original Skill", async () => {
  const f = fixture({ existing: true });
  const b = await f.run();
  assert.equal(b.skill_id, "skill_fixture");
  assert.equal(b.version, "2001");
  assert.equal(f.state.versions.length, 2);
  assert.equal(f.state.forms[0].get("metadata"), null);
});
test("lost create and lost version responses reconcile existing content without a duplicate write", async () => {
  for (const existing of [false, true]) {
    const f = fixture({ existing, lose: true });
    await assert.rejects(f.run(), /network lost/);
    assert.equal(f.state.journal.skill.status, "dispatching");
    const b = await f.run();
    assert.equal(b.version, "2001");
    assert.equal(f.state.writes, 1);
  }
});
test("unconfirmed invisible creation stays blocked instead of creating again", async () => {
  const f = fixture({ lose: true, invisible: true });
  await assert.rejects(f.run(), /network lost/);
  await assert.rejects(f.run(), /unconfirmed/);
  assert.equal(f.state.writes, 1);
});
test("a known rejected upload is not falsely confirmed", async () => {
  const f = fixture({ reject: true });
  await assert.rejects(f.run(), /rejected/);
  assert.equal(f.state.journal.skill.status, "rejected");
});
test("multipart transport owns its boundary and never logs provider errors", async () => {
  const calls = [];
  const client = new PublishClient(
    "private-test-credential",
    async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "skill_x" }), { status: 201 });
    },
  );
  await client.request("/skills", skillForm(pkg, true));
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer private-test-credential",
  );
  const denied = new PublishClient(
    "private-test-credential",
    async () => new Response("secret echoed", { status: 403 }),
  );
  await assert.rejects(
    denied.request("/skills", skillForm(pkg, true)),
    (e) =>
      e.status === 403 &&
      e.uncertain === false &&
      !e.message.includes("secret echoed"),
  );
});
test("publisher rejects repeated pagination cursors", async () => {
  const client = new PublishClient(
    "test",
    async () =>
      new Response(
        JSON.stringify({ data: [], has_more: true, next_page: "same" }),
      ),
  );
  await assert.rejects(client.list("/skills"), /cursor repeated/);
});
