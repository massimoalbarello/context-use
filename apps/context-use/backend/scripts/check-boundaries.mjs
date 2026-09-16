import assert from 'node:assert/strict';
import { cruise } from 'dependency-cruiser';
import config from '../dependency-cruiser.config.mjs';

const { output } = await cruise([process.argv[2] ?? 'apps/context-use/backend/src'], {
  ...config.options,
  ruleSet: config,
  validate: true,
  outputType: 'json',
});
const result = JSON.parse(output);
assert.ok(
  result.modules.length > 0,
  'Backend dependency check scanned no modules; check TypeScript resolution.',
);
for (const violation of result.summary.violations) {
  console.error(`${violation.rule.name}: ${violation.from} → ${violation.to}`);
}
console.log(`Checked ${result.modules.length} modules; ${result.summary.error} errors.`);
process.exitCode = result.summary.error > 0 ? 1 : 0;
