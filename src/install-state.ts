import type { ConversionEngine } from "./engines";
import type { Addon, SourceDownSettings } from "./settings";

export const SUPPORTED_PYTHON_CHECK = ["-c", "import sys; assert sys.version_info >= (3, 10)"] as const;

export function selectionsChanged(settings: SourceDownSettings, addons: Addon[], engines: ConversionEngine[]): boolean {
  return settings.installedAddons === null ||
    addons.some((addon) => !settings.installedAddons?.includes(addon)) ||
    settings.installedEngines === null ||
    engines.some((engine) => !settings.installedEngines?.includes(engine));
}
