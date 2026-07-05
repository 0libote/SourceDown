import { shell } from "electron";
import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type SourceDownPlugin from "./main";
import { type ConversionEngine, ENGINES } from "./engines";
import { type Addon, ADDONS } from "./settings";

export class SourceDownSettingTab extends PluginSettingTab {
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

    const status = new Setting(this.containerEl).setName("Installed converters").setDesc("Checking locally…");
    status.settingEl.addClass("sourcedown-status");
    status.addButton((button) => button.setButtonText("Refresh").onClick(() => void this.refreshStatus(status)));
    const installer = new Setting(this.containerEl).setName("Apply converter selection");
    status.settingEl.remove();
    installer.settingEl.remove();
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
    installer.settingEl.addClass("sourcedown-install");
    installer.addButton((button) =>
      button.setButtonText("Apply changes").setCta().onClick(async () => {
        button.setDisabled(true).setButtonText("Installing…");
        try {
          await this.plugin.installOrUpdate((message) => installer.setDesc(message));
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
    this.containerEl.append(installer.settingEl, status.settingEl);
    this.updateInstallState(installer);

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
    new Setting(advancedContent)
      .setName("MarkItDown format support")
      .setDesc("PDF, DOCX, PPTX, and XLSX are enabled by default. Other formats are opt-in. Apply changes after editing.");
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
