import test from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../packages/domain/config.mjs";

test("production stays blocked unless the dedicated protected-demo entry opts in", () => {
  const env = {
    NODE_ENV: "production",
    SESSION_SECRET: "test-session-secret-at-least-24-characters",
  };
  assert.throws(() => configFromEnv(env), /OIDC/);
  assert.throws(
    () =>
      configFromEnv({
        ...env,
        APP_MODE: "team_demo",
        DEMO_PASSWORD: "test-password-at-least-24-characters",
      }),
    /OIDC/,
  );
  assert.throws(
    () =>
      configFromEnv({ ...env, APP_MODE: "team_demo" }, { allowTeamDemo: true }),
    /DEMO_PASSWORD/,
  );
  assert.throws(
    () =>
      configFromEnv(
        {
          ...env,
          APP_MODE: "team_demo",
          DEMO_PASSWORD: "test-password-at-least-24-characters",
          API_HOST: "0.0.0.0",
        },
        { allowTeamDemo: true },
      ),
    /127.0.0.1/,
  );
  const demo = configFromEnv(
    {
      ...env,
      APP_MODE: "team_demo",
      DEMO_PASSWORD: "test-password-at-least-24-characters",
    },
    { allowTeamDemo: true },
  );
  assert.equal(demo.teamDemo, true);
  assert.equal(demo.devAuth, true);
  assert.equal(demo.production, true);
  assert.equal(demo.host, "127.0.0.1");
});
