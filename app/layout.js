import "./globals.css";

export const metadata = {
  title: "Night Fury Radar — Fly Blind. Pulse to See.",
  description:
    "An atmospheric side-scrolling survival game. You are Toothless, navigating pitch-black caves with plasma pulse sonar.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
