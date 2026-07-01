export const ENGINES = {
  markitdown: {
    name: "MarkItDown",
    description: "Default general converter.",
    helper: "Best default for general file conversion.",
    package: "markitdown",
    executable: "markitdown",
  },
  docling: {
    name: "Docling",
    description: "Optional multi-format converter with strong PDF layout, OCR, tables, images, Office, email, EPUB, audio, and structured export support.",
    helper: "Try for complex PDFs, scanned documents, tables, images, Office files, emails, EPUB, audio, or when structured output may help.",
    package: "docling",
    executable: "docling",
  },
  marker: {
    name: "Marker",
    description: "Optional advanced converter for PDFs, images, Office files, HTML, EPUB, tables, forms, equations, and technical documents.",
    helper: "Try for PDFs, images, Office files, HTML, EPUB, equations, forms, tables, extracted images, or technical documents.",
    package: "marker-pdf[full]",
    executable: "marker_single",
  },
} as const;

export type ConversionEngine = keyof typeof ENGINES;

export function recommendationForFile(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "PDF: MarkItDown is a good default; try Docling for layout, tables, columns, scans, OCR, or images; try Marker for equations, forms, tables, images, or technical documents.";
  if (["docx", "pptx", "xlsx", "html", "epub"].includes(extension ?? "")) return "MarkItDown is the default; Docling or Marker may preserve complex document structure better.";
  if (["png", "jpg", "jpeg", "tiff", "bmp", "webp"].includes(extension ?? "")) return "Try Docling or Marker when this image needs OCR or layout-aware conversion.";
  return "MarkItDown is recommended for this file type.";
}
