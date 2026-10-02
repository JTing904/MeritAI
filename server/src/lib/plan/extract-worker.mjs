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

/** Slides and sheet rows read from one file (M6 evidence); anything beyond is left out. */
const MAX_SLIDES = 200;
const MAX_ROWS = 5000;

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });

/** The numbered entries under `dir` ("ppt/slides/slide12.xml"), in number order. */
function numbered(zip, dir, stem) {
  const re = new RegExp(`^${dir}/${stem}(\\d+)\\.xml$`);
  return Object.keys(zip.files)
    .map((name) => ({ name, m: re.exec(name) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => x.name);
}

/** PowerPoint: each slide's paragraphs (<a:p>) of text runs (<a:t>), under 「Slide N」. */
async function readPptx(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  for (const [i, name] of numbered(zip, "ppt/slides", "slide").slice(0, MAX_SLIDES).entries()) {
    const xml = await zip.file(name).async("string");
    const paras = [];
    for (const p of xml.split(/<\/a:p>/)) {
      const text = [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => unxml(m[1])).join("");
      if (text.trim()) paras.push(text.trim());
    }
    out.push(`Slide ${i + 1}`, ...paras, "");
  }
  return { kind: "raw", text: out.join("\n") };
}

/** Excel: every sheet's rows as "cell | cell" (shared strings resolved, formulas' cached values). */
async function readXlsx(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const shared = [];
  const sst = zip.file("xl/sharedStrings.xml");
  if (sst) {
    const xml = await sst.async("string");
    for (const si of xml.split(/<\/si>/)) {
      if (!/<si[\s>]/.test(si)) continue;
      shared.push([...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unxml(m[1])).join(""));
    }
  }
  const out = [];
  let rows = 0;
  for (const [i, name] of numbered(zip, "xl/worksheets", "sheet").entries()) {
    if (rows >= MAX_ROWS) break;
    const xml = await zip.file(name).async("string");
    out.push(`Sheet ${i + 1}`);
    for (const row of xml.split(/<\/row>/)) {
      if (rows >= MAX_ROWS) break;
      const cells = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
        const inner = c[2] ?? "";
        let value = "";
        if (type === "inlineStr") value = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unxml(m[1])).join("");
        else {
          const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
          if (v !== undefined) value = type === "s" ? (shared[Number(v)] ?? "") : unxml(v);
        }
        cells.push(value.trim());
      }
      if (cells.some((c) => c)) {
        out.push(cells.join(" | "));
        rows++;
      }
    }
    out.push("");
  }
  return { kind: "raw", text: out.join("\n") };
}

const READERS = { pdf: readPdf, docx: readDocx, pptx: readPptx, xlsx: readXlsx };

const { kind, bytes } = workerData;
READERS[kind](bytes).then(
  (result) => parentPort.postMessage({ ok: true, result }),
  () => parentPort.postMessage({ ok: false }),
);
