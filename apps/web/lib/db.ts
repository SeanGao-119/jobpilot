import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
const host = process.env.DB_HOST;
const rawPort = process.env.DB_PORT;
const database = process.env.DB_NAME || "postgres";
const username = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

const sharedOptions = {
  ssl: "require" as const,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
};

function createSqlClient() {
  const splitConfigTouched = Boolean(host || rawPort || process.env.DB_NAME || username || password);

  if (splitConfigTouched) {
    const missing = [
      ["DB_HOST", host],
      ["DB_USER", username],
      ["DB_PASSWORD", password],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Incomplete DB_* configuration. Missing: ${missing.join(", ")}`);
    }

    const port = Number(rawPort || 5432);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("DB_PORT must be a valid positive integer");
    }

    return postgres({
      host: host!,
      port,
      database,
      username: username!,
      password: password!,
      ...sharedOptions,
    });
  }

  if (connectionString) {
    return postgres(connectionString, sharedOptions);
  }

  throw new Error(
    "Database configuration is required. Prefer DB_HOST/DB_USER/DB_PASSWORD (plus optional DB_PORT/DB_NAME), or set DATABASE_URL.",
  );
}

export const sql = createSqlClient();
