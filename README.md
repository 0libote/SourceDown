# SourceDown

Import complex documents and other sources into Obsidian using [Microsoft MarkItDown](https://github.com/microsoft/markitdown), with optional [Docling](https://github.com/docling-project/docling) and [Marker](https://github.com/datalab-to/marker) converters.

SourceDown converts PDFs, Office documents, Outlook messages, images, audio, web pages, YouTube transcripts, archives, and text-based formats into Markdown notes.

## Features

- Import files from the ribbon or your computer.
- Convert vault attachments from the right-click menu.
- Import YouTube links when transcript support is enabled.
- Save embedded images beside the generated note.
- Preserve the source and conversion time in note properties.
- Keep duplicate imports by giving them numbered filenames.
- Choose a converter per file and see simple file-type recommendations.
- Record the selected conversion engine in note properties.

## Install

SourceDown is available from the [Obsidian Community plugins marketplace](https://community.obsidian.md/plugins/sourcedown).

1. Open **Settings → Community plugins → Browse**.
2. Search for **SourceDown**, then choose **Install** and **Enable**.
3. Open **SourceDown settings** and choose **Install / update**.

SourceDown requires Obsidian 1.5 or newer, the desktop app, and Python 3.10 or newer.

## Use

Choose files from the ribbon panel, paste a URL, or right-click a vault file.

Converted notes include source metadata. Embedded images are saved beside the note in an asset folder, and duplicate imports receive numbered filenames.

MarkItDown is the default and best general choice. Docling can help with complex layouts, OCR, tables, and scanned documents; Marker can help with equations, forms, images, tables, and technical documents.

Conversion engines and optional MarkItDown format support can be selected in SourceDown settings. Docling and Marker are disabled by default. Choose **Install / update** after changing selections.

## Local installation

The plugin installs selected converters into a private virtual environment. On Windows this is `%LOCALAPPDATA%\SourceDown\.venv`; it does not modify global Python packages or store the environment inside your vault. The installation and selections are shared between vaults.

Docling and Marker are substantially larger than MarkItDown and may download models when first used. Marker model licensing has additional terms; review the [Marker repository](https://github.com/datalab-to/marker) before enabling it.

Local files are converted on your computer. Importing a URL or YouTube transcript requires network access to that source.

## Develop

```sh
npm install
npm test
npm run check
npm run deploy
```

Dependabot checks the Obsidian build dependencies weekly.
