import type SourceDownPlugin from "./main";
import { type ConversionEngine, readEngines } from "./engines";

export const ADDONS = {
  "audio-transcription": "Audio transcription",
  docx: "Word (DOCX)",
  outlook: "Outlook messages",
  pdf: "PDF",
  pptx: "PowerPoint (PPTX)",
  xls: "Excel (XLS)",
  xlsx: "Excel (XLSX)",
  "youtube-transcription": "YouTube transcription",
} as const;

export type Addon = keyof typeof ADDONS;

export interface SourceDownSettings {
  pythonCommand: string;
  outputFolder: string;
  addons: Record<Addon, boolean>;
  installedAddons: Addon[] | null;
  engines: Record<ConversionEngine, boolean>;
  installedEngines: ConversionEngine[] | null;
}

const DEFAULT_ADDONS: Addon[] = ["docx", "pdf", "pptx", "xlsx"];

export const DEFAULT_SETTINGS: SourceDownSettings = {
  pythonCommand: "python3",
  outputFolder: "SourceDown",
  addons: Object.fromEntries(Object.keys(ADDONS).map((addon) => [addon, DEFAULT_ADDONS.includes(addon as Addon)])) as Record<Addon, boolean>,
  installedAddons: null,
  engines: { markitdown: true, docling: false, marker: false },
  installedEngines: null,
};

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
export const isAddon = (value: unknown): value is Addon => typeof value === "string" && value in ADDONS;

export function readAddons(value: unknown): Addon[] | null {
  if (!Array.isArray(value) || !value.every(isAddon)) return null;
  return value;
}

export async function loadSettings(plugin: SourceDownPlugin): Promise<SourceDownSettings> {
  const loaded: unknown = await plugin.loadData();
  const saved = isRecord(loaded) ? loaded : {};
  const addons = { ...DEFAULT_SETTINGS.addons };
  if (isRecord(saved.addons)) {
    for (const addon of Object.keys(ADDONS) as Addon[]) {
      if (typeof saved.addons[addon] === "boolean") addons[addon] = saved.addons[addon];
    }
  }
  return {
    pythonCommand: typeof saved.pythonCommand === "string" ? saved.pythonCommand : DEFAULT_SETTINGS.pythonCommand,
    outputFolder: typeof saved.outputFolder === "string" ? saved.outputFolder : DEFAULT_SETTINGS.outputFolder,
    addons,
    installedAddons: readAddons(saved.installedAddons),
    engines: {
      markitdown: isRecord(saved.engines) && typeof saved.engines.markitdown === "boolean" ? saved.engines.markitdown : true,
      docling: isRecord(saved.engines) && typeof saved.engines.docling === "boolean" ? saved.engines.docling : false,
      marker: isRecord(saved.engines) && typeof saved.engines.marker === "boolean" ? saved.engines.marker : false,
    },
    installedEngines: readEngines(saved.installedEngines),
  };
}
