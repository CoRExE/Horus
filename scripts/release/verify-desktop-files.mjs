import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyArchitecture(bytes, platform) {
  if (platform === 'windows') {
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Exécutable PE attendu.');
    const offset = bytes.readUInt32LE(0x3c);
    if (offset + 26 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' || bytes.readUInt16LE(offset + 4) !== 0x8664 || bytes.readUInt16LE(offset + 24) !== 0x20b) throw new Error('Exécutable PE x64 attendu.');
  } else if (platform === 'linux') {
    if (bytes.length < 64 || bytes.toString('hex', 0, 4) !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) throw new Error('Exécutable ELF x64 attendu.');
  } else {
    throw new Error('Plateforme inconnue.');
  }
}

function findFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findFiles(path) : entry.isFile() ? [path] : [];
  });
}

export function verifyDesktopFiles(platform, directory) {
  if ((platform === 'windows' ? 'win32' : platform) !== process.platform) throw new Error('La vérification doit tourner sur la plateforme native.');
  const root = resolve(import.meta.dirname, '../..');
  const config = JSON.parse(readFileSync(resolve(root, 'scripts/release/ffmpeg.json'), 'utf8'));
  const extension = platform === 'windows' ? '.exe' : '';
  const bin = platform === 'windows' ? directory : join(directory, 'usr/bin');
  const target = platform === 'windows' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const app = join(bin, `horus-desktop${extension}`);
  const ffmpeg = join(bin, `horus-ffmpeg${extension}`);
  for (const file of [app, ffmpeg]) verifyArchitecture(readFileSync(file), platform);
  for (const [installed, built] of [
    [app, `target/${target}/release/horus-desktop${extension}`],
    [ffmpeg, `binaries/horus-ffmpeg-${target}${extension}`],
  ]) {
    if (digest(installed) !== digest(resolve(root, 'apps/HorusDesktop/src-tauri', built))) throw new Error(`Binaire installé différent du build : ${installed}`);
  }
  const files = findFiles(directory);
  for (const name of ['COPYING.LGPLv2.1', 'LICENSE.md', 'BUILD-LICENSE.txt', 'NOTICE.txt', 'config.log', 'build-ffmpeg.sh', 'verify-ffmpeg.sh', 'ffmpeg.json', `ffmpeg-${config.version}.tar.xz`]) {
    const matches = files.filter((file) => file.replaceAll('\\', '/').endsWith(`/licenses/ffmpeg/${name}`));
    if (matches.length !== 1) throw new Error(`Source/licence absente ou ambiguë : ${name}`);
    if (name.endsWith('.tar.xz') && digest(matches[0]) !== config.sha256) throw new Error('Archive source FFmpeg altérée.');
  }
  const env = { ...process.env };
  // Exclude MSYS2/Homebrew and other development tools from the runtime lookup.
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
  env.PATH = platform === 'windows' ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : '/usr/bin:/bin';
  const output = execFileSync(ffmpeg, ['-version'], { env, encoding: 'utf8', timeout: 30_000 });
  if (!output.startsWith(`ffmpeg version ${config.version} `)) throw new Error('Version FFmpeg inattendue.');
  console.log(`Installateur ${platform} : binaires x64 identiques au build, sources/licences vérifiées et FFmpeg autonome exécutable.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyDesktopFiles(process.argv[2], resolve(process.argv[3]));
}
