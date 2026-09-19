// Runs the PDF and Word readers in a worker thread with a heap limit and a timeout (extract.ts): a
// hostile file can then only kill this worker, never the API process. Plain JavaScript on purpose, so it
// loads the same way under tsx, vitest and plain Node. It only parses; extract.ts turns the result into text.
import { parentPort, workerData } from "node:worker_threads";

/** Pages read from a PDF; a brief is a few pages, and each page is work pdf.js has to do. */
const MAX_PDF_PAGES = 30;

async function readPdf(bytes) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    const pages = [];
    const count = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= count; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(
        content.items
          .filter((item) => item.str != null)
          .map((item) => {
            const [, , c, d, e, f] = item.transform;
            return { str: item.str, x: e, y: f, width: item.width, height: item.height, fontSize: Math.hypot(c, d) };
          }),
      );
    }
    return { kind: "pdf", pages };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function readDocx(bytes) {
  const mammoth = (await import("mammoth")).default;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    // HTML keeps Word's automatic list numbering and table rows, which plain raw text loses.
    const { value } = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    return { kind: "html", html: value };
  } catch {
    return { kind: "raw", text: (await mammoth.extractRawText({ buffer })).value };
  }
}

const { kind, bytes } = workerData;
(kind === "pdf" ? readPdf(bytes) : readDocx(bytes)).then(
  (result) => parentPort.postMessage({ ok: true, result }),
  () => parentPort.postMessage({ ok: false }),
);
