const IMAGE_TYPES: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  bmp: "bmp",
  tiff: "tiff",
  webp: "webp",
};

export function processMarkdown(markdown: string, source: string, noteName: string): {
  markdown: string;
  images: Array<{ path: string; bytes: Buffer }>;
} {
  const images: Array<{ path: string; bytes: Buffer }> = [];
  const body = markdown.replace(
    /!\[([^\]]*)\]\(data:image\/([^;,]+);base64,([A-Za-z0-9+/=\s]+)\)/g,
    (original, alt: string, type: string, data: string) => {
      const extension = IMAGE_TYPES[type.toLowerCase()];
      if (!extension) return original;
      const bytes = Buffer.from(data.replace(/\s/g, ""), "base64");
      if (!bytes.length) return original;
      const path = `${noteName}-assets/image-${String(images.length + 1).padStart(3, "0")}.${extension}`;
      images.push({ path, bytes });
      return `![${alt}](${path})`;
    },
  );
  const frontmatter = `---\nsource: ${JSON.stringify(source)}\nconverted: ${JSON.stringify(new Date().toISOString())}\nconverter: sourcedown\n---\n\n`;
  return { markdown: `${frontmatter}${body.trim()}\n`, images };
}

export function numberedPath(folder: string, name: string, number: number): string {
  return `${folder ? `${folder}/` : ""}${name}${number === 1 ? "" : `-${number}`}.md`;
}

export function noteName(value: string): string {
  const name = value.trim().replace(/\.md$/i, "");
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new Error("Enter a file name without folders.");
  return name;
}
