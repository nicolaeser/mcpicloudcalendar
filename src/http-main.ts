#!/usr/bin/env node
import { HELP, tokenOnArgv, wantsHelp } from "./cli.js";
import { runHttp } from "./transport/http.js";

const argv = process.argv.slice(2);
if (wantsHelp(argv)) {
  process.stderr.write(HELP);
  process.exit(0);
}
if (tokenOnArgv(argv)) {
  process.stderr.write("Refuse to read the mailbox password from argv. Use OAuth login or Authorization.\n");
  process.exit(2);
}

const server = await runHttp();
const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
