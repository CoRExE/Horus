import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("./.media-fixtures/", import.meta.url));
mkdirSync(directory, { recursive: true });
function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr);
}

// Generated colour bars and silent audio: no external media or network access.
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=10",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=44100:cl=stereo",
  "-t",
  "6",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "10",
  "-c:a",
  "aac",
  "-movflags",
  "+faststart",
  join(directory, "sample.mp4"),
]);
// .mpegts also prevents Vite from treating video segments as TypeScript sources.
ffmpeg([
  "-i",
  join(directory, "sample.mp4"),
  "-c",
  "copy",
  "-hls_time",
  "1",
  "-hls_list_size",
  "0",
  "-hls_segment_filename",
  join(directory, "segment%02d.mpegts"),
  join(directory, "sample.m3u8"),
]);
console.log(`Fixtures média générées dans ${directory}`);
