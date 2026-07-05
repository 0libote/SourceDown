import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const targetDir = process.env.SOURCE_DOWN_DEPLOY_DIR ?? process.env.OBSIDIAN_PLUGIN_DIR;

if (!targetDir) {
  throw new Error('Set SOURCE_DOWN_DEPLOY_DIR, for example: SOURCE_DOWN_DEPLOY_DIR="$HOME/.obsidian/plugins/sourcedown" npm run deploy');
}

mkdirSync(targetDir, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  cpSync(join(process.cwd(), file), join(targetDir, file));
}
