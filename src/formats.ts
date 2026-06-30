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
