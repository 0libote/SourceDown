import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile("src/output.ts", "utf8");
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Buffer });
const { noteName, numberedPath, processMarkdown } = module.exports;

const result = processMarkdown("Before\n\n![Chart](data:image/png;base64,aGVsbG8=)\n\nAfter", "/tmp/report.pdf", "report", "docling");
assert.match(result.markdown, /^---\nsource: "\/tmp\/report\.pdf"/);
assert.match(result.markdown, /conversion_engine: docling/);
assert.match(result.markdown, /!\[Chart\]\(report-assets\/image-001\.png\)/);
assert.equal(result.images[0].bytes.toString(), "hello");
assert.equal(numberedPath("Imports", "report", 2), "Imports/report-2.md");
assert.equal(noteName(" Report.md "), "Report");
assert.throws(() => noteName("../Report"), /without folders/);

const pythonSource = await readFile("src/python.ts", "utf8");
const pythonJs = ts.transpile(pythonSource, { module: ts.ModuleKind.CommonJS });
const pythonModule = { exports: {} };
vm.runInNewContext(pythonJs, { module: pythonModule, exports: pythonModule.exports });
const { pythonCandidates } = pythonModule.exports;

assert.deepEqual(
  Array.from(pythonCandidates("python3", "darwin")).slice(0, 3),
  ["python3", "python", "/opt/homebrew/bin/python3"],
);
assert.deepEqual(Array.from(pythonCandidates("C:\\Python312\\python.exe", "win32")), [
  "C:\\Python312\\python.exe",
  "py",
  "python",
  "python3",
]);

const formatsSource = await readFile("src/formats.ts", "utf8");
const formatsJs = ts.transpile(formatsSource, { module: ts.ModuleKind.CommonJS });
const formatsModule = { exports: {} };
vm.runInNewContext(formatsJs, { module: formatsModule, exports: formatsModule.exports, URL });
const { addonForFile, parseImportUrl } = formatsModule.exports;

assert.equal(addonForFile("REPORT.PDF"), "pdf");
assert.equal(addonForFile("notes.txt"), null);
assert.deepEqual({ ...parseImportUrl(" https://example.com/page ") }, { href: "https://example.com/page", youtube: false });
assert.equal(parseImportUrl("https://youtu.be/abc").youtube, true);
assert.equal(parseImportUrl("https://music.youtube.com/watch?v=abc").youtube, true);
assert.equal(parseImportUrl("https://www.youtube-nocookie.com/embed/abc").youtube, true);
assert.equal(parseImportUrl("https://youtube.com.evil.example/watch").youtube, false);
assert.throws(() => parseImportUrl("example.com"), /valid web address/);
assert.throws(() => parseImportUrl("file:///tmp/report"), /HTTP or HTTPS/);

const enginesSource = await readFile("src/engines.ts", "utf8");
const enginesJs = ts.transpile(enginesSource, { module: ts.ModuleKind.CommonJS });
const enginesModule = { exports: {} };
vm.runInNewContext(enginesJs, { module: enginesModule, exports: enginesModule.exports });
const { markdownOutputFor, packageFor, readEngines, recommendationForFile } = enginesModule.exports;

assert.match(recommendationForFile("REPORT.PDF"), /Docling/);
assert.match(recommendationForFile("scan.png"), /OCR/);
assert.match(recommendationForFile("notes.txt"), /MarkItDown/);
assert.deepEqual(Array.from(readEngines(["markitdown", "docling"])), ["markitdown", "docling"]);
assert.equal(readEngines(["unknown"]), null);
assert.equal(markdownOutputFor(["assets/readme.md", "report/report.md"], "report"), "report/report.md");
assert.equal(markdownOutputFor(["only.md"], "report"), "only.md");
assert.throws(() => markdownOutputFor(["one.md", "two.md"], "report"), /Multiple Markdown outputs/);
assert.equal(packageFor("markitdown", ["pdf", "docx"]), "markitdown[pdf,docx]==0.1.6");
assert.equal(packageFor("docling"), "docling==2.108.0");
