export function pythonCandidates(configured: string, platform: NodeJS.Platform): string[] {
  const common =
    platform === "win32"
      ? ["py", "python", "python3"]
      : [
          "python3",
          "python",
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          ...["3.14", "3.13", "3.12", "3.11", "3.10"].map(
            (version) => `/Library/Frameworks/Python.framework/Versions/${version}/bin/python3`,
          ),
        ];
  return [...new Set([configured.trim(), ...common].filter(Boolean))];
}
