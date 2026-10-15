import { NextRequest, NextResponse } from "next/server";
import { requestDownload } from "@/lib/downloader";
import { tagMp3 } from "@/lib/id3";
import { ProviderError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const MAX_COVER_BYTES = 6 * 1024 * 1024;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function fail(error: string, status: number, fallbackUrl?: string) {
  return NextResponse.json(
    { ok: false, error, url: fallbackUrl ?? null },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function sniffImage(data: Buffer) {
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data.length > 8 && data[0] === 0x89 && data.toString("ascii", 1, 4) === "PNG") {
    return "image/png";
  }

  return null;
}

function isYtImage(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && url.hostname.endsWith(".ytimg.com");
  } catch {
    return false;
  }
}

async function fetchCover(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        cache: "no-store",
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "image/jpeg,image/*;q=0.8" },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }

      const data = Buffer.from(await response.arrayBuffer());
      const mime = sniffImage(data);

      if (mime && data.length > 2048 && data.length <= MAX_COVER_BYTES) {
        return { data, mime };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    title?: unknown;
    artist?: unknown;
    year?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return fail("Permintaan unduhan tidak valid.", 400);
  }

  let link;

  try {
    link = await requestDownload(
      `https://www.youtube.com/watch?v=${id}`,
      "mp3",
      34_000
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      return fail(error.message, error.status);
    }

    return fail("Gagal membuat link unduhan MP3.", 502);
  }

  try {
    const left = 56_000 - (Date.now() - startedAt);

    const [audioResponse, cover] = await Promise.all([
      fetch(link.url, {
        cache: "no-store",
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        signal: AbortSignal.timeout(Math.max(left - 2000, 5000)),
      }),
      fetchCover(
        [
          link.cover && isYtImage(link.cover) ? link.cover : null,
          `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        ].filter((value): value is string => value !== null)
      ),
    ]);

    if (!audioResponse.ok) {
      await audioResponse.body?.cancel().catch(() => undefined);

      return fail(
        `Server file audio membalas HTTP ${audioResponse.status}.`,
        502,
        link.url
      );
    }

    const declared = Number(audioResponse.headers.get("content-length") || 0);

    if (declared > MAX_AUDIO_BYTES) {
      await audioResponse.body?.cancel().catch(() => undefined);

      return fail("File audio terlalu besar untuk diberi cover.", 413, link.url);
    }

    const audio = Buffer.from(await audioResponse.arrayBuffer());

    if (audio.length < 4096 || audio.length > MAX_AUDIO_BYTES) {
      return fail("File audio dari server tidak valid.", 502, link.url);
    }

    const title =
      text(body?.title, 300) ??
      (link.filename ? link.filename.replace(/\.mp3$/i, "") : "YouTube Audio");

    const tagged = tagMp3(audio, {
      title,
      artist: text(body?.artist, 300),
      year: text(body?.year, 4),
      cover,
    });

    return new Response(new Uint8Array(tagged), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(tagged.length),
        "Cache-Control": "no-store",
        "X-Cover-Embedded": cover ? "1" : "0",
      },
    });
  } catch (error) {
    console.error("[mp3]", error);

    return fail(
      error instanceof Error ? error.message : "Gagal menyiapkan MP3.",
      502,
      link.url
    );
  }
}
