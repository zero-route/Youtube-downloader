import { NextRequest, NextResponse } from "next/server";
import { verifyUrl } from "@/lib/sign";
import { encodeFilename } from "@/lib/filename";
import {
  MediaError,
  muxMp4,
  streamPrepared,
} from "@/lib/ffmpeg";
import { MAX_MERGE_BYTES } from "@/lib/youtube";

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
      return fail("Data penggabungan tidak valid. Muat ulang video lalu coba lagi.", 403);
    }

    let data: Record<string, unknown>;

    try {
      data = JSON.parse(body.payload) as Record<string, unknown>;
    } catch {
      return fail("Data penggabungan tidak valid.", 400);
    }

    const videoUrl = text(data.v, 4096);
    const audioUrl = text(data.a, 4096);

    if (!videoUrl || !audioUrl) {
      return fail("Data penggabungan tidak valid.", 400);
    }

    const title = text(data.t, 300) ?? "YouTify";
    const label = text(data.l, 16);

    const prepared = await muxMp4({
      videoUrl,
      audioUrl,
      maxBytes: MAX_MERGE_BYTES,
      budgetMs: 52_000,
    });

    return streamPrepared(
      prepared,
      "video/mp4",
      encodeFilename(label ? `${title} (${label})` : title, "mp4")
    );
  } catch (error) {
    console.error("[merge]", error);

    if (error instanceof MediaError) {
      return fail(error.message, error.status);
    }

    return fail(
      error instanceof Error ? error.message : "Gagal menggabungkan video.",
      500
    );
  }
}
