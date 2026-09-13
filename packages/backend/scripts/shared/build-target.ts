/**
 * The app is deployed on linux x64 (glibc), so builds target it by default:
 * `bun run build:instance` then produces the same artifact on every machine instead of
 * one that silently depends on whoever ran it.
 *
 * Override with BUILD_TARGET to pick any other Bun compile target, e.g.
 * `bun-linux-x64-musl` (Alpine) or `bun-linux-x64-baseline` (CPUs without
 * AVX2). Use `host` to compile for the current machine by setting `BUILD_TARGET=host`.
 *
 * Cross-compiling downloads a *released* Bun for the target platform, so the
 * version in `.bun-version` has to be one npm actually serves.
 */
export const DEFAULT_BUILD_TARGET = 'bun-linux-x64';

const buildTarget = process.env.BUILD_TARGET || DEFAULT_BUILD_TARGET;

/**
 * `undefined` means "let Bun pick the host platform".
 */
export const BACKEND_BUILD_TARGET =
  buildTarget === 'host' ? undefined : (buildTarget as Bun.Build.CompileTarget);
