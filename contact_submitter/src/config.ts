export const cfg = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  stream: process.env.REDIS_STREAM ?? "contact:submit:jobs",
  group: process.env.REDIS_GROUP ?? "worker-g1",
  consumer: `c-${process.pid}`,
  concurrency: Number(process.env.CONCURRENCY ?? 2),      // 全体並列
  perDomainParallel: Number(process.env.PER_DOMAIN_PARALLEL ?? 1), // 同一ドメイン直列
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
  findTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30000),
  screenshotDir: process.env.SCREENSHOT_DIR ?? "/tmp/evidence",
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  verbose: process.env.VERBOSE === "1" || process.env.VERBOSE === "true"
};
