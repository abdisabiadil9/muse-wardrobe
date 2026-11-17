import { spawn } from "node:child_process";
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { configFromEnv } from "../packages/domain/config.mjs";
import { createPool, migrate } from "../packages/db/index.mjs";
import { createApp } from "../apps/api/app.mjs";
import { createDemoGateway } from "../server/demo-gateway.mjs";

// A separate entry point: public traffic can only reach the password gateway.
if (process.env.APP_MODE !== "team_demo")
  throw new Error("Set APP_MODE=team_demo for the protected demo launcher");
if (!process.env.DATABASE_URL || !process.env.MEDIA_ROOT)
  throw new Error("DATABASE_URL and persistent MEDIA_ROOT are required");
const origin =
  process.env.APP_ORIGIN ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "");
if (
  !origin ||
  new URL(origin).protocol !== "https:" ||
  new URL(origin).origin !== origin
)
  throw new Error(
    "Set APP_ORIGIN to the exact HTTPS public origin (no trailing slash), or generate a Railway domain",
  );
const env = {
  ...process.env,
  APP_ORIGIN: origin,
  APP_ORIGINS: origin,
  API_HOST: "127.0.0.1",
};
const config = configFromEnv(env, { allowTeamDemo: true });
const port = Number(env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === config.port)
  throw new Error("Invalid PORT or PORT conflicts with internal API port");
await access("dist/index.html");
await mkdir(config.mediaRoot, { recursive: true });
const probe = resolve(config.mediaRoot, `.write-check-${process.pid}`);
await writeFile(probe, "ok", { mode: 0o600 });
await unlink(probe);
const pool = createPool(config.databaseUrl);
let api,
  gateway,
  worker,
  stopping = false,
  ready = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  process.exitCode = code;
  gateway?.close();
  gateway?.closeAllConnections();
  worker?.kill("SIGTERM");
  const timer = setTimeout(() => {
    worker?.kill("SIGKILL");
    process.exit(code);
  }, 20_000);
  timer.unref();
  await api?.close().catch(() => {});
  await pool.end().catch(() => {});
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
try {
  await migrate(pool);
  api = await createApp({ pool, ...config });
  await api.listen({ host: "127.0.0.1", port: config.port });
  worker = spawn(process.execPath, ["apps/worker/main.mjs"], {
    env,
    stdio: "inherit",
  });
  worker.on("error", () => {
    console.error("Worker failed to start");
    void stop(1);
  });
  worker.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `Worker exited (${code}); restarting the service is required`,
      );
      void stop(1);
    }
  });
  gateway = createDemoGateway({
    password: env.DEMO_PASSWORD,
    dist: resolve("dist"),
    upstream: `http://127.0.0.1:${config.port}`,
    upstreamOrigin: origin,
    getOrigin: () => origin,
    health: async () => {
      if (
        !ready ||
        stopping ||
        worker.exitCode !== null ||
        worker.signalCode !== null
      )
        return false;
      const response = await fetch(`http://127.0.0.1:${config.port}/healthz`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    },
  });
  await new Promise((done, reject) => {
    gateway.once("error", reject);
    gateway.listen(port, "0.0.0.0", done);
  });
  ready = true;
  console.log(
    `MUSE team demo listening on port ${port}. API is loopback-only; Worker active; access password required.`,
  );
} catch (error) {
  // Do not include database URLs or provider responses in startup logs.
  console.error(
    `Team demo startup failed (${error.code || error.name}); check configuration, database and volume.`,
  );
  await stop(1);
}
