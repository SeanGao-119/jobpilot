import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const host = valueAfter("--host", valueAfter("--hostname", "127.0.0.1"));
const port = valueAfter("--port", "3000");
const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
const repositoryRoot = path.resolve(process.cwd(), "../..");
const child = spawn(process.execPath, [nextBin, "dev", "--hostname", host, "--port", port], {
  stdio: "inherit",
  env: { ...process.env, JOBPILOT_REPOSITORY_ROOT: process.env.JOBPILOT_REPOSITORY_ROOT?.trim() || repositoryRoot },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
