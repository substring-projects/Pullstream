import { openUrl } from "@tauri-apps/plugin-opener";

export const COMPANY = {
  name: "Substring Technologies",
  website: "https://substringtechnologies.com/",
  contact: "https://substringtechnologies.com/contact/",
  email: "contact@substringtechnologies.com",
  location: "Lucknow, Uttar Pradesh, India",
  founded: 2021,
};

/** Where the Help menu item sends users. */
export const HELP_URL = COMPANY.contact;

export const THIRD_PARTY = [
  { name: "yt-dlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp" },
  { name: "FFmpeg", license: "LGPL / GPL", url: "https://ffmpeg.org/legal.html" },
  { name: "Deno", license: "MIT", url: "https://github.com/denoland/deno" },
  { name: "Tauri", license: "MIT / Apache-2.0", url: "https://tauri.app" },
];

export const open = (url: string) => openUrl(url).catch(() => {});
