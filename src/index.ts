#!/usr/bin/env node
import { cliMode, HELP, tokenOnArgv, wantsHelp } from "./cli.js";
import { runHttp } from "./transport/http.js";
import { runStdio } from "./transport/stdio.js";

const argv = process.argv.slice(2);
if (wantsHelp(argv)) {
  process.stderr.write(HELP);
  process.exit(0);
}
if (tokenOnArgv(argv)) {
  process.stderr.write(
    "Refuse to read the app-specific password from argv. Set ICLOUD_APP_PASSWORD or use OAuth login.\n"
  );
  process.exit(2);
}

try {
  if (cliMode(argv) === "http") {
    const server = await runHttp();
    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    await runStdio();
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
