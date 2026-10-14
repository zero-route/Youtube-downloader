"use client";

import { useEffect, useRef, useState } from "react";

type Convert = { payload: string; token: string };

type VideoOption = {
  key: string;
  label: string;
  height: number;
  kind: "direct" | "merge";
  bytes: number | null;
  blocked: string | null;
  download: string | null;
  convert: Convert | null;
};

type AudioOptions = {
  mp3: {
    bitrate: number;
    blocked: string | null;
    convert: Convert | null;
  };
  m4a: {
    bytes: number | null;
    format: string;
    download: string;
  } | null;
};

type VideoData = {
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

type ApiResponse = {
  ok?: boolean;
  data?: VideoData;
  error?: string;
};

type Job = {
  key: string;
  title: string;
  phase: "processing" | "receiving";
  percent: number | null;
};

type Done = { title: string; detail: string };

const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCount(value: number | null) {
  return value === null ? "–" : compact.format(value);
}

function formatSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "";

  const mb = bytes / (1024 * 1024);

  return `~${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace(".", ",")} MB`;
}

function formatDate(seconds: number | null) {
  if (!seconds) return "";

  return new Date(seconds * 1000).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(total: number | null) {
  if (!total || total <= 0) return "";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

function cleanFileName(value: string) {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90)
    .trim();

  return cleaned || "YouTify";
}

function Icon({
  children,
  size = 20,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function LinkIcon() {
  return (
    <Icon size={22}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </Icon>
  );
}

function DownloadIcon({ size = 22 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

function ExternalIcon() {
  return (
    <Icon size={18}>
      <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </Icon>
  );
}

function CaptionIcon() {
  return (
    <Icon size={22}>
      <path d="M4 5h16" />
      <path d="M4 10h10" />
      <path d="M4 15h16" />
      <path d="M4 20h10" />
    </Icon>
  );
}

function VideoIcon() {
  return (
    <Icon size={18}>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </Icon>
  );
}

function MusicIcon() {
  return (
    <Icon size={18}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Icon>
  );
}

function EyeIcon() {
  return (
    <Icon>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

function HeartIcon() {
  return (
    <Icon>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
    </Icon>
  );
}

function CommentIcon() {
  return (
    <Icon>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5Z" />
    </Icon>
  );
}

function VerifiedIcon() {
  return (
    <svg
      className="verified"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Terverifikasi"
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="m7.5 12.3 3 3 6-6.3" stroke="#0b0b0c" />
    </svg>
  );
}

type SmartImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src"
> & {
  direct?: string | null;
  proxy: string;
  onFail?: () => void;
};

function SmartImage({ direct, proxy, onFail, ...rest }: SmartImageProps) {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
  }, [direct, proxy]);

  const separator = proxy.includes("?") ? "&" : "?";

  const src =
    direct && attempt === 0
      ? direct
      : attempt <= 1
        ? proxy
        : `${proxy}${separator}_retry=${attempt}`;

  function handleError() {
    if (attempt >= 5) {
      onFail?.();
      return;
    }

    const delay = attempt === 0 ? 0 : 700 * attempt;

    setTimeout(() => setAttempt((value) => value + 1), delay);
  }

  return (
    <img
      {...rest}
      src={src}
      referrerPolicy="no-referrer"
      onError={handleError}
    />
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<VideoData | null>(null);
  const [tab, setTab] = useState<"video" | "audio">("video");
  const [playing, setPlaying] = useState(false);
  const [quality, setQuality] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const [jobError, setJobError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!job) {
      setElapsed(0);
      return;
    }

    const started = Date.now();

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 500);

    return () => clearInterval(timer);
  }, [job?.key]);

  function announce(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);

    setNotice(message);

    noticeTimer.current = setTimeout(() => setNotice(""), 7000);
  }

  function resetView() {
    setTab("video");
    setPlaying(false);
    setQuality(0);
    setAvatarFailed(false);
    setExpanded(false);
    setJob(null);
    setDone(null);
    setJobError("");
    setNotice("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = url.trim();

    if (!value) {
      setError("Masukkan tautan video YouTube terlebih dahulu.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);
    resetView();

    try {
      const response = await fetch(
        `/api/youtube?url=${encodeURIComponent(value)}`,
        { cache: "no-store" }
      );

      const result = (await response
        .json()
        .catch(() => null)) as ApiResponse | null;

      if (!response.ok || !result?.ok || !result.data) {
        throw new Error(
          result?.error || "Gagal memproses video. Pastikan tautan masih aktif."
        );
      }

      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses video.");
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setUrl("");
    setError("");
    setData(null);
    resetView();
  }

  function isExpired() {
    return Boolean(data?.expiresAt && Date.now() / 1000 > data.expiresAt - 60);
  }

  async function runConversion(input: {
    key: string;
    endpoint: string;
    convert: Convert;
    fileName: string;
    doneTitle: string;
  }) {
    if (job) return;

    if (isExpired()) {
      setJobError("Tautan unduhan sudah kedaluwarsa. Tekan Unduh lagi untuk memuat ulang video.");
      return;
    }

    setDone(null);
    setJobError("");
    setJob({ key: input.key, title: input.doneTitle, phase: "processing", percent: null });

    try {
      const response = await fetch(input.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.convert),
        cache: "no-store",
      });

      if (!response.ok || !response.body) {
        const failure = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(failure?.error || `Proses gagal (HTTP ${response.status}).`);
      }

      const total = Number(response.headers.get("content-length") || 0);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      setJob((current) =>
        current ? { ...current, phase: "receiving", percent: total ? 0 : null } : current
      );

      while (true) {
        const { done: finished, value } = await reader.read();

        if (finished) break;

        chunks.push(value);
        received += value.byteLength;

        if (total) {
          const percent = Math.min(99, Math.round((received / total) * 100));

          setJob((current) => (current ? { ...current, percent } : current));
        }
      }

      const blob = new Blob(chunks as BlobPart[], {
        type: response.headers.get("content-type") || "application/octet-stream",
      });

      if (blob.size < 1024) {
        throw new Error("File hasil proses kosong. Coba lagi.");
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = input.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

      const detail =
        response.headers.get("x-cover-embedded") === "0"
          ? `${formatSize(blob.size)} · tanpa cover`
          : formatSize(blob.size);

      setDone({ title: input.doneTitle, detail });
    } catch (err) {
      setJobError(
        err instanceof Error ? err.message : "Terjadi kesalahan saat memproses file."
      );
    } finally {
      setJob(null);
    }
  }

  const chosen = data
    ? data.videos[Math.min(quality, Math.max(data.videos.length - 1, 0))]
    : undefined;

  const baseName = data ? cleanFileName(data.title) : "YouTify";
  const duration = formatDuration(data?.durationSeconds ?? null);
  const date = formatDate(data?.publishedAt ?? null);
  const channelName = data?.channel.name || "YouTube";

  const fullDescription = data?.description?.trim() ?? "";

  const hashtags = [
    ...new Set(fullDescription.match(/#[\p{L}\p{N}_]+/gu) ?? []),
  ].slice(0, 20);

  const description = fullDescription
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const longDescription = description.length > 220 || description.split("\n").length > 4;

  const statList = data
    ? [
        { key: "views", name: "Tayangan", value: data.stats.views, icon: <EyeIcon /> },
        { key: "likes", name: "Suka", value: data.stats.likes, icon: <HeartIcon /> },
        { key: "comments", name: "Komentar", value: data.stats.comments, icon: <CommentIcon /> },
      ].filter((stat) => stat.value !== null)
    : [];

  const busy = job !== null;

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="YouTify beranda">
          <span className="brand-mark" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.9L20 12.9a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z" />
            </svg>
          </span>
          YouTify
        </a>
        <span className="brand-note">YouTube Downloader</span>
      </header>

      <section className="hero" id="top">
        <h1 className="hero-title">Unduh video YouTube</h1>
        <p className="tagline">Video MP4, Shorts, dan audio MP3, dengan mudah.</p>
      </section>

      <form className="search" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-icon">
            <LinkIcon />
          </span>

          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Tempel URL YouTube..."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="url"
          />

          {url && (
            <button
              type="button"
              className="field-clear"
              onClick={handleClear}
              aria-label="Hapus URL"
            >
              ×
            </button>
          )}
        </label>

        <button
          type="submit"
          className="btn btn-primary btn-search"
          disabled={loading}
        >
          {loading ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <DownloadIcon size={20} />
          )}
          <span>{loading ? "Memproses" : "Unduh"}</span>
        </button>
      </form>

      {error && (
        <div className="alert" role="alert">
          <span className="alert-icon">!</span>
          <div>
            <strong>Gagal memproses video</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <section className="card" aria-busy="true">
          <div className="stage skeleton" />
          <div className="skeleton skeleton-btn" />
        </section>
      )}

      {data && !loading && (
        <>
          <section className="card">
            <div className={playing ? "stage stage-playing" : "stage"}>
              {playing && data.preview ? (
                <video
                  key={data.preview.src}
                  className="player"
                  src={data.preview.src}
                  poster={data.thumb ?? undefined}
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <button
                  type="button"
                  className="thumb-button"
                  onClick={() => data.preview && setPlaying(true)}
                  aria-label="Putar pratinjau"
                  disabled={!data.preview}
                >
                  {data.thumb ? (
                    <>
                      <SmartImage
                        key={`blur-${data.thumb}`}
                        className="stage-blur"
                        direct={data.thumbDirect}
                        proxy={data.thumb}
                        alt=""
                        aria-hidden="true"
                      />
                      <SmartImage
                        key={data.thumb}
                        className="thumb"
                        direct={data.thumbDirect}
                        proxy={data.thumb}
                        alt={data.title}
                      />
                    </>
                  ) : (
                    <span className="thumb thumb-empty" />
                  )}

                  {data.preview && (
                    <span className="play">
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M8 5.5v13a1 1 0 0 0 1.5.9L20 12.9a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z" />
                      </svg>
                    </span>
                  )}
                </button>
              )}

              <span className="badge badge-left">
                {data.isShort ? "Shorts" : "Video"}
              </span>

              {duration && !playing && (
                <span className="badge badge-right">{duration}</span>
              )}
            </div>

            <h2 className="video-title">{data.title}</h2>

            <div className="tabs" role="tablist" aria-label="Jenis unduhan">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "video"}
                className={tab === "video" ? "tab tab-on" : "tab"}
                onClick={() => setTab("video")}
              >
                <VideoIcon />
                <span>Video</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "audio"}
                className={tab === "audio" ? "tab tab-on" : "tab"}
                onClick={() => setTab("audio")}
              >
                <MusicIcon />
                <span>Audio</span>
              </button>
            </div>

            {tab === "video" && (
              <>
                {data.videos.length > 0 ? (
                  <>
                    <div className="qualities" role="radiogroup" aria-label="Kualitas video">
                      {data.videos.map((item, index) => {
                        const selected = chosen === item;

                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={Boolean(item.blocked)}
                            title={item.blocked ?? undefined}
                            className={
                              selected
                                ? "quality quality-on"
                                : item.blocked
                                  ? "quality quality-off"
                                  : "quality"
                            }
                            onClick={() => setQuality(index)}
                          >
                            <strong>{item.label}</strong>
                            <span>
                              {item.blocked
                                ? "Terlalu besar"
                                : formatSize(item.bytes) ||
                                  (item.kind === "direct" ? "Langsung" : "HD")}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {chosen?.blocked && (
                      <p className="hint">{chosen.blocked}</p>
                    )}

                    {chosen && chosen.kind === "merge" && !chosen.blocked && (
                      <p className="hint">
                        Kualitas {chosen.label} digabung (video + audio) di server,
                        prosesnya bisa 10–40 detik.
                      </p>
                    )}

                    <div className="actions">
                      {chosen && chosen.kind === "direct" && chosen.download ? (
                        <a
                          className="btn btn-primary btn-block"
                          href={chosen.download}
                          onClick={() => announce(`Mengunduh video ${chosen.label}...`)}
                        >
                          <DownloadIcon />
                          <span>Download Video {chosen.label}</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-block"
                          disabled={busy || !chosen?.convert}
                          onClick={() =>
                            chosen?.convert &&
                            runConversion({
                              key: chosen.key,
                              endpoint: "/api/merge",
                              convert: chosen.convert,
                              fileName: `${baseName} (${chosen.label}).mp4`,
                              doneTitle: `Video ${chosen.label} siap`,
                            })
                          }
                        >
                          {job?.key === chosen?.key ? (
                            <span className="spinner" aria-hidden="true" />
                          ) : (
                            <DownloadIcon />
                          )}
                          <span>
                            {job?.key === chosen?.key
                              ? "Memproses..."
                              : `Download Video ${chosen?.label ?? ""}`}
                          </span>
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="hint">
                    Format video tidak tersedia untuk tautan ini. Coba tab Audio.
                  </p>
                )}
              </>
            )}

            {tab === "audio" && (
              <div className="audio-list">
                <div className="audio-row">
                  <div className="audio-meta">
                    <strong>MP3</strong>
                    <span>
                      {data.audio.mp3.bitrate} kbps · judul, artis, dan cover
                      disematkan
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary audio-btn"
                    disabled={busy || !data.audio.mp3.convert}
                    title={data.audio.mp3.blocked ?? undefined}
                    onClick={() =>
                      data.audio.mp3.convert &&
                      runConversion({
                        key: "mp3",
                        endpoint: "/api/mp3",
                        convert: data.audio.mp3.convert,
                        fileName: `${baseName}.mp3`,
                        doneTitle: "MP3 siap",
                      })
                    }
                  >
                    {job?.key === "mp3" ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <DownloadIcon size={20} />
                    )}
                    <span>{job?.key === "mp3" ? "Memproses" : "MP3"}</span>
                  </button>
                </div>

                {data.audio.mp3.blocked && (
                  <p className="hint">{data.audio.mp3.blocked}</p>
                )}

                {data.audio.m4a && (
                  <div className="audio-row">
                    <div className="audio-meta">
                      <strong>M4A</strong>
                      <span>
                        {data.audio.m4a.format}
                        {formatSize(data.audio.m4a.bytes)
                          ? ` · ${formatSize(data.audio.m4a.bytes)}`
                          : ""}{" "}
                        · tanpa konversi, langsung
                      </span>
                    </div>

                    <a
                      className="btn btn-light audio-btn"
                      href={data.audio.m4a.download}
                      onClick={() => announce("Mengunduh audio M4A...")}
                    >
                      <DownloadIcon size={20} />
                      <span>M4A</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {job && (
              <div className="alert" role="status">
                <span className="alert-icon">
                  <span className="spinner spinner-small" aria-hidden="true" />
                </span>
                <div className="alert-body">
                  <strong>
                    {job.phase === "processing"
                      ? `Menyiapkan file... ${elapsed} dtk`
                      : `Menerima file... ${job.percent !== null ? `${job.percent}%` : `${elapsed} dtk`}`}
                  </strong>
                  <p>
                    {job.phase === "processing"
                      ? "Server sedang mengunduh dan memproses. Jangan tutup halaman ini."
                      : "Unduhan hampir selesai, file akan tersimpan otomatis."}
                  </p>
                  {job.phase === "receiving" && job.percent !== null && (
                    <div className="progress">
                      <span style={{ width: `${job.percent}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {done && !job && (
              <div className="alert" role="status">
                <span className="alert-icon">✓</span>
                <div>
                  <strong>{done.title}</strong>
                  <p>
                    {done.detail ? `${done.detail}. ` : ""}Cek notifikasi unduhan atau
                    folder Unduhan di perangkatmu.
                  </p>
                </div>
              </div>
            )}

            {jobError && !job && (
              <div className="alert" role="alert">
                <span className="alert-icon">!</span>
                <div>
                  <strong>Proses gagal</strong>
                  <p>{jobError}</p>
                </div>
              </div>
            )}

            {notice && !job && !done && !jobError && (
              <div className="alert" role="status">
                <span className="alert-icon">i</span>
                <div>
                  <strong>{notice}</strong>
                  <p>
                    Unduhan diserahkan ke browser. Pantau di notifikasi unduhan
                    Chrome atau menu ⋮ lalu Unduhan.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="card info">
            <div className="profile">
              {data.channel.avatar && !avatarFailed ? (
                <SmartImage
                  key={data.channel.avatar}
                  className="avatar"
                  direct={data.channel.avatarDirect}
                  proxy={data.channel.avatar}
                  alt={channelName}
                  onFail={() => setAvatarFailed(true)}
                />
              ) : (
                <span className="avatar avatar-fallback">
                  {channelName[0].toUpperCase()}
                </span>
              )}

              <div className="profile-text">
                <strong>
                  <span className="name">{channelName}</span>
                  {data.channel.verified && <VerifiedIcon />}
                </strong>
                {data.channel.handle && <span>{data.channel.handle}</span>}
                {data.channel.subscribers !== null && (
                  <span>{formatCount(data.channel.subscribers)} pelanggan</span>
                )}
              </div>

              {data.channel.link && (
                <a
                  className="btn btn-outline"
                  href={data.channel.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalIcon />
                  <span>Kunjungi</span>
                </a>
              )}
            </div>

            {statList.length > 0 && (
              <div className={`stats stats-${statList.length}`}>
                {statList.map((stat) => (
                  <div className="stat" key={stat.key}>
                    <div className="stat-top">
                      {stat.icon}
                      <strong>{formatCount(stat.value)}</strong>
                    </div>
                    <span>{stat.name}</span>
                  </div>
                ))}
              </div>
            )}

            {description && (
              <div className="caption">
                <div className="caption-label caption-head">
                  <CaptionIcon />
                  <span>Deskripsi</span>
                  {date && <span className="caption-date">{date}</span>}
                </div>
                <p className={longDescription && !expanded ? "clamped" : undefined}>
                  {description}
                </p>
                {longDescription && (
                  <button
                    type="button"
                    className="more"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? "Tampilkan lebih sedikit" : "Selengkapnya"}
                  </button>
                )}
              </div>
            )}

            {!description && date && (
              <div className="caption">
                <div className="caption-label caption-head">
                  <span>Diunggah</span>
                  <span className="caption-date">{date}</span>
                </div>
              </div>
            )}

            {hashtags.length > 0 && (
              <div className="hashtags">
                <div className="caption-label">
                  <span>#Hashtag</span>
                </div>
                <div className="hashtag-list">
                  {hashtags.map((tag) => (
                    <span className="hashtag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <footer className="footer">
        Gunakan hanya untuk konten yang kamu berhak unduh. Hormati karya kreator.
      </footer>
    </main>
  );
}
