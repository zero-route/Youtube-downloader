import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { encodeFilename } from "@/lib/filename";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const CHUNK_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 4;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export class MediaError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertHttp(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new MediaError("URL media tidak valid.", 400);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new MediaError("URL media tidak valid.", 400);
  }

  return url;
}

function mediaHeaders(extra: Record<string, string> = {}) {
  return {
    Accept: "*/*",
    "User-Agent": USER_AGENT,
    Referer: "https://www.youtube.com/",
    Origin: "https://www.youtube.com",
    ...extra,
  };
}

type Deadline = { at: number };

function remaining(deadline: Deadline) {
  return deadline.at - Date.now();
}

async function fetchRange(
  url: URL,
  start: number,
  end: number,
  deadline: Deadline
) {
  let lastError = "Gagal mengambil media.";

  for (let attempt = 1; attempt <= 3; attempt++) {
    const left = remaining(deadline);

    if (left < 2000) {
      throw new MediaError("Waktu proses habis saat mengunduh media.", 504);
    }

    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
        headers: mediaHeaders({ Range: `bytes=${start}-${end}` }),
        signal: AbortSignal.timeout(Math.min(25_000, left)),
      });

      if (response.status === 206 || response.status === 200) {
        const buffer = Buffer.from(await response.arrayBuffer());

        if (buffer.length > 0) {
          return { response, buffer };
        }

        lastError = "Potongan media kosong.";
      } else {
        lastError = `Server media HTTP ${response.status}`;
        await response.body?.cancel().catch(() => undefined);

        if (response.status === 403 || response.status === 404) {
          if (attempt >= 2) break;
        }
      }
    } catch (error) {
      if (error instanceof MediaError) throw error;

      lastError = error instanceof Error ? error.message : lastError;
    }

    await sleep(400 * attempt);
  }

  throw new MediaError(lastError);
}

function totalFromRange(header: string | null) {
  const match = header?.match(/\/(\d+)\s*$/);

  return match ? Number(match[1]) : null;
}

export async function fetchToFile(
  rawUrl: string,
  dest: string,
  maxBytes: number,
  deadline: Deadline
) {
  const url = assertHttp(rawUrl);

  const first = await fetchRange(url, 0, CHUNK_BYTES - 1, deadline);

  const handle = await open(dest, "w");

  try {
    if (first.response.status === 200) {
      if (first.buffer.length > maxBytes) {
        throw new MediaError("Ukuran media melebihi batas.", 413);
      }

      await handle.write(first.buffer, 0, first.buffer.length, 0);

      const declared = Number(first.response.headers.get("content-length") || 0);

      if (declared > first.buffer.length) {
        throw new MediaError("Server media tidak mendukung unduhan bertahap.");
      }

      return first.buffer.length;
    }

    const total = totalFromRange(first.response.headers.get("content-range"));

    if (total === null || total <= 0) {
      throw new MediaError("Ukuran media tidak diketahui.");
    }

    if (total > maxBytes) {
      throw new MediaError("Ukuran media melebihi batas.", 413);
    }

    await handle.write(first.buffer, 0, first.buffer.length, 0);

    const offsets: number[] = [];

    for (let start = first.buffer.length; start < total; start += CHUNK_BYTES) {
      offsets.push(start);
    }

    let cursor = 0;
    let failure: unknown = null;

    const worker = async () => {
      while (failure === null) {
        const index = cursor++;

        if (index >= offsets.length) return;

        const start = offsets[index];
        const end = Math.min(start + CHUNK_BYTES, total) - 1;

        try {
          const part = await fetchRange(url, start, end, deadline);

          if (part.response.status !== 206) {
            throw new MediaError("Server media tidak mendukung unduhan bertahap.");
          }

          await handle.write(part.buffer, 0, part.buffer.length, start);
        } catch (error) {
          failure = error;
          return;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker)
    );

    if (failure !== null) {
      throw failure;
    }

    return total;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function fetchSmall(rawUrl: string, maxBytes: number) {
  const url = assertHttp(rawUrl);

  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length < 512 || buffer.length > maxBytes) {
    throw new Error("Ukuran gambar tidak sesuai.");
  }

  return buffer;
}

function runFfmpeg(args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new MediaError("ffmpeg tidak tersedia di server.", 500));
      return;
    }

    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-6000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaError("Proses konversi melewati batas waktu.", 504));
    }, Math.max(timeoutMs, 1000));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new MediaError(`Konversi gagal: ${stderr.slice(-800)}`));
        return;
      }

      resolve();
    });
  });
}

export type Prepared = {
  file: string;
  dir: string;
  size: number;
  coverEmbedded: boolean;
};

export async function cleanup(dir: string) {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function muxMp4(input: {
  videoUrl: string;
  audioUrl: string;
  maxBytes: number;
  budgetMs: number;
}): Promise<Prepared> {
  const deadline: Deadline = { at: Date.now() + input.budgetMs };
  const dir = await mkdtemp(path.join(os.tmpdir(), "youtify-"));

  try {
    const videoPath = path.join(dir, "video.mp4");
    const audioPath = path.join(dir, "audio.m4a");
    const outPath = path.join(dir, "out.mp4");

    await Promise.all([
      fetchToFile(input.videoUrl, videoPath, input.maxBytes, deadline),
      fetchToFile(input.audioUrl, audioPath, 40 * 1024 * 1024, deadline),
    ]);

    await runFfmpeg(
      [
        "-hide_banner",
        "-nostats",
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
      ],
      remaining(deadline)
    );

    const info = await stat(outPath);

    if (info.size < 1024) {
      throw new MediaError("Hasil penggabungan kosong.");
    }

    return { file: outPath, dir, size: info.size, coverEmbedded: false };
  } catch (error) {
    await cleanup(dir);
    throw error;
  }
}

function mp3Args(
  audioPath: string,
  coverPath: string | null,
  outPath: string,
  meta: { title: string; artist: string | null; year: string | null; bitrate: number }
) {
  const args = ["-hide_banner", "-nostats", "-y", "-i", audioPath];

  if (coverPath) {
    args.push("-i", coverPath);
  }

  args.push("-map", "0:a:0");

  if (coverPath) {
    args.push(
      "-map",
      "1:v:0",
      "-c:v",
      "mjpeg",
      "-q:v",
      "3",
      "-pix_fmt",
      "yuvj420p",
      "-vf",
      "scale='min(1280,iw)':-2",
      "-disposition:v:0",
      "attached_pic",
      "-metadata:s:v",
      "title=Cover",
      "-metadata:s:v",
      "comment=Cover (front)"
    );
  }

  args.push(
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${meta.bitrate}k`,
    "-ar",
    "44100",
    "-id3v2_version",
    "3",
    "-write_id3v1",
    "1",
    "-metadata",
    `title=${meta.title}`
  );

  if (meta.artist) {
    args.push("-metadata", `artist=${meta.artist}`);
  }

  if (meta.year) {
    args.push("-metadata", `date=${meta.year}`);
  }

  args.push("-f", "mp3", outPath);

  return args;
}

export async function encodeMp3(input: {
  audioUrl: string;
  covers: string[];
  title: string;
  artist: string | null;
  year: string | null;
  bitrate: number;
  budgetMs: number;
}): Promise<Prepared> {
  const deadline: Deadline = { at: Date.now() + input.budgetMs };
  const dir = await mkdtemp(path.join(os.tmpdir(), "youtify-"));

  try {
    const audioPath = path.join(dir, "audio.m4a");
    const coverPath = path.join(dir, "cover.jpg");
    const outPath = path.join(dir, "out.mp3");

    const findCover = async () => {
      for (const candidate of input.covers) {
        try {
          const buffer = await fetchSmall(candidate, MAX_COVER_BYTES);
          const handle = await open(coverPath, "w");

          try {
            await handle.write(buffer, 0, buffer.length, 0);
          } finally {
            await handle.close();
          }

          return true;
        } catch {
          continue;
        }
      }

      return false;
    };

    const [, hasCover] = await Promise.all([
      fetchToFile(input.audioUrl, audioPath, 60 * 1024 * 1024, deadline),
      findCover(),
    ]);

    const meta = {
      title: input.title,
      artist: input.artist,
      year: input.year,
      bitrate: input.bitrate,
    };

    let coverEmbedded = false;

    if (hasCover) {
      try {
        await runFfmpeg(
          mp3Args(audioPath, coverPath, outPath, meta),
          remaining(deadline)
        );
        coverEmbedded = true;
      } catch (error) {
        console.error("[mp3] dengan cover gagal, coba tanpa cover", error);
      }
    }

    if (!coverEmbedded) {
      await runFfmpeg(mp3Args(audioPath, null, outPath, meta), remaining(deadline));
    }

    const info = await stat(outPath);

    if (info.size < 1024) {
      throw new MediaError("Hasil konversi kosong.");
    }

    return { file: outPath, dir, size: info.size, coverEmbedded };
  } catch (error) {
    await cleanup(dir);
    throw error;
  }
}

export function streamPrepared(
  prepared: Prepared,
  contentType: string,
  disposition: string
) {
  const node = createReadStream(prepared.file);
  let cleaned = false;

  const finish = () => {
    if (cleaned) return;

    cleaned = true;
    void cleanup(prepared.dir);
  };

  node.on("close", finish);
  node.on("error", finish);

  const body = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(prepared.size),
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
      "X-Cover-Embedded": prepared.coverEmbedded ? "1" : "0",
    },
  });
}
