#!/usr/bin/env bun

import { createCli } from "@parshjs/core";
import { commandTree } from "./command-tree.gen.ts";
import { currentVersion } from "./release.ts";
import { normalizeUpdateInvocation } from "./update-continuation.ts";

const cli = createCli({
  programName: "context-use",
  programDescription: "Deploy and maintain a private context-use knowledge base.",
  version: currentVersion,
  tree: commandTree,
});

declare module "@parshjs/core" {
  interface Register {
    cli: typeof cli;
  }
}

const invocation = normalizeUpdateInvocation(process.argv.slice(2), currentVersion);
if (invocation.continuation) process.env.CONTEXT_USE_UPDATE_CONTINUATION = "1";
process.exit(await cli.run(invocation.argv));
