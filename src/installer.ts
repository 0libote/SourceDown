import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type SourceDownPlugin from "./main";
import { type ConversionEngine, ENGINES, packageFor, readEngines } from "./engines";
import { pythonCandidates } from "./python";
import { type Addon, ADDONS, isRecord, readAddons } from "./settings";
import { selectionsChanged, SUPPORTED_PYTHON_CHECK } from "./install-state";

const exec = promisify(execFile);

export class SetupError extends Error {
  constructor(message: string, readonly pythonMissing = false) {
    super(message);
  }
}

export class InstallError extends Error {
  constructor(message: string, readonly details: string) {
    super(message);
  }
}

const appDataRoot = (): string => {
  if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
    if (process.env.USERPROFILE) return join(process.env.USERPROFILE, "AppData", "Local");
    throw new Error("Could not find a local app data folder. Set LOCALAPPDATA or USERPROFILE and try again.");
  }
  if (process.platform === "darwin") {
    if (process.env.HOME) return join(process.env.HOME, "Library", "Application Support");
    throw new Error("Could not find a local app data folder. Set HOME and try again.");
  }
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (process.env.HOME) return join(process.env.HOME, ".local", "share");
  throw new Error("Could not find a local app data folder. Set XDG_DATA_HOME or HOME and try again.");
};

const summarizeInstallError = (error: unknown): string => {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.stack ?? error.message);
  if (typeof error === "object" && error && "code" in error && (typeof (error as { code?: unknown }).code === "string" || typeof (error as { code?: unknown }).code === "number")) {
    parts.push(`code: ${(error as { code: string | number }).code}`);
  }
  if (typeof error === "object" && error && "signal" in error && typeof (error as { signal?: unknown }).signal === "string") {
    parts.push(`signal: ${(error as { signal: string }).signal}`);
  }
  if (typeof error === "object" && error && "cmd" in error && typeof (error as { cmd?: unknown }).cmd === "string") {
    parts.push(`command: ${(error as { cmd: string }).cmd}`);
  }
  if (typeof error === "object" && error && "stdout" in error && typeof (error as { stdout?: unknown }).stdout === "string" && (error as { stdout: string }).stdout.trim()) {
    parts.push(`stdout:\n${(error as { stdout: string }).stdout.trimEnd()}`);
  }
  if (typeof error === "object" && error && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string" && (error as { stderr: string }).stderr.trim()) {
    parts.push(`stderr:\n${(error as { stderr: string }).stderr.trimEnd()}`);
  }
  return parts.join("\n\n").trim() || "Unknown installation error.";
};

export class Installer {
  constructor(private plugin: SourceDownPlugin) {}

  private get appDirectory(): string {
    return join(appDataRoot(), "SourceDown");
  }

  private get stateFile(): string {
    return join(this.appDirectory, "state.json");
  }

  private get venvDirectory(): string {
    return join(this.appDirectory, ".venv");
  }

  get venvPython(): string {
    return join(this.venvDirectory, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  }

  executable(engine: ConversionEngine): string {
    return join(
      this.venvDirectory,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? `${ENGINES[engine].executable}.exe` : ENGINES[engine].executable,
    );
  }

  loadSharedSelections(): void {
    try {
      const state: unknown = JSON.parse(readFileSync(this.stateFile, "utf8"));
      if (!isRecord(state)) return;
      this.plugin.settings.installedAddons = readAddons(state.installedAddons) ?? this.plugin.settings.installedAddons;
      this.plugin.settings.installedEngines = readEngines(state.installedEngines) ?? this.plugin.settings.installedEngines;
    } catch {
      // First install or unreadable state: saved vault settings remain the fallback.
    }
  }

  async installOrUpdate(progress: (message: string) => void): Promise<void> {
    const release = this.acquireLock();
    try {
      const engines = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.plugin.settings.engines[engine]);
      if (!engines.length) throw new Error("Enable at least one conversion engine.");
      progress("Looking for Python 3.10 or newer…");
      const python = await this.findPython();
      progress("Creating or checking the private environment…");
      await this.ensureVenv(python, progress);
      const addons = (Object.keys(ADDONS) as Addon[]).filter((addon) => this.plugin.settings.addons[addon]);
      const packages = engines.map((engine) => packageFor(engine, engine === "markitdown" ? addons : []));
      progress(`Installing ${engines.map((engine) => ENGINES[engine].name).join(", ")}…`);
      try {
        await exec(this.venvPython, ["-m", "pip", "install", "--upgrade", ...packages], {
          maxBuffer: 20 * 1024 * 1024,
          timeout: 20 * 60_000,
        });
      } catch (error) {
        throw new InstallError("Failed to install the selected converters.", summarizeInstallError(error));
      }
      await this.setInstalledSelections(
        [...new Set([...(this.plugin.settings.installedAddons ?? []), ...addons])],
        [...new Set([...(this.plugin.settings.installedEngines ?? []), ...engines])],
      );
    } finally {
      release();
    }
  }

  async detectPython(): Promise<{ command: string; version: string } | null> {
    for (const candidate of pythonCandidates(this.plugin.settings.pythonCommand, process.platform)) {
      try {
        const { stdout } = await exec(
          candidate,
          ["-c", "import sys; assert sys.version_info >= (3, 10); print('.'.join(map(str, sys.version_info[:3])))"],
          { timeout: 10_000 },
        );
        return { command: candidate, version: stdout.trim() };
      } catch {
        continue;
      }
    }
    return null;
  }

  selectionsChanged(): boolean {
    const addons = (Object.keys(ADDONS) as Addon[]).filter((addon) => this.plugin.settings.addons[addon]);
    const engines = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.plugin.settings.engines[engine]);
    return selectionsChanged(this.plugin.settings, addons, engines);
  }

  async status(): Promise<{ ready: boolean; text: string }> {
    const python = await this.detectPython();
    const selected = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.plugin.settings.engines[engine]);
    if (!selected.length) return { ready: false, text: "Setup required: enable at least one conversion engine." };
    const versions = new Map<ConversionEngine, string>();
    for (const engine of selected) {
      try {
        const distribution = ENGINES[engine].package.split(/[=[\]]/)[0];
        const { stdout } = await exec(this.venvPython, ["-c", `import importlib.metadata; print(importlib.metadata.version("${distribution}"))`], { timeout: 10_000 });
        versions.set(engine, stdout.trim());
      } catch {
        // Missing engines are reported below.
      }
    }
    const missing = selected.filter((engine) => !versions.has(engine));
    if (!python && !versions.size) return { ready: false, text: "Setup required: Python 3.10+ and the selected conversion engines were not found." };
    if (missing.length) return { ready: false, text: `Setup required: ${missing.map((engine) => ENGINES[engine].name).join(", ")} ${missing.length === 1 ? "is" : "are"} not installed.` };
    const names = selected.map((engine) => `${ENGINES[engine].name} ${versions.get(engine)}`).join(", ");
    if (!python) return { ready: false, text: `${names} installed. Python 3.10+ is needed for installs and updates.` };
    const outdated = selected.filter((engine) => versions.get(engine) !== ENGINES[engine].package.split("==")[1]);
    if (outdated.length) {
      return { ready: false, text: `${names} installed. Apply changes to update ${outdated.map((engine) => ENGINES[engine].name).join(", ")}.` };
    }
    const selectedAddons = (Object.keys(ADDONS) as Addon[]).filter((addon) => this.plugin.settings.addons[addon]);
    const unappliedAddons = selectedAddons.filter((addon) => !this.plugin.settings.installedAddons?.includes(addon));
    if (this.plugin.settings.engines.markitdown && unappliedAddons.length) {
      return { ready: false, text: `${names} installed. Apply changes to add ${unappliedAddons.map((addon) => ADDONS[addon]).join(", ")}.` };
    }
    return { ready: true, text: `Ready: Python ${python.version} · ${names}` };
  }

  private acquireLock(): () => void {
    const path = join(this.appDirectory, "install.lock");
    mkdirSync(this.appDirectory, { recursive: true });
    try {
      mkdirSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - statSync(path).mtimeMs < 25 * 60_000) {
        throw new Error("Another SourceDown vault is applying converter changes. Wait for it to finish, then try again.", { cause: error });
      }
      rmSync(path, { recursive: true, force: true });
      mkdirSync(path);
    }
    return () => rmSync(path, { recursive: true, force: true });
  }

  private async findPython(): Promise<string> {
    const found = await this.detectPython();
    if (!found) throw new SetupError("Python 3.10 or newer was not found. Install Python, then click Apply changes again.", true);
    this.plugin.settings.pythonCommand = found.command;
    await this.plugin.saveData(this.plugin.settings);
    return found.command;
  }

  private async ensureVenv(python: string, progress: (message: string) => void): Promise<void> {
    if (!existsSync(this.venvDirectory)) {
      await exec(python, ["-m", "venv", this.venvDirectory], { timeout: 120_000 });
      return;
    }
    try {
      await exec(this.venvPython, [...SUPPORTED_PYTHON_CHECK], { timeout: 10_000 });
    } catch {
      progress("Existing environment is unsupported or incomplete. Rebuilding it…");
      rmSync(this.venvDirectory, { recursive: true, force: true });
      await exec(python, ["-m", "venv", this.venvDirectory], { timeout: 120_000 });
    }
  }

  private async setInstalledSelections(addons: Addon[], engines: ConversionEngine[]): Promise<void> {
    this.plugin.settings.installedAddons = addons;
    this.plugin.settings.installedEngines = engines;
    mkdirSync(this.appDirectory, { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ installedAddons: addons, installedEngines: engines }, null, 2)}\n`);
    renameSync(temporary, this.stateFile);
    await this.plugin.saveData(this.plugin.settings);
  }
}
