/** biome-ignore-all lint/complexity/useMaxParams: Node module hooks use positional arguments. */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// The npm helper uses the installed host's SDK, including after our plugin is gone.
const hostSdkAnchor = process.env.CONTEXT_USE_OPENCLAW_SDK;
if (!hostSdkAnchor) {
  throw new Error('OpenClaw SDK location was not provided.');
}
const parentURL = pathToFileURL(hostSdkAnchor).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('openclaw/plugin-sdk/')) {
      return nextResolve(specifier, { ...context, parentURL });
    }
    return nextResolve(specifier, context);
  },
});
