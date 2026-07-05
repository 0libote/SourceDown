declare module "electron" {
  export const clipboard: {
    writeText(text: string): void;
  };
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
  export const webUtils: {
    getPathForFile(file: File): string;
  };
}
