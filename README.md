# SourceDown

Import complex documents and other sources into Obsidian using [Microsoft MarkItDown](https://github.com/microsoft/markitdown).

## Use

1. Enable **SourceDown** in Obsidian's Community plugins settings.
2. Open **SourceDown settings** and choose **Install / update**.
3. Choose files from the ribbon panel, paste a URL, or right-click a vault file.

Converted notes include source metadata. Embedded images are saved beside the note in an asset folder, and duplicate imports receive numbered filenames.

MarkItDown requires Python 3.10+. The plugin installs it into its own local app data virtual environment. On Windows this is `%LOCALAPPDATA%\SourceDown\.venv`; it does not modify your global Python packages or store the environment inside your vault.

## Develop

```sh
npm install
npm test
npm run check
npm run deploy
```

Dependabot checks the Obsidian build dependencies weekly.
