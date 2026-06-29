// ffmpeg helpers. The workflow downloads the video to local disk first and passes
// a local path here (the static ffmpeg build segfaults on https/ranged reads), so
// `source` is normally a local file. Every spawn has a wall-clock timeout: a hung
// ffmpeg is SIGKILLed and the call rejects, so the step fails fast and retries
// instead of hanging the whole workflow forever.
import { spawn } from "child_process";
import { SILENCE_NOISE_DB, SILENCE_MIN_SECS, type SilentWindow } from "./types";

// Resolve the ffmpeg-static binary with Node's REAL runtime require (not the
// bundler's), so it survives webpack/esbuild step bundling. Cached after first use.
let _ffmpeg: string | null = null;
function ffmpeg(): string {
  if (_ffmpeg) return _ffmpeg;
  const nodeRequire = eval("require") as NodeRequire;
  const path: string = nodeRequire("ffmpeg-static");
  try {
    nodeRequire("fs").chmodSync(path, 0o755); // Vercel can strip +x
  } catch {
    /* non-fatal */
  }
  _ffmpeg = path;
  return path;
}

// Run ffmpeg with a hard timeout. Resolves with the exit code + captured stderr;
// rejects only on spawn error or timeout (so callers decide what a non-zero code means).
function runFfmpeg(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg(), args);
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms: ${args.join(" ").slice(0, 80)}`));
    }, timeoutMs);
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code, stderr }); });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function probeDuration(source: string): Promise<number> {
  try {
    // `ffmpeg -i <file>` prints Duration to stderr and exits IMMEDIATELY (with a
    // non-zero code, since no output file is given) — it reads container metadata
    // without decoding. Do NOT add `-f null -` here: that decodes the entire video,
    // which takes minutes on a long video and times out in a serverless function,
    // returning 0 and silently breaking the whole pipeline.
    const { stderr } = await runFfmpeg(["-i", source], 60_000);
    const m = stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
    if (!m) return 0;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch {
    return 0;
  }
}

// Extract [start, start+dur] of audio → 16kHz mono 32k MP3 (timestamps reset to 0).
export async function extractAudioSlice(
  source: string,
  start: number,
  dur: number,
  outputPath: string,
): Promise<void> {
  const { code } = await runFfmpeg(
    ["-y", "-ss", String(start), "-t", String(dur), "-i", source,
      "-vn", "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k", outputPath],
    240_000,
  );
  if (code !== 0) throw new Error(`ffmpeg audio slice exit ${code}`);
}

export async function extractFrameAt(source: string, time: number, outputPath: string): Promise<void> {
  const { code } = await runFfmpeg(
    ["-y", "-ss", String(time), "-i", source, "-vframes", "1", "-q:v", "2", outputPath],
    60_000,
  );
  if (code !== 0) throw new Error(`ffmpeg frame exit ${code}`);
}

// Run silencedetect over an audio file and return the silent windows it found.
export async function detectSilentWindows(audioPath: string): Promise<SilentWindow[]> {
  let stderr: string;
  try {
    ({ stderr } = await runFfmpeg(
      ["-i", audioPath, "-af", `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SECS}`, "-f", "null", "-"],
      180_000,
    ));
  } catch {
    return [];
  }
  const windows: SilentWindow[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) pendingStart = parseFloat(s[1]);
    if (e && pendingStart !== null) {
      windows.push({ start: pendingStart, end: parseFloat(e[1]) });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) windows.push({ start: pendingStart, end: null });
  return windows;
}
