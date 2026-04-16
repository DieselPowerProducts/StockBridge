import { spawn } from "node:child_process";

const commands = [
  {
    name: "api",
    command: process.execPath,
    args: ["api/dev-server.js"]
  },
  {
    name: "web",
    command: process.execPath,
    args: ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"]
  }
];

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("="))
);

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (data) => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on("exit", (code) => {
    if (code && process.exitCode === undefined) {
      process.exitCode = code;
      stop();
    }
  });

  return child;
});

function stop() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit();
});

process.on("SIGTERM", () => {
  stop();
  process.exit();
});
