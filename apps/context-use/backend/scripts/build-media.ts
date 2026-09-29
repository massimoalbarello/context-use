import { chmod, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaEngineDirectory } from './shared/build-assets';
import { BACKEND_BUILD_TARGET } from './shared/build-target';

const host = Bun.argv.includes('--host') || !BACKEND_BUILD_TARGET;
const destination = mediaEngineDirectory({ host });
const release = 'autobuild-2026-08-31-13-27';
const archiveName = 'ffmpeg-n9.0.1-11-ge47273f4d9-linux64-lgpl-9.0';
const checksum = '204fc02692b11249c3e688ad18538ce2939129a1fc6abc32a6b2638a024496cf';
const executableMode = 0o700;

await mkdir(destination, { recursive: true });
if (host) {
  const ffmpeg = Bun.which('ffmpeg');
  if (!ffmpeg) {
    throw new Error('Install FFmpeg with libwebp support and put it on PATH (macOS: ffmpeg-full).');
  }
  const encoders = Bun.spawn([ffmpeg, '-hide_banner', '-encoders'], { stderr: 'ignore' });
  const output = await new Response(encoders.stdout).text();
  if ((await encoders.exited) !== 0 || !output.includes('libwebp')) {
    throw new Error('FFmpeg needs libwebp support. On macOS, put ffmpeg-full/bin on PATH.');
  }
  await cp(ffmpeg, join(destination, 'ffmpeg'));
  const license = Bun.spawn([ffmpeg, '-L'], { stderr: 'ignore' });
  await Bun.write(join(destination, 'LICENSE'), await new Response(license.stdout).text());
  if ((await license.exited) !== 0) {
    throw new Error('Could not read the installed FFmpeg license.');
  }
} else {
  if (
    !BACKEND_BUILD_TARGET!.startsWith('bun-linux-x64') ||
    BACKEND_BUILD_TARGET!.includes('musl')
  ) {
    throw new Error('Media previews require Linux x64 with glibc or BUILD_TARGET=host.');
  }
  const temporary = await mkdtemp(join(tmpdir(), 'context-use-ffmpeg-'));
  try {
    const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release}/${archiveName}.tar.xz`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FFmpeg download failed: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== checksum) {
      throw new Error('FFmpeg download checksum mismatch.');
    }
    const archive = join(temporary, 'ffmpeg.tar.xz');
    await Bun.write(archive, bytes);
    const extract = Bun.spawn(
      [
        'tar',
        '-xf',
        archive,
        '-C',
        temporary,
        `${archiveName}/bin/ffmpeg`,
        `${archiveName}/LICENSE.txt`,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if ((await extract.exited) !== 0) {
      throw new Error('Could not extract FFmpeg.');
    }
    await cp(join(temporary, archiveName, 'bin/ffmpeg'), join(destination, 'ffmpeg'));
    await cp(join(temporary, archiveName, 'LICENSE.txt'), join(destination, 'LICENSE'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
await chmod(join(destination, 'ffmpeg'), executableMode);
