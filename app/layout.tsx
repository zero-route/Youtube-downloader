import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTify - YouTube Downloader",
  description: "Unduh video MP4, Shorts, dan audio MP3 dari YouTube dengan cepat dan mudah.",
  icons: {
    icon: "/icon.png", 
    shortcut: "/icon.png", 
    apple: "/icon.png", 
  }, 
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
  