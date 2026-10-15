import { NextRequest, NextResponse } from "next/server";
import { verifyUrl } from "@/lib/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = params.get("u")?.trim();
  const signature = params.get("s")?.trim();

  if (!target || !signature || !verifyUrl(target, signature)) {
    return jsonError("Tautan gambar tidak valid.", 403);
  }

  let parsed: URL;

  try {
    parsed = new URL(target);
  } catch {
    return jsonError("Tautan gambar tidak valid.", 400);
  }

  if (parsed.protocol !== "https:") {
    return jsonError("Tautan gambar tidak valid.", 400);
  }

  try {
    const response = await fetch(parsed, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });

    const type = (response.headers.get("content-type") || "").split(";")[0].trim();

    if (!response.ok || !response.body || !type.startsWith("image/")) {
      await response.body?.cancel().catch(() => undefined);

      return jsonError(`Server gambar HTTP ${response.status}`, 502);
    }

    const out = new Headers();

    out.set("Content-Type", type);
    out.set("Cache-Control", "private, max-age=3600");

    const length = response.headers.get("content-length");

    if (length) out.set("Content-Length", length);

    return new NextResponse(response.body, { status: 200, headers: out });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Gagal mengambil gambar.",
      502
    );
  }
}
