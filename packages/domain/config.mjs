export function configFromEnv(env, { allowTeamDemo = false } = {}) {
  const production = env.NODE_ENV === "production";
  const teamDemo = allowTeamDemo && env.APP_MODE === "team_demo";
  if (teamDemo && (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < 24))
    throw new Error(
      "Team demo requires DEMO_PASSWORD of at least 24 characters",
    );
  if (teamDemo && env.API_HOST && env.API_HOST !== "127.0.0.1")
    throw new Error("Team demo API must bind to 127.0.0.1");
  const config = {
    production,
    teamDemo,
    devAuth: teamDemo || (!production && env.DEV_AUTH_ENABLED !== "false"),
    appOrigin: env.APP_ORIGIN ?? "http://localhost:5179",
    sessionSecret: env.SESSION_SECRET,
    mediaRoot: env.MEDIA_ROOT ?? ".local/media",
    databaseUrl:
      env.DATABASE_URL ?? "postgres://muse:muse_local_dev@127.0.0.1:55432/muse",
    host: env.API_HOST ?? "127.0.0.1",
    port: Number(env.API_PORT ?? 8787),
    qoderToken: env.QODER_ACCESS_TOKEN ?? env.QODER_PAT,
    agentId: env.QODER_AGENT_ID,
    agentVersion: Number(env.QODER_AGENT_VERSION ?? 1),
    environmentId: env.QODER_ENVIRONMENT_ID,
    maxCreditCost: env.QODER_MAX_CREDIT_COST ?? "1.00",
    arkKey: env.ARK_API_KEY,
    arkModel: env.ARK_IMAGE_MODEL ?? "doubao-seedream-5-5-261028",
    memoryEnabled: env.MEMORY_ENABLED === "true",
    dreamEnabled: env.DREAM_ENABLED === "true",
    dailyTaskLimit: Number(env.DAILY_TASK_LIMIT ?? 50),
    everyinfraKey: env.EVERYINFRA_API_KEY,
    inspirationSearchLimit: Number(env.EVERYINFRA_MONTHLY_SEARCH_LIMIT ?? 1000),
    inspirationNoteLimit: Number(env.EVERYINFRA_MONTHLY_NOTE_LIMIT ?? 200),
    inspirationDailyLimit: Number(env.EVERYINFRA_DAILY_USER_LIMIT ?? 20),
    productSearchLimit: Number(env.EVERYINFRA_MONTHLY_TAOBAO_SEARCH_LIMIT ?? 100),
  };
  config.appOrigins = [
    ...new Set([
      config.appOrigin,
      ...(env.APP_ORIGINS ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ]),
  ];
  config.inspirationEnabled = Boolean(config.everyinfraKey);
  for (const key of [
    "inspirationSearchLimit",
    "inspirationNoteLimit",
    "inspirationDailyLimit",
    "productSearchLimit",
  ])
    if (!Number.isInteger(config[key]) || config[key] < 0)
      throw new Error(`${key} must be a non-negative integer`);
  config.stylingEnabled = Boolean(
    config.qoderToken && config.agentId && config.environmentId,
  );
  config.tryonEnabled =
    env.TRYON_ENABLED === "true" && Boolean(config.arkKey && config.arkModel);
  if (!config.sessionSecret || config.sessionSecret.length < 24)
    throw new Error("SESSION_SECRET must contain at least 24 characters");
  if (production && !teamDemo)
    throw new Error(
      "This development release needs an OIDC provider and production object storage before public deployment",
    );
  return config;
}
