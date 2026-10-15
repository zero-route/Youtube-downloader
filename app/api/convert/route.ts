import { NextRequest, NextResponse } from "next/server";
import { isAllowedFormat, requestDownload } from "@/lib/downloader";
import { ProviderError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    format?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";
  const format = body?.format;

  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !isAllowedFormat(format)) {
    return fail("Permintaan unduhan tidak valid.", 400);
  }

  try {
    const link = await requestDownload(
      `https://www.youtube.com/watch?v=${id}`,
      format
    );

    return NextResponse.json(
      { ok: true, url: link.url, filename: link.filename },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      return fail(error.message, error.status);
    }

    return fail(
      error instanceof Error ? error.message : "Terjadi kesalahan pada server.",
      502
    );
  }
}
