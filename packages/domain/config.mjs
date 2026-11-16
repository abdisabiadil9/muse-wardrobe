export function configFromEnv(env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    production,
    devAuth: !production && env.DEV_AUTH_ENABLED !== 'false',
    appOrigin: env.APP_ORIGIN ?? 'http://localhost:5179',
    sessionSecret: env.SESSION_SECRET,
    mediaRoot: env.MEDIA_ROOT ?? '.local/media',
    databaseUrl:
      env.DATABASE_URL ?? 'postgres://muse:muse_local_dev@127.0.0.1:55432/muse',
    host: env.API_HOST ?? '127.0.0.1',
    port: Number(env.API_PORT ?? 8787),
    qoderToken: env.QODER_ACCESS_TOKEN ?? env.QODER_PAT,
    agentId: env.QODER_AGENT_ID,
    agentVersion: Number(env.QODER_AGENT_VERSION ?? 1),
    environmentId: env.QODER_ENVIRONMENT_ID,
    maxCreditCost: env.QODER_MAX_CREDIT_COST ?? '1.00',
    arkKey: env.ARK_API_KEY,
    arkModel: env.ARK_IMAGE_MODEL ?? 'doubao-seedream-5-5-261028',
    memoryEnabled: env.MEMORY_ENABLED === 'true',
    dreamEnabled: env.DREAM_ENABLED === 'true',
    dailyTaskLimit: Number(env.DAILY_TASK_LIMIT ?? 50),
  };
  config.appOrigins = [
    ...new Set([
      config.appOrigin,
      ...(env.APP_ORIGINS ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ]),
  ];
  config.stylingEnabled = Boolean(
    config.qoderToken && config.agentId && config.environmentId,
  );
  config.tryonEnabled =
    env.TRYON_ENABLED === 'true' && Boolean(config.arkKey && config.arkModel);
  if (!config.sessionSecret || config.sessionSecret.length < 24)
    throw new Error('SESSION_SECRET must contain at least 24 characters');
  if (production)
    throw new Error(
      'This development release needs an OIDC provider and production object storage before public deployment',
    );
  return config;
}
