import { readdir, readFile, writeFile } from "node:fs/promises";
import { zipSync, unzipSync } from "fflate";
import { loadStyleSkill } from "../packages/qoder/skill-publisher.mjs";
const pkg = await loadStyleSkill();
const fixed = { mtime: new Date("2026-01-01T00:00:00Z"), level: 6 };
const encode = (files) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, b]) => [p, [b, fixed]]),
    ),
  );
const dev = {};
async function collect(directory = "") {
  for (const e of await readdir("skills/qoder-cloud-agent/" + directory, {
    withFileTypes: true,
  })) {
    const relative = directory + e.name;
    if (e.isDirectory()) await collect(relative + "/");
    else if (
      e.isFile() &&
      /^(SKILL\.md|agents\/openai\.yaml|references\/[^/]+\.md|assets\/[^/]+\.json|scripts\/[^/]+\.mjs)$/.test(
        relative,
      )
    )
      dev["qoder-cloud-agent/" + relative] = await readFile(
        "skills/qoder-cloud-agent/" + relative,
      );
    else throw new Error("Unexpected developer Skill file: " + relative);
  }
}
await collect();
await writeFile("public/downloads/qoder-cloud-agent-skill.zip", encode(dev));
await writeFile(
  "public/downloads/muse-style-discovery-skill.zip",
  encode(Object.fromEntries(pkg.files.map((f) => [f.path, f.bytes]))),
);
const kit = unzipSync(
  await readFile("public/downloads/muse-developer-kit-v1.zip"),
);
for (const key of Object.keys(kit))
  if (key.startsWith("skills/qoder-cloud-agent/")) delete kit[key];
for (const [key, value] of Object.entries(dev)) kit["skills/" + key] = value;
await writeFile("public/downloads/muse-developer-kit-v1.zip", encode(kit));
console.log(
  "Packaged developer Qoder Skill, native MUSE Skill, and updated developer-kit Skill reference; no credentials read.",
);
