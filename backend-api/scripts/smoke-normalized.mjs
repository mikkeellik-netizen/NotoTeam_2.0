process.env.SMOKE_WORKSPACE_STORAGE = "sqlite";
process.env.SMOKE_WORKSPACE_NORMALIZED_TABLES = "primary";

await import("./smoke-api.mjs");
