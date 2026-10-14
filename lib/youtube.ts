import { proxyPath, signUrl } from "@/lib/sign";

const DEFAULT_HOST = "best-youtube-scraper-free-1000-calls.p.rapidapi.com";

export const MAX_MERGE_BYTES = 150 * 1024 * 1024;
export const MAX_MERGE_SECONDS = 30 * 60;
export const MAX_MP3_SECONDS = 25 * 60;
export const MP3_BITRATE_KBPS = 192;

type Json = Record<string, unknown>;

export type Target = { id: string; url: string };

export type VideoOption = {
  key: string;
  label: string;
  height: number;
  kind: "direct" | "merge";
  bytes: number | null;
  blocked: string | null;
  download: string | null;
  convert: { payload: string; token: string } | null;
};

export type AudioOptions = {
  mp3: {
    bitrate: number;
    blocked: string | null;
    convert: { payload: string; token: string } | null;
  };
  m4a: {
    bytes: number | null;
    format: string;
    download: string;
  } | null;
};

export type YouTubeData = {
  id: string;
  url: string;
  title: string;
  isShort: boolean;
  durationSeconds: number | null;
  publishedAt: number | null;
  description: string | null;
  thumb: string | null;
  thumbDirect: string | null;
  channel: {
    name: string | null;
    handle: string | null;
    link: string | null;
    verified: boolean;
    subscribers: number | null;
    avatar: string | null;
    avatarDirect: string | null;
  };
  stats: {
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
  preview: { src: string; width: number | null; height: number | null } | null;
  videos: VideoOption[];
  audio: AudioOptions;
  expiresAt: number | null;
  meta: { details: string };
};

export class ProviderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function httpUrl(value: unknown): string | null {
  const text = str(value);

  return text && /^https?:\/\//i.test(text) ? text : null;
}

export function parseTarget(raw: string): Target | null {
  const value = raw.trim();

  if (!value) return null;

  let parsed: URL;

  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const idPattern = /^[A-Za-z0-9_-]{11}$/;

  let id: string | null = null;

  if (host === "youtu.be") {
    id = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parts[0] === "watch") {
      id = parsed.searchParams.get("v");
    } else if (["shorts", "live", "embed", "v"].includes(parts[0] ?? "")) {
      id = parts[1] ?? null;
    }
  }

  if (!id || !idPattern.test(id)) return null;

  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

function getHost() {
  return process.env.RAPIDAPI_HOST?.trim() || DEFAULT_HOST;
}

type Fetched = { json: Json | null; status: number | null };

async function callEndpoint(
  path: string,
  videoUrl: string,
  isValid: (body: Json) => boolean,
  timeoutMs: number,
  maxAttempts: number,
  deadlineMs: number
): Promise<Fetched> {
  const key = process.env.RAPIDAPI_KEY;

  if (!key) {
    throw new ProviderError(
      "RAPIDAPI_KEY belum dikonfigurasi di environment Vercel.",
      500
    );
  }

  const host = getHost();

  const endpoint = `https://${host}${path}?video=${encodeURIComponent(
    videoUrl
  )}`;

  const startedAt = Date.now();
  let status: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadlineMs - (Date.now() - startedAt);

    if (remaining < 3000) break;

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        headers: {
          "X-Rapidapi-Key": key,
          "X-Rapidapi-Host": host,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
      });

      status = response.status;

      const text = await response.text();

      let body: Json | null = null;

      try {
        body = obj(JSON.parse(text));
      } catch {
        body = null;
      }

      const valid = response.ok && body !== null && isValid(body);

      console.log(
        `[youtube] ${path} attempt=${attempt} http=${response.status} valid=${valid}${
          valid ? "" : ` body=${text.slice(0, 200).replace(/\s+/g, " ")}`
        }`
      );

      if (valid) return { json: body, status };

      if ([400, 401, 403, 404, 422].includes(response.status)) break;
    } catch (error) {
      status = null;

      console.log(
        `[youtube] ${path} attempt=${attempt} error=${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }

    if (attempt < maxAttempts) await sleep(900 * attempt);
  }

  return { json: null, status };
}

function isValidStreams(body: Json) {
  const hasList = ["muxed", "video_only", "audio_only"].some(
    (key) => arr(body[key]).length > 0
  );

  return hasList && obj(body.video) !== null;
}

function isValidDetails(body: Json) {
  return str(obj(body.video)?.id) !== null;
}

type Format = {
  itag: number | null;
  link: string;
  mime: string;
  codec: string;
  quality: string;
  width: number | null;
  height: number | null;
  bitrate: number;
  bytes: number | null;
  isDefault: boolean;
  isDrc: boolean;
};

function readFormats(list: unknown): Format[] {
  const out: Format[] = [];

  for (const entry of arr(list)) {
    const item = obj(entry);
    const link = httpUrl(item?.link);

    if (!item || !link) continue;

    out.push({
      itag: num(item.itag),
      link,
      mime: (str(item.mime_type) ?? "").toLowerCase(),
      codec: (arr(item.codecs).map((c) => String(c)).join(",") || "").toLowerCase(),
      quality: str(item.quality) ?? "",
      width: num(item.width),
      height: num(item.height),
      bitrate: num(item.bitrate) ?? num(item.average_bitrate) ?? 0,
      bytes: num(item.size_bytes),
      isDefault: item.is_default_audio === true,
      isDrc: item.is_drc === true,
    });
  }

  return out;
}

function labelFor(format: Format) {
  if (/^\d{2,4}p$/i.test(format.quality)) return format.quality.toLowerCase();

  const side =
    format.width && format.height ? Math.min(format.width, format.height) : 0;

  return side > 0 ? `${side}p` : "Asli";
}

function heightOf(label: string) {
  return Number(label.replace(/\D/g, "")) || 0;
}

function pickAudio(list: Format[]): Format | null {
  const aac = list.filter(
    (format) => format.mime.includes("mp4") && format.codec.includes("mp4a")
  );

  const pool = aac.length > 0 ? aac : list;

  if (pool.length === 0) return null;

  return [...pool].sort((a, b) => {
    const drc = Number(a.isDrc) - Number(b.isDrc);

    if (drc !== 0) return drc;

    const def = Number(b.isDefault) - Number(a.isDefault);

    if (def !== 0) return def;

    return b.bitrate - a.bitrate;
  })[0];
}

function thumbnailChoices(videoId: string, details: Json | null): string[] {
  const found = new Set<string>();
  const main = httpUrl(details?.thumbnail);

  if (main) found.add(main);

  const list = arr(details?.thumbnails)
    .map((entry) => obj(entry))
    .filter((entry): entry is Json => entry !== null)
    .filter((entry) => httpUrl(entry.link) && /\.jpe?g(\?|$)/i.test(String(entry.link)))
    .sort((a, b) => (num(b.width) ?? 0) - (num(a.width) ?? 0));

  for (const entry of list) found.add(String(entry.link));

  found.add(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
  found.add(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);

  return [...found];
}

function sign(payload: Json) {
  const text = JSON.stringify(payload);

  return { payload: text, token: signUrl(text) };
}

function expiryFromLink(link: string): number | null {
  try {
    const value = Number(new URL(link).searchParams.get("expire"));

    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function fetchYouTube(target: Target): Promise<YouTubeData> {
  const [streamsResult, detailsResult] = await Promise.all([
    callEndpoint("/videos/streams", target.url, isValidStreams, 26_000, 3, 50_000),
    callEndpoint("/videos/details", target.url, isValidDetails, 16_000, 2, 36_000).catch(
      () => ({ json: null, status: null }) as Fetched
    ),
  ]);

  const detailStatus = detailsResult.json
    ? "ok"
    : `http-${detailsResult.status ?? "timeout"}`;

  const details = obj(detailsResult.json?.video);

  const playability = obj(details?.playability);

  if (details?.is_live === true || details?.is_upcoming === true) {
    throw new ProviderError(
      "Siaran langsung atau video yang belum tayang belum didukung.",
      422
    );
  }

  if (playability && str(playability.status) && playability.status !== "OK") {
    throw new ProviderError(
      str(playability.reason) ??
        "Video ini tidak bisa diputar (privat, dihapus, atau dibatasi).",
      422
    );
  }

  if (!streamsResult.json) {
    const status = streamsResult.status;

    if (status === 401 || status === 403) {
      throw new ProviderError(
        "Akses ke penyedia API ditolak. Periksa RAPIDAPI_KEY dan langganan ke API YouTube.",
        502
      );
    }

    if (status === 429) {
      throw new ProviderError(
        "Kuota API sedang habis atau terlalu banyak permintaan. Coba lagi beberapa saat.",
        429
      );
    }

    if (status === 404 || status === 400 || status === 422) {
      throw new ProviderError(
        "Video tidak ditemukan atau tidak bisa diunduh. Pastikan tautan benar.",
        404
      );
    }

    throw new ProviderError(
      "Gagal mengambil data video. Coba lagi beberapa saat.",
      502
    );
  }

  const streams = streamsResult.json;
  const streamVideo = obj(streams.video);

  if (obj(streamVideo?.playability) && obj(streamVideo?.playability)?.status !== "OK") {
    throw new ProviderError(
      str(obj(streamVideo?.playability)?.reason) ??
        "Video ini tidak bisa diunduh (privat, dihapus, atau dibatasi umur).",
      422
    );
  }

  if (streamVideo?.is_live === true) {
    throw new ProviderError("Siaran langsung belum didukung.", 422);
  }

  const muxed = readFormats(streams.muxed).filter((f) => f.mime.includes("mp4"));
  const videoOnly = readFormats(streams.video_only).filter(
    (f) => f.mime.includes("mp4") && f.codec.startsWith("avc1")
  );
  const audioOnly = readFormats(streams.audio_only);

  const durationSeconds =
    num(details?.duration_seconds) ?? num(streamVideo?.duration_seconds);

  const title =
    str(details?.title) ?? str(streamVideo?.title) ?? "YouTube Video";

  const channel = obj(details?.channel);

  const bestMuxed = [...muxed].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bitrate - a.bitrate
  )[0];

  const audioFormat = pickAudio(audioOnly);
  const m4aFormat = pickAudio(
    audioOnly.filter(
      (format) => format.mime.includes("mp4") && format.codec.includes("mp4a")
    )
  );

  const videos: VideoOption[] = [];

  if (bestMuxed) {
    const label = labelFor(bestMuxed);

    videos.push({
      key: `direct-${label}`,
      label,
      height: heightOf(label),
      kind: "direct",
      bytes: bestMuxed.bytes,
      blocked: null,
      download: proxyPath(bestMuxed.link, {
        name: `${title} (${label})`,
        download: true,
      }),
      convert: null,
    });
  }

  if (m4aFormat) {
    const bestPerLabel = new Map<string, Format>();

    for (const format of videoOnly) {
      const label = labelFor(format);

      const current = bestPerLabel.get(label);

      if (!current || format.bitrate > current.bitrate) {
        bestPerLabel.set(label, format);
      }
    }

    const mutedLabel = bestMuxed ? labelFor(bestMuxed) : null;
    const mutedHeight = mutedLabel ? heightOf(mutedLabel) : 0;

    for (const [label, format] of bestPerLabel) {
      const height = heightOf(label);

      if (mutedLabel && height <= mutedHeight) continue;
      if (!mutedLabel && height < 144) continue;

      const total =
        format.bytes !== null && m4aFormat.bytes !== null
          ? format.bytes + m4aFormat.bytes
          : null;

      let blocked: string | null = null;

      if (durationSeconds !== null && durationSeconds > MAX_MERGE_SECONDS) {
        blocked = "Video terlalu panjang untuk digabung di server (maks. 30 menit).";
      } else if (total !== null && total > MAX_MERGE_BYTES) {
        blocked = "Ukuran file terlalu besar untuk digabung di server.";
      }

      videos.push({
        key: `merge-${label}`,
        label,
        height,
        kind: "merge",
        bytes: total,
        blocked,
        download: null,
        convert: blocked
          ? null
          : sign({
              v: format.link,
              a: m4aFormat.link,
              t: title,
              l: label,
              s: total,
            }),
      });
    }
  }

  videos.sort((a, b) => b.height - a.height);

  const audioSource = audioFormat ?? m4aFormat;

  if (videos.length === 0 && !audioSource) {
    throw new ProviderError(
      "Tidak ada format yang bisa diunduh untuk video ini.",
      422
    );
  }

  const covers = thumbnailChoices(target.id, details);
  const thumbDirect = covers[0] ?? null;
  const published = str(details?.published_at);
  const publishedMs = published ? Date.parse(published) : NaN;
  const year = Number.isFinite(publishedMs)
    ? String(new Date(publishedMs).getUTCFullYear())
    : null;

  let mp3Blocked: string | null = null;

  if (!audioSource) {
    mp3Blocked = "Audio untuk video ini tidak tersedia.";
  } else if (durationSeconds !== null && durationSeconds > MAX_MP3_SECONDS) {
    mp3Blocked = "Video terlalu panjang untuk dikonversi ke MP3 (maks. 25 menit). Gunakan M4A.";
  }

  const mp3Convert =
    !mp3Blocked && audioSource
      ? sign({
          a: audioSource.link,
          c: covers.slice(0, 3),
          t: title,
          r: str(channel?.name),
          y: year,
          b: MP3_BITRATE_KBPS,
        })
      : null;

  const avatar = httpUrl(channel?.thumbnail);

  const firstLink = (bestMuxed ?? videoOnly[0] ?? audioSource)?.link ?? null;

  const description = str(details?.description);

  return {
    id: target.id,
    url: str(details?.link) ?? target.url,
    title,
    isShort: details?.is_short === true || /\/shorts\//.test(target.url),
    durationSeconds,
    publishedAt: Number.isFinite(publishedMs) ? Math.floor(publishedMs / 1000) : null,
    description,
    thumb: thumbDirect ? proxyPath(thumbDirect) : null,
    thumbDirect,
    channel: {
      name: str(channel?.name),
      handle: str(channel?.handle),
      link: httpUrl(channel?.link),
      verified: channel?.is_verified === true,
      subscribers: num(channel?.subscriber_count),
      avatar: avatar ? proxyPath(avatar) : null,
      avatarDirect: avatar,
    },
    stats: {
      views: num(details?.view_count),
      likes: num(details?.like_count),
      comments: num(details?.comment_count),
    },
    preview: bestMuxed
      ? {
          src: proxyPath(bestMuxed.link),
          width: bestMuxed.width,
          height: bestMuxed.height,
        }
      : null,
    videos,
    audio: {
      mp3: {
        bitrate: MP3_BITRATE_KBPS,
        blocked: mp3Blocked,
        convert: mp3Convert,
      },
      m4a: m4aFormat
        ? {
            bytes: m4aFormat.bytes,
            format: "M4A (AAC)",
            download: proxyPath(m4aFormat.link, {
              name: title,
              download: true,
            }),
          }
        : null,
    },
    expiresAt: firstLink ? expiryFromLink(firstLink) : null,
    meta: { details: detailStatus },
  };
}
