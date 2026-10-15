 import { ProviderError } from "@/lib/youtube";

const DEFAULT_DOWNLOAD_HOST = "all-in-one-downloader-api.p.rapidapi.com";

export const VIDEO_FORMATS = ["1080p", "720p", "480p", "360p", "240p"] as const;
export const AUDIO_FORMATS = ["mp3"] as const;

const ALLOWED = new Set<string>([...VIDEO_FORMATS, ...AUDIO_FORMATS, "mp4"]);

export type DownloadLink = {
  url: string;
  filename: string | null;
};

export function isAllowedFormat(value: unknown): value is string {
  return typeof value === "string" && ALLOWED.has(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestDownload(
  videoUrl: string,
  format: string
): Promise<DownloadLink> {
  const key = process.env.RAPIDAPI_KEY;

  if (!key) {
    throw new ProviderError(
      "RAPIDAPI_KEY belum dikonfigurasi di environment Vercel.",
      500
    );
  }

  const host = process.env.RAPIDAPI_DOWNLOAD_HOST?.trim() || DEFAULT_DOWNLOAD_HOST;
  const startedAt = Date.now();
  const deadline = 52_000;

  let status: number | null = null;
  let detail = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - (Date.now() - startedAt);

    if (remaining < 5000) break;

    try {
      const response = await fetch(`https://${host}/youtube/download`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "X-Rapidapi-Key": key,
          "X-Rapidapi-Host": host,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ url: videoUrl, format }),
        signal: AbortSignal.timeout(remaining),
      });

      status = response.status;

      const text = await response.text();

      let body: Record<string, unknown> | null = null;

      try {
        const parsed = JSON.parse(text);

        body =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        body = null;
      }

      const link = typeof body?.download_url === "string" ? body.download_url : "";
      const valid = response.ok && body?.ok === true && /^https:\/\//i.test(link);

      console.log(
        `[download-api] format=${format} attempt=${attempt} http=${response.status} valid=${valid}${
          valid ? "" : ` body=${text.slice(0, 200).replace(/\s+/g, " ")}`
        }`
      );

      if (valid) {
        return {
          url: link,
          filename: typeof body?.filename === "string" ? body.filename : null,
        };
      }

      detail = text.slice(0, 160);

      if ([400, 401, 403, 404, 422].includes(response.status)) break;
    } catch (error) {
      status = null;

      console.log(
        `[download-api] format=${format} attempt=${attempt} error=${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }

    if (attempt < 2) await sleep(1200);
  }

  if (status === 401 || status === 403) {
    throw new ProviderError(
      "Akses ke API unduhan ditolak. Pastikan RAPIDAPI_KEY sudah berlangganan ke All-in-One Downloader.",
      502
    );
  }

  if (status === 429) {
    throw new ProviderError(
      "Kuota API unduhan habis atau terlalu banyak permintaan. Coba lagi beberapa saat.",
      429
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    throw new ProviderError(
      `Format ${format} tidak tersedia untuk video ini. Coba kualitas lain.${
        detail ? ` (${detail})` : ""
      }`,
      422
    );
  }

  throw new ProviderError(
    "Gagal membuat link unduhan. Coba lagi atau pilih kualitas lain.",
    502
  );
}
