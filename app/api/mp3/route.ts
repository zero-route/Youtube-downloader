 import { NextRequest, NextResponse } from "next/server";
import { verifyUrl } from "@/lib/sign";
import { encodeFilename } from "@/lib/filename";
import {
  encodeMp3,
  MediaError,
  streamPrepared,
} from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function fail(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      payload?: unknown;
      token?: unknown;
    } | null;

    if (
      !body ||
      typeof body.payload !== "string" ||
      typeof body.token !== "string" ||
      body.payload.length > 12288 ||
      !verifyUrl(body.payload, body.token)
    ) {
      return fail("Data konversi tidak valid. Muat ulang video lalu coba lagi.", 403);
    }

    let data: Record<string, unknown>;

    try {
      data = JSON.parse(body.payload) as Record<string, unknown>;
    } catch {
      return fail("Data konversi tidak valid.", 400);
    }

    const audioUrl = text(data.a, 4096);

    if (!audioUrl) {
      return fail("Data konversi tidak valid.", 400);
    }

    const covers = Array.isArray(data.c)
      ? data.c
          .map((entry) => text(entry, 2048))
          .filter((entry): entry is string => entry !== null)
          .slice(0, 4)
      : [];

    const bitrate = Number(data.b);
    const title = text(data.t, 300) ?? "YouTify";

    const prepared = await encodeMp3({
      audioUrl,
      covers,
      title,
      artist: text(data.r, 300),
      year: text(data.y, 10),
      bitrate: Number.isFinite(bitrate) && bitrate >= 96 && bitrate <= 320 ? bitrate : 192,
      budgetMs: 52_000,
    });

    return streamPrepared(prepared, "audio/mpeg", encodeFilename(title, "mp3"));
  } catch (error) {
    console.error("[mp3]", error);

    if (error instanceof MediaError) {
      return fail(error.message, error.status);
    }

    return fail(
      error instanceof Error ? error.message : "Gagal membuat file MP3.",
      500
    );
  }
}
