const ADDONS_BY_EXTENSION: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xls: "xls",
  xlsx: "xlsx",
  msg: "outlook",
  mp3: "audio-transcription",
  wav: "audio-transcription",
  m4a: "audio-transcription",
  flac: "audio-transcription",
};

export const addonForFile = (name: string): string | null => ADDONS_BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

export function parseImportUrl(value: string): { href: string; youtube: boolean } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid web address, including http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Enter an HTTP or HTTPS web address.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return { href: url.href, youtube: host === "youtube.com" || host === "youtu.be" };
}
