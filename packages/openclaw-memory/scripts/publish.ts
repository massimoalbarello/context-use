import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import semver from 'semver';
import metadata from '../package.json';
import { hasPublishedChanges } from './release-contents';

function publishedPackage(spec: string): { version: string; 'dist.integrity': string } | null {
  const result = spawnSync('npm', ['view', spec, 'version', 'dist.integrity', '--json'], {
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  const output = JSON.parse(result.stdout);
  if (result.status === 0) {
    return output;
  }
  if (output.error?.code === 'E404') {
    return null;
  }
  throw new Error(`npm view ${spec} failed: ${result.stderr}`);
}

// The workflow serializes publishers so the tag cannot change between this check and publication.
async function publishArtifact(artifactPath: string): Promise<boolean> {
  const artifact = resolve(artifactPath);
  const pkg = JSON.parse(
    execFileSync('tar', ['-xOf', artifact, 'package/package.json'], { encoding: 'utf8' }),
  );
  assert.equal(pkg.name, metadata.name);
  assert.ok(semver.valid(pkg.version), 'The artifact must have a valid version');
  const integrity = `sha512-${createHash('sha512').update(readFileSync(artifact)).digest('base64')}`;
  const spec = `${pkg.name}@${pkg.version}`;
  const existing = publishedPackage(spec);
  if (existing) {
    assert.equal(
      existing['dist.integrity'],
      integrity,
      `${spec} already exists with different contents`,
    );
    console.log(`${spec} is already published with the verified contents.`);
    return true;
  }

  const { tag, access } = metadata.publishConfig;
  const current = publishedPackage(`${pkg.name}@${tag}`);
  if (current && semver.gt(current.version, pkg.version)) {
    console.log(`Skipping ${spec}: ${tag} already points to newer version ${current.version}.`);
    return false;
  }
  if (
    current &&
    !(await hasPublishedChanges({
      spec: `${pkg.name}@${current.version}`,
      version: current.version,
    }))
  ) {
    console.log(`Skipping ${spec}: packaged contents are unchanged from ${current.version}.`);
    return false;
  }
  execFileSync('npm', ['publish', artifact, '--tag', tag, '--access', access, '--ignore-scripts'], {
    stdio: 'inherit',
  });
  return true;
}

if (import.meta.main) {
  const artifact = process.argv[2];
  assert.ok(artifact, 'Pass the verified package tarball');
  const published = await publishArtifact(artifact);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
  }
}
