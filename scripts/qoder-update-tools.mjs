// Compatibility entry point. Use one publisher so tool updates cannot drop native Skills.
if (!process.argv.includes("--update-agent"))
  process.argv.push("--update-agent");
await import("./qoder-setup.mjs");
