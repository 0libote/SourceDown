import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile("src/output.ts", "utf8");
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Buffer });
const { numberedPath, processMarkdown } = module.exports;

const result = processMarkdown("Before\n\n![Chart](data:image/png;base64,aGVsbG8=)\n\nAfter", "/tmp/report.pdf", "report");
assert.match(result.markdown, /^---\nsource: "\/tmp\/report\.pdf"/);
assert.match(result.markdown, /!\[Chart\]\(report-assets\/image-001\.png\)/);
assert.equal(result.images[0].bytes.toString(), "hello");
assert.equal(numberedPath("Imports", "report", 2), "Imports/report-2.md");
