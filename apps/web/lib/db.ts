import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
const host = process.env.DB_HOST;
const port = Number(process.env.DB_PORT || 5432);
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
  if (host && username && password) {
    return postgres({
      host,
      port,
      database,
      username,
      password,
      ...sharedOptions,
    });
  }

  if (connectionString) {
    return postgres(connectionString, sharedOptions);
  }

  throw new Error(
    "Database configuration is required. Set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD.",
  );
}

export const sql = createSqlClient();
