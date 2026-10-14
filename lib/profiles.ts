const PROFILES: Record<string, string>[] = [
  {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  },
  {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US) gzip",
  },
  {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    Referer: "https://www.youtube.com/",
    Origin: "https://www.youtube.com",
  },
];

export const PROFILE_COUNT = PROFILES.length;

export function profileHeaders(
  index: number,
  extra: Record<string, string> = {}
) {
  return { ...PROFILES[index % PROFILES.length], ...extra };
}
