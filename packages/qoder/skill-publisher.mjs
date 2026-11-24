import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { unzipSync } from "fflate";
const BASE = "https://api.qoder.com.cn/api/v1/cloud";
const paths = [
  "SKILL.md",
  "references/inspiration.md",
  "references/shopping.md",
  "references/outfits.md",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = (files) =>
  hash(
    JSON.stringify(
      files
        .map((f) => [f.path, hash(f.bytes)])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
export async function loadStyleSkill() {
  const name = "muse-style-discovery";
  const files = await Promise.all(
    paths.map(async (path) => {
      const file = new URL(`./skills/${name}/${path}`, import.meta.url);
      if (!(await lstat(file)).isFile())
        throw new Error("Skill uploads must contain regular files only");
      return { path: `${name}/${path}`, bytes: await readFile(file) };
    }),
  );
  if (!files[0].bytes.toString().startsWith(`---\nname: ${name}\n`))
    throw new Error("Skill name and directory must agree");
  for (const f of files) {
    if (
      f.bytes.length > 256000 ||
      /\b(?:ei|sk|pat|sat)[-_][A-Za-z0-9_-]{16,}/.test(f.bytes.toString())
    )
      throw new Error(
        "Skill file too large or contains a credential-like value",
      );
  }
  return { name, files, fingerprint: fingerprint(files) };
}
export function skillForm(pkg, create = false) {
  const body = new FormData();
  for (const f of pkg.files)
    body.append(
      "files",
      new Blob([f.bytes], { type: "text/markdown" }),
      f.path,
    );
  if (create) {
    body.append("display_title", pkg.name);
    body.append(
      "metadata",
      JSON.stringify({ muse_app: "muse-mobile", muse_skill: pkg.name }),
    );
  }
  return body;
}
export function archiveMatches(bytes, pkg) {
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error("Unexpected Skill archive size");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      if (total > 1024 * 1024 || entry.originalSize > 256000)
        throw new Error("Unexpected expanded Skill size");
      return !entry.name.endsWith("/");
    },
  });
  // Compare file contents, not ZIP timestamps/compression or mutable Skill metadata.
  return (
    fingerprint(
      Object.entries(files).map(([path, bytes]) => ({ path, bytes })),
    ) === pkg.fingerprint
  );
}
export class PublishClient {
  constructor(token, fetchImpl = globalThis.fetch) {
    this.token = token;
    this.fetch = fetchImpl;
  }
  async request(path, body, binary = false) {
    const write = body !== undefined;
    let response;
    try {
      response = await this.fetch(BASE + path, {
        method: write ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(write && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(write
          ? { body: body instanceof FormData ? body : JSON.stringify(body) }
          : {}),
      });
    } catch {
      throw Object.assign(
        new Error(
          "Qoder connection interrupted; reconcile the saved journal before another write",
        ),
        { uncertain: write },
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(
        new Error(`Qoder ${path}: HTTP ${response.status}; no automatic retry`),
        {
          status: response.status,
          uncertain:
            write &&
            ![400, 401, 403, 404, 409, 413, 422].includes(response.status),
        },
      );
    }
    try {
      const reader = response.body.getReader(),
        parts = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Response too large");
        }
        parts.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(parts);
      return binary ? bytes : JSON.parse(bytes.toString());
    } catch {
      throw Object.assign(
        new Error("Qoder response unreadable; reconcile the journal"),
        { uncertain: write },
      );
    }
  }
  async list(path) {
    const all = [],
      seen = new Set();
    let page;
    do {
      const r = await this.request(
        path +
          (path.includes("?") ? "&" : "?") +
          "limit=100" +
          (page ? "&page=" + encodeURIComponent(page) : ""),
      );
      if (!Array.isArray(r.data))
        throw new Error("Qoder list response invalid");
      all.push(...r.data);
      page = r.has_more ? r.next_page : null;
      if (r.has_more && !page)
        throw new Error("Qoder pagination cursor missing");
      if (page && seen.has(page))
        throw new Error("Qoder pagination cursor repeated");
      if (page) seen.add(page);
    } while (page);
    return all;
  }
}
const skillId = (id) => {
  if (!/^skill_[A-Za-z0-9_-]+$/.test(id ?? ""))
    throw new Error("Invalid Skill id");
  return id;
};
const version = (value) => {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Skill version must be a pinned numeric string");
  return value;
};
export async function publishStyleSkill({
  client,
  pkg,
  journal,
  persist,
  configuredId,
}) {
  const state = journal.skill;
  if (state?.status === "dispatching" && state.fingerprint !== pkg.fingerprint)
    throw new Error(
      "Unconfirmed Skill upload has different content; reconcile it first",
    );
  let id = configuredId || state?.id;
  if (
    state?.status === "dispatching" &&
    configuredId &&
    state.id &&
    configuredId !== state.id
  )
    throw new Error("Unconfirmed Skill upload belongs to a different resource");
  if (!id) {
    const matches = (await client.list("/skills?source=custom")).filter(
      (s) =>
        s.metadata?.muse_app === "muse-mobile" &&
        s.metadata?.muse_skill === pkg.name,
    );
    if (matches.length > 1)
      throw new Error(
        "Multiple matching Skills; set QODER_STYLE_SKILL_ID explicitly",
      );
    id = matches[0]?.id;
  }
  async function confirm(id, v) {
    const meta = await client.request(
      `/skills/${skillId(id)}/versions/${version(v)}`,
    );
    if (
      meta.name !== pkg.name ||
      meta.directory !== pkg.name ||
      meta.skill_id !== id ||
      meta.version !== v
    )
      throw new Error("Skill version readback mismatch");
    if (
      !archiveMatches(
        await client.request(
          `/skills/${id}/versions/${v}/content`,
          undefined,
          true,
        ),
        pkg,
      )
    )
      throw new Error("Uploaded Skill content does not match local files");
    journal.skill = {
      status: "confirmed",
      id,
      version: v,
      fingerprint: pkg.fingerprint,
    };
    await persist();
    return { type: "custom", skill_id: id, version: v };
  }
  if (id) {
    skillId(id);
    const versions = await client.list(`/skills/${id}/versions`);
    if (versions.some((v) => v.name !== pkg.name))
      throw new Error("Configured Skill belongs to a different skill name");
    for (const v of versions) {
      if (
        archiveMatches(
          await client.request(
            `/skills/${id}/versions/${version(v.version)}/content`,
            undefined,
            true,
          ),
          pkg,
        )
      )
        return confirm(id, v.version);
    }
    if (state?.status === "dispatching")
      throw new Error(
        "Previous Skill upload still unconfirmed; no second upload sent",
      );
  } else if (state?.status === "dispatching")
    throw new Error(
      "Previous Skill creation still unconfirmed; no second create sent",
    );
  journal.skill = {
    status: "dispatching",
    id: id ?? null,
    fingerprint: pkg.fingerprint,
  };
  await persist();
  let result;
  try {
    result = await client.request(
      id ? `/skills/${id}/versions` : "/skills",
      skillForm(pkg, !id),
    );
  } catch (e) {
    if (e.uncertain === false) {
      journal.skill.status = "rejected";
      await persist();
    }
    throw e;
  }
  id = id ?? result.id;
  const v = result.version ?? result.latest_version;
  // Save returned identifiers before any readback; GET failure never discards the receipt.
  journal.skill = { ...journal.skill, id, version: v };
  await persist();
  return confirm(id, v);
}
