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

if (host && username && password) {
  export const sql = postgres({
    host,
    port,
    database,
    username,
    password,
    ...sharedOptions,
  });
} else if (connectionString) {
  export const sql = postgres(connectionString, sharedOptions);
} else {
  throw new Error(
    "Database configuration is required. Set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD.",
  );
}
