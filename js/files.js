// Read uploaded files. PDFs can go to Claude as-is; DOCX and PDF text
// extraction libraries are loaded only when first needed.

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.13.0/mammoth.browser.min.js";

export const ACCEPTED = ".pdf,.docx,.txt,.md";

export function kindOf(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return "text";
  return "unsupported";
}

export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let mammothPromise;
function loadMammoth() {
  mammothPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MAMMOTH;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error("Could not load the Word reader. Check your internet connection."));
    document.head.appendChild(s);
  });
  return mammothPromise;
}

let pdfPromise;
async function loadPdfJs() {
  pdfPromise ??= import(PDFJS).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfPromise;
}

export async function extractText(file) {
  const kind = kindOf(file);
  if (kind === "text") return file.text();
  if (kind === "docx") {
    const mammoth = await loadMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }
  if (kind === "pdf") {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => it.str).join(" "));
    }
    return pages.join("\n\n");
  }
  throw new Error(`${file.name}: unsupported file type. Use PDF, DOCX, TXT or MD.`);
}

// Build a Claude content block for a CV file.
export async function cvContentBlock(file) {
  if (kindOf(file) === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: await readAsBase64(file) },
      title: file.name,
    };
  }
  const text = await extractText(file);
  return { type: "text", text: `<cv filename="${file.name}">\n${text}\n</cv>` };
}
