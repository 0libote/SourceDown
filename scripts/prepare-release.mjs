import { readFile, writeFile } from "node:fs/promises";

const version = process.env.RELEASE_VERSION?.trim();
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Tag must be a semver version, optionally prefixed with v. Got: ${version ?? "<missing>"}`);
}

let changed = false;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = await readFile(path, "utf8");
  if (current !== next) {
    await writeFile(path, next);
    changed = true;
  }
};

const manifest = await readJson("manifest.json");
const packageJson = await readJson("package.json");
const versions = await readJson("versions.json");

manifest.version = version;
packageJson.version = version;
versions[version] = manifest.minAppVersion;

await Promise.all([
  writeJson("manifest.json", manifest),
  writeJson("package.json", packageJson),
  writeJson("versions.json", versions),
]);

if (process.env.GITHUB_OUTPUT) {
  await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
}

console.log(`Release files prepared for ${version}; changed=${changed}.`);
