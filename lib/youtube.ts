import { proxyPath } from "@/lib/sign";

const DEFAULT_HOST = "best-youtube-scraper-free-1000-calls.p.rapidapi.com";

type Json = Record<string, unknown>;

export type Target = { id: string; url: string };

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

function isValidDetails(body: Json) {
  return str(obj(body.video)?.id) !== null;
}

function thumbnailChoices(videoId: string, details: Json | null): string[] {
  const found = new Set<string>();
  const main = httpUrl(details?.thumbnail);

  if (main) found.add(main);

  found.add(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
  found.add(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);

  return [...found];
}

export async function fetchYouTube(target: Target): Promise<YouTubeData> {
  const result = await callEndpoint(
    "/videos/details",
    target.url,
    isValidDetails,
    20_000,
    3,
    48_000
  );

  const status = result.status;

  if (!result.json) {
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
        "Video tidak ditemukan atau tidak bisa diakses. Pastikan tautan benar.",
        404
      );
    }
  }

  const details = obj(result.json?.video);
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

  const channel = obj(details?.channel);
  const covers = thumbnailChoices(target.id, details);
  const thumbDirect = covers[0] ?? null;
  const published = str(details?.published_at);
  const publishedMs = published ? Date.parse(published) : NaN;
  const avatar = httpUrl(channel?.thumbnail);

  return {
    id: target.id,
    url: str(details?.link) ?? target.url,
    title: str(details?.title) ?? "Video YouTube",
    isShort: details?.is_short === true,
    durationSeconds: num(details?.duration_seconds),
    publishedAt: Number.isFinite(publishedMs) ? Math.floor(publishedMs / 1000) : null,
    description: str(details?.description),
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
    meta: { details: result.json ? "ok" : `http-${status ?? "timeout"}` },
  };
}
