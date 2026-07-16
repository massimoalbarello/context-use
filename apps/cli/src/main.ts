#!/usr/bin/env bun

import { createCli } from "@parshjs/core";
import { commandTree } from "./command-tree.gen.ts";
import { currentVersion } from "./release.ts";

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

await cli.main();
