declare module "electron" {
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
  export const webUtils: {
    getPathForFile(file: File): string;
  };
}
