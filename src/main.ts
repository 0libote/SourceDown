import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { promisify } from "node:util";
import { clipboard, shell, webUtils } from "electron";
import { App, FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { addonForFile, parseImportUrl } from "./formats";
import { ConversionEngine, ENGINES, markdownOutputFor, packageFor, readEngines, recommendationForFile } from "./engines";
import { noteName, numberedPath, processMarkdown } from "./output";
import { pythonCandidates } from "./python";

const exec = promisify(execFile);
const CONVERSION_TIMEOUT = 10 * 60_000;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

const processError = (message: string, code: string): Error => Object.assign(new Error(message), { code });

function runToFile(command: string, args: string[], path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = openSync(path, "w");
    const child = spawn(command, args);
    let bytes = 0;
    let stderr = "";
    let failure: Error | null = null;
    let outputClosed = false;
    const timer = setTimeout(() => {
      failure = processError("Conversion timed out.", "ETIMEDOUT");
      child.kill();
    }, CONVERSION_TIMEOUT);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        failure = processError("Conversion output was too large.", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
        child.kill();
      } else {
        try {
          writeSync(output, chunk);
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          child.kill();
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let closeFailure: Error | null = null;
      if (!outputClosed) {
        outputClosed = true;
        try {
          closeSync(output);
        } catch (error) {
          closeFailure = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (failure || closeFailure) reject(failure ?? closeFailure);
      else if (code) reject(new Error(stderr.trim() || `Converter exited with code ${code}.`));
      else resolve();
    });
  });
}

class SetupError extends Error {
  constructor(message: string, readonly pythonMissing = false) {
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

const ADDONS = {
  "audio-transcription": "Audio transcription",
  docx: "Word (DOCX)",
  outlook: "Outlook messages",
  pdf: "PDF",
  pptx: "PowerPoint (PPTX)",
  xls: "Excel (XLS)",
  xlsx: "Excel (XLSX)",
  "youtube-transcription": "YouTube transcription",
} as const;

type Addon = keyof typeof ADDONS;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isAddon = (value: unknown): value is Addon => typeof value === "string" && value in ADDONS;
const readAddons = (value: unknown): Addon[] | null => {
  if (!Array.isArray(value)) return null;
  const addons: Addon[] = [];
  for (const item of value as unknown[]) {
    if (!isAddon(item)) return null;
    addons.push(item);
  }
  return addons;
};

interface SourceDownSettings {
  pythonCommand: string;
  outputFolder: string;
  addons: Record<Addon, boolean>;
  installedAddons: Addon[] | null;
  engines: Record<ConversionEngine, boolean>;
  installedEngines: ConversionEngine[] | null;
}

const DEFAULT_SETTINGS: SourceDownSettings = {
  pythonCommand: "python3",
  outputFolder: "SourceDown",
  addons: Object.fromEntries(Object.keys(ADDONS).map((addon) => [addon, !addon.startsWith("az-") && addon !== "audio-transcription"])) as Record<Addon, boolean>,
  installedAddons: null,
  engines: { markitdown: true, docling: false, marker: false },
  installedEngines: null,
};

export default class SourceDownPlugin extends Plugin {
  settings: SourceDownSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const saved = isRecord(loaded) ? loaded : {};
    const addons = { ...DEFAULT_SETTINGS.addons };
    if (isRecord(saved.addons)) {
      for (const addon of Object.keys(ADDONS) as Addon[]) {
        if (typeof saved.addons[addon] === "boolean") addons[addon] = saved.addons[addon];
      }
    }
    this.settings = {
      pythonCommand: typeof saved.pythonCommand === "string" ? saved.pythonCommand : DEFAULT_SETTINGS.pythonCommand,
      outputFolder: typeof saved.outputFolder === "string" ? saved.outputFolder : DEFAULT_SETTINGS.outputFolder,
      addons,
      installedAddons: this.readSharedInstalledAddons() ?? readAddons(saved.installedAddons),
      engines: {
        markitdown: isRecord(saved.engines) && typeof saved.engines.markitdown === "boolean" ? saved.engines.markitdown : true,
        docling: isRecord(saved.engines) && typeof saved.engines.docling === "boolean" ? saved.engines.docling : false,
        marker: isRecord(saved.engines) && typeof saved.engines.marker === "boolean" ? saved.engines.marker : false,
      },
      installedEngines: this.readSharedInstalledEngines() ?? readEngines(saved.installedEngines),
    };
    this.addRibbonIcon("file-down", "Open SourceDown", () => this.openConverter());
    this.addCommand({ id: "open-converter", name: "Open converter", callback: () => this.openConverter() });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension === "md") return;
        menu.addItem((item) =>
          item
            .setTitle("Convert to Markdown")
            .setIcon("file-down")
            .onClick(() =>
              new NameModal(this.app, file.basename, `The note will be created beside ${file.name}.`, (name) =>
                this.run(() => this.convertVaultFile(file, name)),
              ).open(),
            ),
        );
      }),
    );
    this.addSettingTab(new SourceDownSettingTab(this.app, this));
  }

  private get appDirectory(): string {
    return join(appDataRoot(), "SourceDown");
  }

  private get sharedStateFile(): string {
    return join(this.appDirectory, "state.json");
  }

  private get venvDirectory(): string {
    return join(this.appDirectory, ".venv");
  }

  private acquireInstallLock(): () => void {
    const path = join(this.appDirectory, "install.lock");
    mkdirSync(this.appDirectory, { recursive: true });
    try {
      mkdirSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - statSync(path).mtimeMs < 25 * 60_000) {
        throw new Error("Another SourceDown vault is applying converter changes. Wait for it to finish, then try again.");
      }
      rmSync(path, { recursive: true, force: true });
      mkdirSync(path);
    }
    return () => rmSync(path, { recursive: true, force: true });
  }

  private get venvPython(): string {
    return join(
      this.venvDirectory,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    );
  }

  private executable(engine: ConversionEngine): string {
    return join(
      this.venvDirectory,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? `${ENGINES[engine].executable}.exe` : ENGINES[engine].executable,
    );
  }

  async installOrUpdate(progress: (message: string) => void): Promise<void> {
    const release = this.acquireInstallLock();
    try {
      const engines = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.settings.engines[engine]);
      if (!engines.length) throw new Error("Enable at least one conversion engine.");
      progress("Looking for Python 3.10 or newer…");
      const python = await this.findPython();
      progress("Creating or reusing the private environment…");
      const addons = (Object.keys(ADDONS) as Addon[]).filter((addon) => this.settings.addons[addon]);
      await this.createOrUpdateVenv(python, progress);
      const packages = engines.map((engine) => packageFor(engine, engine === "markitdown" ? addons : []));
      progress(`Installing ${engines.map((engine) => ENGINES[engine].name).join(", ")}…`);
      await exec(this.venvPython, ["-m", "pip", "install", "--upgrade", ...packages], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 20 * 60_000,
      });
      await this.setInstalledSelections(
        [...new Set([...(this.readSharedInstalledAddons() ?? []), ...addons])],
        [...new Set([...(this.readSharedInstalledEngines() ?? []), ...engines])],
      );
    } finally {
      release();
    }
  }

  private async createOrUpdateVenv(python: string, progress: (message: string) => void): Promise<void> {
    const pyvenvConfig = join(this.venvDirectory, "pyvenv.cfg");
    const create = async (): Promise<void> => {
      await exec(python, ["-m", "venv", this.venvDirectory], { timeout: 120_000 });
    };

    if (!existsSync(this.venvDirectory)) {
      await create();
      return;
    }

    if (!existsSync(pyvenvConfig)) {
      progress("Existing environment is incomplete. Rebuilding it…");
      rmSync(this.venvDirectory, { recursive: true, force: true });
      await create();
      return;
    }

    try {
      await exec(python, ["-m", "venv", "--upgrade", this.venvDirectory], { timeout: 120_000 });
    } catch {
      progress("Existing environment could not be updated. Rebuilding it…");
      rmSync(this.venvDirectory, { recursive: true, force: true });
      await create();
    }
  }

  private readSharedInstalledAddons(): Addon[] | null {
    try {
      const state: unknown = JSON.parse(readFileSync(this.sharedStateFile, "utf8"));
      return isRecord(state) ? readAddons(state.installedAddons) : null;
    } catch {
      return null;
    }
  }

  private readSharedInstalledEngines(): ConversionEngine[] | null {
    try {
      const state: unknown = JSON.parse(readFileSync(this.sharedStateFile, "utf8"));
      return isRecord(state) ? readEngines(state.installedEngines) : null;
    } catch {
      return null;
    }
  }

  private async setInstalledSelections(addons: Addon[], engines: ConversionEngine[]): Promise<void> {
    this.settings.installedAddons = addons;
    this.settings.installedEngines = engines;
    mkdirSync(this.appDirectory, { recursive: true });
    const temporary = `${this.sharedStateFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ installedAddons: addons, installedEngines: engines }, null, 2)}\n`);
    renameSync(temporary, this.sharedStateFile);
    await this.saveData(this.settings);
  }

  private openConverter(): void {
    new ConvertModal(this.app, this).open();
  }

  private async findPython(): Promise<string> {
    const found = await this.detectPython();
    if (found) {
      this.settings.pythonCommand = found.command;
      await this.saveData(this.settings);
      return found.command;
    }
    throw new SetupError("Python 3.10 or newer was not found. Install Python, then click Install / update again.", true);
  }

  private async detectPython(): Promise<{ command: string; version: string } | null> {
    for (const candidate of pythonCandidates(this.settings.pythonCommand, process.platform)) {
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

  addonsChanged(): boolean {
    const selected = (Object.keys(ADDONS) as Addon[]).filter((addon) => this.settings.addons[addon]);
    return this.settings.installedAddons === null || selected.some((addon) => !this.settings.installedAddons?.includes(addon));
  }

  selectionsChanged(): boolean {
    const selected = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.settings.engines[engine]);
    return this.addonsChanged() || this.settings.installedEngines === null ||
      selected.some((engine) => !this.settings.installedEngines?.includes(engine));
  }

  conversionEngines(): ConversionEngine[] {
    return (this.settings.installedEngines ?? ["markitdown"]).filter((engine) => this.settings.engines[engine]);
  }

  async status(): Promise<{ ready: boolean; text: string }> {
    const python = await this.detectPython();
    const selected = (Object.keys(ENGINES) as ConversionEngine[]).filter((engine) => this.settings.engines[engine]);
    if (!selected.length) return { ready: false, text: "Setup required: enable at least one conversion engine." };
    const installed: ConversionEngine[] = [];
    let markitdownVersion: string | null = null;
    for (const engine of selected) {
      try {
        const { stdout, stderr } = await exec(this.executable(engine), [engine === "markitdown" ? "--version" : "--help"]);
        installed.push(engine);
        if (engine === "markitdown") markitdownVersion = `${stdout}${stderr}`.match(/\d+(?:\.\d+)+/)?.[0] ?? "unknown version";
      } catch {
        // Missing engines are reported below.
      }
    }
    const missing = selected.filter((engine) => !installed.includes(engine));
    if (!python && !installed.length) return { ready: false, text: "Setup required: Python 3.10+ and the selected conversion engines were not found." };
    if (missing.length) return { ready: false, text: `Setup required: ${missing.map((engine) => ENGINES[engine].name).join(", ")} ${missing.length === 1 ? "is" : "are"} not installed.` };
    const engineNames = installed.map((engine) =>
      engine === "markitdown" ? `MarkItDown ${markitdownVersion}` : ENGINES[engine].name,
    ).join(", ");
    if (!python) return { ready: false, text: `${engineNames} installed. Python 3.10+ is needed for installs and updates.` };
    const pinnedMarkitdown = ENGINES.markitdown.package.split("==")[1];
    if (markitdownVersion && markitdownVersion !== pinnedMarkitdown) {
      return {
        ready: false,
        text: `${engineNames} installed. SourceDown requires MarkItDown ${pinnedMarkitdown}; apply converter changes.`,
      };
    }
    return { ready: true, text: `Ready: Python ${python.version} · ${engineNames}` };
  }

  async convertVaultFile(file: TFile, name = file.basename, engine: ConversionEngine = "markitdown"): Promise<void> {
    await this.ensureReady(engine, addonForFile(file.name));
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("SourceDown requires a local vault.");
    await this.convert(adapter.getFullPath(file.path), noteName(name), file.parent?.path ?? "", file.path, engine);
  }

  async convertExternalFile(file: File, name: string, engine: ConversionEngine): Promise<void> {
    await this.ensureReady(engine, addonForFile(file.name));
    const source = webUtils.getPathForFile(file);
    if (!source) throw new Error("Obsidian did not provide a local path for this file.");
    await this.convert(source, noteName(name), this.settings.outputFolder, file.name, engine);
  }

  async convertUrl(value: string, name: string): Promise<void> {
    const url = parseImportUrl(value);
    await this.ensureReady("markitdown", url.youtube ? "youtube-transcription" : null);
    await this.convert(url.href, noteName(name), this.settings.outputFolder);
  }

  async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof SetupError) new SetupModal(this.app, error.message, error.pythonMissing).open();
      else new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private async ensureReady(engine: ConversionEngine, addonName: string | null = null): Promise<void> {
    try {
      await exec(this.executable(engine), ["--help"], { timeout: 10_000 });
    } catch {
      const python = await this.detectPython();
      throw new SetupError(
        python
          ? `${ENGINES[engine].name} is not installed. Enable it in SourceDown settings and choose Install / update.`
          : `Python 3.10 or newer was not found. Install Python, then open SourceDown settings and install ${ENGINES[engine].name}.`,
        !python,
      );
    }
    if (engine === "markitdown" && addonName && isAddon(addonName) && !this.settings.installedAddons?.includes(addonName)) {
      throw new SetupError(`${ADDONS[addonName]} is not installed. Enable it in SourceDown settings, then choose Install / update.`);
    }
  }

  private async convert(source: string, name: string, folder: string, sourceLabel = source, engine: ConversionEngine = "markitdown"): Promise<void> {
    const notice = new Notice(`Converting ${source.startsWith("http") ? source : parse(source).base}…`, 0);
    let target: string | null = null;
    try {
      const stdout = await this.convertToMarkdown(source, engine);
      await this.ensureFolder(folder);
      let number = 1;
      let processed = processMarkdown(stdout, sourceLabel, parse(numberedPath(folder, name, number)).name, engine);
      while (!target) {
        const candidate = normalizePath(numberedPath(folder, name, number));
        if (
          await this.app.vault.adapter.exists(candidate) ||
          await this.app.vault.adapter.exists(candidate.replace(/\.md$/i, "-assets"))
        ) {
          number++;
          processed = processMarkdown(stdout, sourceLabel, parse(numberedPath(folder, name, number)).name, engine);
          continue;
        }
        try {
          await this.app.vault.create(candidate, processed.markdown);
          target = candidate;
        } catch (error) {
          if (!(await this.app.vault.adapter.exists(candidate))) throw error;
          number++;
          processed = processMarkdown(stdout, sourceLabel, parse(numberedPath(folder, name, number)).name, engine);
        }
      }
      for (const image of processed.images) {
        await this.ensureFolder(normalizePath(`${folder ? `${folder}/` : ""}${parse(image.path).dir}`));
        const path = normalizePath(`${folder ? `${folder}/` : ""}${image.path}`);
        await this.app.vault.createBinary(path, Uint8Array.from(image.bytes).buffer);
      }
      const file = this.app.vault.getFileByPath(target);
      if (!file) throw new Error(`Could not open created note: ${target}`);
      await this.app.workspace.getLeaf(false).openFile(file);
      notice.setMessage(`Created ${target}`);
      window.setTimeout(() => notice.hide(), 4000);
    } catch (error) {
      notice.hide();
      if (target) {
        const assets = this.app.vault.getAbstractFileByPath(target.replace(/\.md$/i, "-assets"));
        if (assets) await this.app.vault.delete(assets, true);
        const file = this.app.vault.getFileByPath(target);
        if (file) await this.app.vault.delete(file);
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`${ENGINES[engine].name} is not installed. Install it from plugin settings.`);
      }
      if ((error instanceof Error && "killed" in error && error.killed) || (error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        throw new Error(`${ENGINES[engine].name} timed out after 10 minutes. Try a smaller file or another converter.`);
      }
      if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new Error(`${ENGINES[engine].name} produced more than 100 MB of output. Try a smaller file or another converter.`);
      }
      throw error;
    }
  }

  private async convertToMarkdown(source: string, engine: ConversionEngine): Promise<string> {
    if (engine === "markitdown") {
      const output = mkdtempSync(join(tmpdir(), "sourcedown-"));
      const path = join(output, "output.md");
      try {
        await runToFile(this.executable(engine), ["--keep-data-uris", source], path);
        return readFileSync(path, "utf8");
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    }
    const output = mkdtempSync(join(tmpdir(), "sourcedown-"));
    try {
      const args = engine === "docling"
        ? [source, "--to", "markdown", "--image-export-mode", "embedded", "--output", output]
        : [source, "--output_dir", output, "--output_format", "markdown"];
      await exec(this.executable(engine), args, { maxBuffer: MAX_OUTPUT_BYTES, timeout: CONVERSION_TIMEOUT });
      const markdown = markdownOutputFor(readdirSync(output, { recursive: true }).map(String), parse(source).name);
      if (!markdown) throw new Error(`${ENGINES[engine].name} did not produce Markdown output.`);
      const path = join(output, markdown);
      if (statSync(path).size > MAX_OUTPUT_BYTES) {
        throw new Error(`${ENGINES[engine].name} produced more than 100 MB of Markdown. Try a smaller file or another converter.`);
      }
      return readFileSync(path, "utf8");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of normalizePath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
}

class ConvertModal extends Modal {
  constructor(app: App, private plugin: SourceDownPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "SourceDown" });
    this.contentEl.createEl("p", {
      text: `Import into ${this.plugin.settings.outputFolder || "the vault root"} as a Markdown note.`,
    });

    const filePanel = this.contentEl.createDiv("sourcedown-panel");
    const fileField = filePanel.createDiv("sourcedown-field");
    fileField.createEl("label", { text: "Choose a file", attr: { for: "sourcedown-file" } });
    const input = fileField.createEl("input", { type: "file", attr: { id: "sourcedown-file" } });
    const nameField = filePanel.createDiv("sourcedown-field");
    nameField.createEl("label", { text: "Note name", attr: { for: "sourcedown-name" } });
    const name = nameField.createEl("input", { type: "text", attr: { id: "sourcedown-name" } });
    const engineField = filePanel.createDiv("sourcedown-field");
    engineField.createEl("label", { text: "Converter", attr: { for: "sourcedown-engine" } });
    const engine = engineField.createEl("select", { attr: { id: "sourcedown-engine" } });
    const availableEngines = this.plugin.conversionEngines();
    for (const value of availableEngines) {
      engine.createEl("option", { value, text: ENGINES[value].name });
    }
    if (!availableEngines.length) {
      engine.createEl("option", { text: "Set up a converter in settings" });
      engine.disabled = true;
    }
    const helper = engineField.createEl("small");
    const recommendation = engineField.createEl("small");
    const destination = filePanel.createEl("small", { cls: "sourcedown-destination" });
    const convert = filePanel.createEl("button", { text: "Convert file", cls: "mod-cta" });
    convert.disabled = true;
    let convertingFile = false;

    const updateDestination = (): void => {
      convert.disabled = convertingFile || !availableEngines.length || !input.files?.[0] || !name.value.trim();
      destination.setText(`Creates: ${this.plugin.settings.outputFolder ? `${this.plugin.settings.outputFolder}/` : ""}${name.value || "…"}.md`);
    };
    const updateEngineHelp = (): void => {
      const selected = ENGINES[engine.value as ConversionEngine];
      helper.setText(selected?.helper ?? "Open SourceDown settings, choose a converter, and apply the selection.");
      recommendation.setText(input.files?.[0] ? recommendationForFile(input.files[0].name) : "MarkItDown is recommended for most files.");
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) name.value = parse(file.name).name;
      updateDestination();
      updateEngineHelp();
    });
    name.addEventListener("input", updateDestination);
    convert.addEventListener("click", async () => {
      const file = input.files?.[0];
      if (!file || convertingFile) return;
      convertingFile = true;
      updateDestination();
      try {
        await this.plugin.run(() => this.plugin.convertExternalFile(file, name.value, engine.value as ConversionEngine));
      } finally {
        convertingFile = false;
        updateDestination();
      }
    });
    engine.addEventListener("change", updateEngineHelp);
    updateDestination();
    updateEngineHelp();

    const selector = this.contentEl.createDiv("sourcedown-selector");
    this.contentEl.insertBefore(selector, filePanel);
    const fileButton = selector.createEl("button", { text: "File", attr: { "aria-pressed": "true" } });
    const linkButton = selector.createEl("button", { text: "Web link", attr: { "aria-pressed": "false" } });
    const linkPanel = this.contentEl.createDiv("sourcedown-panel");
    linkPanel.hidden = true;
    const row = linkPanel.createDiv("sourcedown-url");
    const url = row.createEl("input", { type: "url", placeholder: "https://example.com", attr: { "aria-label": "Web address" } });
    const urlName = row.createEl("input", { type: "text", placeholder: "Note name", attr: { "aria-label": "Note name" } });
    urlName.value = `web-${Date.now()}`;
    const convertUrl = row.createEl("button", { text: "Convert", cls: "mod-cta" });
    const urlDestination = linkPanel.createEl("small", { cls: "sourcedown-destination" });
    let convertingUrl = false;
    const updateUrlDestination = (): void => {
      convertUrl.disabled = convertingUrl || !url.value.trim() || !urlName.value.trim();
      urlDestination.setText(
        `Creates: ${this.plugin.settings.outputFolder ? `${this.plugin.settings.outputFolder}/` : ""}${urlName.value || "…"}.md`,
      );
    };
    convertUrl.addEventListener("click", async () => {
      if (convertingUrl) return;
      convertingUrl = true;
      updateUrlDestination();
      try {
        await this.plugin.run(() => this.plugin.convertUrl(url.value, urlName.value));
      } finally {
        convertingUrl = false;
        updateUrlDestination();
      }
    });
    url.addEventListener("input", updateUrlDestination);
    urlName.addEventListener("input", updateUrlDestination);
    updateUrlDestination();
    const show = (link: boolean): void => {
      filePanel.hidden = link;
      linkPanel.hidden = !link;
      fileButton.setAttribute("aria-pressed", String(!link));
      linkButton.setAttribute("aria-pressed", String(link));
    };
    fileButton.addEventListener("click", () => show(false));
    linkButton.addEventListener("click", () => show(true));
  }
}

class NameModal extends Modal {
  constructor(
    app: App,
    private initialName: string,
    private description: string,
    private submit: (name: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Choose note name" });
    this.contentEl.createEl("p", { text: this.description });
    const input = this.contentEl.createEl("input", { type: "text", value: this.initialName, cls: "sourcedown-name" });
    const convert = this.contentEl.createEl("button", { text: "Convert", cls: "mod-cta" });
    convert.addEventListener("click", () => {
      void this.submit(input.value);
      this.close();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") convert.click();
    });
    input.focus();
    input.select();
  }
}

class SetupModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private pythonMissing: boolean,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "SourceDown needs setup" });
    this.contentEl.createEl("p", { text: this.message });
    this.contentEl.createEl("button", { text: "Copy error" }).addEventListener("click", () => {
      clipboard.writeText(this.message);
    });
    if (this.pythonMissing) {
      this.contentEl.createEl("button", { text: "Get Python", cls: "mod-cta" }).addEventListener("click", () => {
        void shell.openExternal("https://www.python.org/downloads/");
      });
    }
    this.contentEl.createEl("p", { text: "Then open Settings → Community plugins → SourceDown." });
  }
}

class SourceDownSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SourceDownPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Output folder").setDesc("Converted notes from the SourceDown panel are saved here.").addText((text) =>
      text.setPlaceholder("Vault root").setValue(this.plugin.settings.outputFolder).onChange(async (value) => {
        this.plugin.settings.outputFolder = normalizePath(value).split("/").filter((part) => part && part !== "." && part !== "..").join("/");
        await this.plugin.saveData(this.plugin.settings);
      }),
    );

    new Setting(this.containerEl).setName("Conversion engines").setHeading();
    this.containerEl.createEl("p", {
      text: "Choose the converters you want available, then apply the selection. MarkItDown is the simplest default.",
      cls: "setting-item-description",
    });
    for (const [engine, details] of Object.entries(ENGINES) as Array<[ConversionEngine, (typeof ENGINES)[ConversionEngine]]>) {
      new Setting(this.containerEl)
        .setName(engine === "markitdown" ? "MarkItDown (recommended)" : details.name)
        .setDesc(details.description)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.engines[engine]).onChange(async (value) => {
            this.plugin.settings.engines[engine] = value;
            await this.plugin.saveData(this.plugin.settings);
            this.updateInstallState(installer);
          }),
        );
    }
    const installer = new Setting(this.containerEl).setName("Apply converter selection");
    installer.settingEl.addClass("sourcedown-install");
    installer.addButton((button) =>
      button.setButtonText("Apply changes").setCta().onClick(async () => {
        button.setDisabled(true).setButtonText("Installing…");
        try {
          await this.plugin.installOrUpdate((message) => {
            installer.setDesc(message);
          });
          new Notice("Converter selection applied.");
          await this.refreshStatus(status);
          this.updateInstallState(installer);
        } catch (error) {
          installer.setDesc(error instanceof Error ? error.message : String(error));
          new Notice("Conversion engine installation failed. See settings for details.", 8000);
        } finally {
          button.setDisabled(false).setButtonText("Apply changes");
        }
      }),
    );
    this.updateInstallState(installer);

    const status = new Setting(this.containerEl).setName("Installed converters").setDesc("Checking…");
    status.settingEl.addClass("sourcedown-status");
    status.addButton((button) => button.setButtonText("Refresh").onClick(() => void this.refreshStatus(status)));
    void this.refreshStatus(status);

    const advanced = this.containerEl.createEl("details", { cls: "sourcedown-advanced" });
    advanced.createEl("summary", { text: "Advanced settings" });
    const advancedContent = advanced.createDiv();
    new Setting(advancedContent).setName("Python command").setDesc("Usually no change is needed. SourceDown automatically finds Python 3.10 or newer.").addText((text) =>
      text.setValue(this.plugin.settings.pythonCommand).onChange(async (value) => {
        this.plugin.settings.pythonCommand = value.trim();
        await this.plugin.saveData(this.plugin.settings);
      }),
    ).addButton((button) =>
      button.setButtonText("Get Python").onClick(() => {
        void shell.openExternal("https://www.python.org/downloads/");
      }),
    );
    new Setting(advancedContent).setName("MarkItDown format support").setDesc("Optional packages used only by MarkItDown. Apply converter selection after changing these.");
    for (const [addon, label] of Object.entries(ADDONS) as Array<[Addon, string]>) {
      new Setting(advancedContent).setName(label).addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.addons[addon]).onChange(async (value) => {
          this.plugin.settings.addons[addon] = value;
          await this.plugin.saveData(this.plugin.settings);
          this.updateInstallState(installer);
        }),
      );
    }
  }

  private async refreshStatus(setting: Setting): Promise<void> {
    setting.setDesc("Checking…");
    const status = await this.plugin.status();
    setting.setDesc(status.text);
    setting.settingEl.toggleClass("is-ready", status.ready);
    setting.settingEl.toggleClass("needs-setup", !status.ready);
  }

  private updateInstallState(setting: Setting): void {
    const selected = (Object.keys(ENGINES) as ConversionEngine[])
      .filter((engine) => this.plugin.settings.engines[engine])
      .map((engine) => ENGINES[engine].name);
    setting.setDesc(
      !selected.length
        ? "Choose at least one converter."
        : this.plugin.selectionsChanged()
          ? `Not applied: ${selected.join(", ")}.`
          : `Ready: ${selected.join(", ")}.`,
    );
    setting.settingEl.toggleClass("has-changes", this.plugin.selectionsChanged());
  }
}
