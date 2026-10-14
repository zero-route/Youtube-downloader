import { NextRequest, NextResponse } from "next/server";
import { fetchYouTube, parseTarget } from "@/lib/youtube";
import { profileHeaders, PROFILE_COUNT } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Probe = {
  name: string;
  status: number | null;
  type: string | null;
  length: string | null;
  server: string | null;
  body: string | null;
  error: string | null;
};

async function probe(
  name: string,
  url: string,
  headers: Record<string, string>
): Promise<Probe> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const ok = response.status === 200 || response.status === 206;
    const body = ok ? null : (await response.text().catch(() => "")).slice(0, 160);

    if (ok) {
      await response.body?.cancel().catch(() => undefined);
    }

    return {
      name,
      status: response.status,
      type: response.headers.get("content-type"),
      length: response.headers.get("content-length"),
      server: response.headers.get("server"),
      body,
      error: null,
    };
  } catch (error) {
    return {
      name,
      status: null,
      type: null,
      length: null,
      server: null,
      body: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const target = parseTarget(input);

  if (!target) {
    return NextResponse.json({ error: "Tambahkan ?url=<link youtube>" }, { status: 400 });
  }

  const egress = await fetch("https://api.ipify.org?format=json", {
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  })
    .then((response) => response.json() as Promise<{ ip?: string }>)
    .then((json) => json.ip ?? null)
    .catch(() => null);

  const data = await fetchYouTube(target).catch((error: unknown) => ({
    failure: error instanceof Error ? error.message : "unknown",
  }));

  if ("failure" in data) {
    return NextResponse.json({ egress, failure: data.failure });
  }

  const proxied = data.audio.m4a?.download ?? data.preview?.src ?? null;
  const raw = proxied ? new URL(proxied, "http://x").searchParams.get("u") : null;

  if (!raw) {
    return NextResponse.json({ egress, failure: "tidak ada link media" });
  }

  const link = new URL(raw);
  const expire = Number(link.searchParams.get("expire"));

  const withQueryRange = new URL(raw);

  withQueryRange.searchParams.set("range", "0-1023");

  const results: Probe[] = [];

  for (let index = 0; index < PROFILE_COUNT; index++) {
    results.push(
      await probe(`profil${index}+header-range`, raw, {
        ...profileHeaders(index),
        Range: "bytes=0-1023",
      })
    );

    results.push(
      await probe(`profil${index}+query-range`, withQueryRange.toString(), profileHeaders(index))
    );
  }

  results.push(await probe("polos-tanpa-header", raw, {}));

  return NextResponse.json({
    egress,
    link: {
      host: link.hostname,
      ip: link.searchParams.get("ip"),
      client: link.searchParams.get("c"),
      expireInSeconds: Number.isFinite(expire) ? expire - Math.floor(Date.now() / 1000) : null,
      mime: link.searchParams.get("mime"),
    },
    results,
  });
}
