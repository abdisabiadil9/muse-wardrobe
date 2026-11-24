import {
  readFile,
  writeFile,
  mkdir,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { agentDefinition, agentPatch } from "../packages/qoder/agent.mjs";
import { digest } from "../packages/db/index.mjs";
import {
  PublishClient,
  loadStyleSkill,
  publishStyleSkill,
} from "../packages/qoder/skill-publisher.mjs";

const execute = process.argv.includes("--execute"),
  updateAgent = process.argv.includes("--update-agent");
const pkg = await loadStyleSkill();
if (!execute) {
  console.log(
    JSON.stringify(
      {
        action:
          "Prepare native MUSE Skill, pin its immutable version in Agent.skills, then pin Agent/Environment in .env",
        update_existing_agent: updateAgent,
        skill: pkg.name,
        files: pkg.files.map((f) => f.path),
        fingerprint: pkg.fingerprint,
        execute: false,
        paid_turns: 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
try {
  process.loadEnvFile();
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!process.env.QODER_ACCESS_TOKEN)
  throw new Error("Configure QODER_ACCESS_TOKEN in server .env first");
await mkdir(".local", { recursive: true, mode: 0o700 });
// Serialise publication in this checkout. After a crash, inspect journal before removing a stale lock.
const lock = await open(".local/qoder-setup.lock", "wx", 0o600).catch(() => {
  throw new Error(
    "Publisher lock exists: inspect .local/qoder-setup.json and the owning process before removing a stale lock",
  );
});
await lock.writeFile(String(process.pid));
let journal = {};
async function atomic(path, data) {
  await writeFile(path + ".tmp", data, { mode: 0o600 });
  await rename(path + ".tmp", path);
}
const persist = () =>
  atomic(".local/qoder-setup.json", JSON.stringify(journal, null, 2));
const client = new PublishClient(process.env.QODER_ACCESS_TOKEN);
const unwrap = (x) => x.data ?? x;
async function findResource(kind, name, configuredId) {
  const prefix = kind === "agents" ? "agent_" : "env_";
  if (configuredId) {
    if (
      !configuredId.startsWith(prefix) ||
      !/^[A-Za-z0-9_-]+$/.test(configuredId)
    )
      throw new Error(`Invalid ${kind} id`);
    return unwrap(await client.request(`/${kind}/${configuredId}`));
  }
  const matches = (await client.list("/" + kind)).filter(
    (x) => x.name === name,
  );
  if (matches.length > 1)
    throw new Error(`Multiple ${kind} named ${name}; configure an explicit id`);
  return matches[0]
    ? unwrap(await client.request(`/${kind}/${matches[0].id}`))
    : null;
}
async function createResource(kind, definition) {
  if (journal[kind]?.status === "dispatching")
    throw new Error(
      `Previous ${kind} create unconfirmed; reconcile before creating again`,
    );
  journal[kind] = { status: "dispatching", name: definition.name };
  await persist();
  let r;
  try {
    r = unwrap(await client.request("/" + kind, definition));
  } catch (e) {
    if (e.uncertain === false) {
      journal[kind].status = "rejected";
      await persist();
    }
    throw e;
  }
  if (!r.id)
    throw new Error(
      `${kind} response missing id; creation remains unconfirmed`,
    );
  journal[kind] = { status: "confirmed", id: r.id };
  await persist();
  return r;
}
try {
  try {
    journal = JSON.parse(await readFile(".local/qoder-setup.json", "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let agent = await findResource(
    "agents",
    "muse-stylist-v1",
    process.env.QODER_AGENT_ID || journal.agents?.id,
  );
  let binding;
  if (!agent || updateAgent) {
    const model = agent?.model ?? process.env.QODER_MODEL ?? "auto";
    if (!agent && !(await client.list("/models")).some((m) => m.id === model))
      throw new Error("Configured model is not available to this account");
    binding = await publishStyleSkill({
      client,
      pkg,
      journal,
      persist,
      configuredId: process.env.QODER_STYLE_SKILL_ID,
    });
    const definition = agentDefinition(model, { skillBinding: binding });
    if (!agent) agent = await createResource("agents", definition);
    const desired = agentPatch(agent, definition),
      fingerprint = digest(desired);
    const matches = (a) =>
      a.system === desired.system &&
      digest(a.tools) === digest(desired.tools) &&
      digest(a.skills ?? []) === digest(desired.skills);
    if (!matches(agent)) {
      if (journal.agentUpdate?.status === "dispatching")
        throw new Error(
          "Previous Agent update unconfirmed; compare remote system/tools/skills before publishing again",
        );
      await atomic(
        ".local/qoder-agent-before-update.json",
        JSON.stringify(agent, null, 2),
      );
      journal.agentUpdate = {
        status: "dispatching",
        id: agent.id,
        from_version: agent.version,
        fingerprint,
      };
      await persist();
      try {
        await client.request(`/agents/${agent.id}`, {
          version: agent.version,
          ...desired,
        });
      } catch (e) {
        if (e.uncertain === false) {
          journal.agentUpdate.status = "rejected";
          await persist();
        }
        throw e;
      }
    }
    agent = unwrap(await client.request(`/agents/${agent.id}`));
    if (!matches(agent))
      throw new Error(
        "Published Agent readback differs; local version not advanced",
      );
    journal.agentUpdate = {
      status: "confirmed",
      id: agent.id,
      version: agent.version,
      fingerprint,
    };
    await persist();
  }
  let environment = await findResource(
    "environments",
    "muse-local-dev",
    process.env.QODER_ENVIRONMENT_ID || journal.environments?.id,
  );
  if (!environment)
    environment = await createResource("environments", {
      name: "muse-local-dev",
      config: { type: "cloud" },
    });
  if (!Number.isInteger(agent.version) || agent.version < 1)
    throw new Error("Invalid Agent version");
  journal.agents = { status: "confirmed", id: agent.id };
  journal.environments = { status: "confirmed", id: environment.id };
  await persist();
  const updates = {
    QODER_AGENT_ID: agent.id,
    QODER_AGENT_VERSION: String(agent.version),
    QODER_ENVIRONMENT_ID: environment.id,
    ...(binding
      ? {
          QODER_STYLE_SKILL_ID: binding.skill_id,
          QODER_STYLE_SKILL_VERSION: binding.version,
        }
      : {}),
  };
  let env = "";
  try {
    env = await readFile(".env", "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const lines = env
    .split("\n")
    .filter((l) => !Object.keys(updates).some((k) => l.startsWith(k + "=")));
  await atomic(
    ".env",
    lines.join("\n").trimEnd() +
      "\n" +
      Object.entries(updates)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n",
  );
  console.log(
    JSON.stringify({
      agent_id: agent.id,
      version: agent.version,
      environment_id: environment.id,
      skill: binding ?? null,
      status: binding ? "native_skill_verified" : "existing_agent_reused",
      note: binding
        ? "New sessions use the pinned skill; sync QODER_AGENT_VERSION in the application deployment."
        : "Use --update-agent to publish native Skills into an existing Agent.",
      paid_turns: 0,
    }),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(".local/qoder-setup.lock");
}
