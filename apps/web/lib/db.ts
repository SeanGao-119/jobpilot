import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for JobPilot dashboard");
}

export const sql = postgres(connectionString, {
  ssl: "require",
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
