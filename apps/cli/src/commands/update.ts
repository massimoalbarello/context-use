import { defineCommand } from "@parshjs/core";
import { updateDeployment } from "../update.ts";

/**
 * Compatibility shim for the release that introduced the `cloud` namespace.
 *
 * A CLI installed before that release finishes `update` by downloading the new
 * binary and spawning it as `context-use update`, so the new binary has to keep
 * answering that exact invocation. Releases from v0.1.69 onward spawn
 * `context-use cloud update` instead, so this command can be deleted once no
 * installation older than v0.1.69 remains. Only the continuation is accepted;
 * a person typing `context-use update` is sent to the namespaced command.
 */
export const command = defineCommand("update", {
  description: "Deprecated alias for `context-use cloud update`.",
  hidden: true,
  options: {},
  handler: async () => {
    if (process.env.CONTEXT_USE_UPDATE_CONTINUATION !== "1") {
      throw new Error("`context-use update` was replaced by `context-use cloud update`");
    }
    await updateDeployment();
  },
});
