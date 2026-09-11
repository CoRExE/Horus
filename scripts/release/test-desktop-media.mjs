import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const targets = { win32: 'x86_64-pc-windows-msvc', linux: 'x86_64-unknown-linux-gnu' };
const target = targets[process.platform];
if (!target || process.arch !== 'x64' || process.env.TARGET !== target) throw new Error('Cible native x64 Windows/Linux requise.');
const root = resolve(import.meta.dirname, '../..');
const tauri = resolve(root, 'apps/HorusDesktop/src-tauri');
const extension = process.platform === 'win32' ? '.exe' : '';
const directory = resolve(tauri, 'target', target, 'debug/deps');
mkdirSync(directory, { recursive: true });
// The Rust test executable resolves its sidecar next to itself, just like the app.
// Fixtures were generated beforehand using the system FFmpeg with libx264.
copyFileSync(resolve(tauri, `binaries/horus-ffmpeg-${target}${extension}`), resolve(directory, `horus-ffmpeg${extension}`));
const result = spawnSync('cargo', ['test', '--locked', '--target', target, '--', '--include-ignored'], { cwd: tauri, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
