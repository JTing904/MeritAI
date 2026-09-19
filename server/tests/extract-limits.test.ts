import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { EXTRACT_LIMITS, extractBriefText } from "../src/lib/plan/extract";
import { MAX_ZIP_ENTRIES, zipWithinLimits } from "../src/lib/plan/zip-limits";

// Decompression bombs and runaway files (security audit 2026-09-19): the extractor must answer
// UNREADABLE quickly and the process must survive, whatever the file does.
const FIXTURES = fileURLToPath(new URL("./fixtures/briefs/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

/** A minimal zip (deflated entries) with an honest central directory. */
function zip(entries: { name: string; data: Buffer }[]): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(data), 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    central.push(cd, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cdBytes, end]));
}

const WORD_XML = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

function docx(documentXml: string | Buffer, extra: { name: string; data: Buffer }[] = []): Uint8Array {
  return zip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    { name: "word/document.xml", data: Buffer.isBuffer(documentXml) ? documentXml : Buffer.from(documentXml) },
    ...extra,
  ]);
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function reasonOf(bytes: Uint8Array, name: string) {
  const t0 = performance.now();
  const r = await extractBriefText(bytes, name, "");
  return { result: r.ok ? "ok" : r.reason, ms: performance.now() - t0 };
}

describe("Word decompression bombs", { timeout: 30_000 }, () => {
  it("reads a small generated .docx (the zip writer and the limits accept real files)", async () => {
    const bytes = docx(WORD_XML(para("1. Report (60%)") + para("2. Poster (40%)")));
    expect(zipWithinLimits(bytes)).toBe(true);
    const r = await extractBriefText(bytes, "brief.docx", "");
    expect(r.ok && r.text).toContain("Report (60%)");
    expect(zipWithinLimits(fixture("en-capstone-list.docx"))).toBe(true);
  });

  it("refuses a document that inflates past 20 MB, before mammoth reads it", async () => {
    const body = Buffer.alloc(25 * 1024 * 1024, para("a"));
    const bytes = docx(Buffer.concat([Buffer.from(WORD_XML("").split("</w:body>")[0]!), body, Buffer.from("</w:body></w:document>")]));
    expect(bytes.byteLength).toBeLessThan(200 * 1024);
    const { result, ms } = await reasonOf(bytes, "bomb.docx");
    expect(result).toBe("UNREADABLE");
    expect(ms).toBeLessThan(2000);
  });

  it("refuses an entry that compresses too well, even under 20 MB in total", async () => {
    const bytes = docx(WORD_XML(para("Report")), [{ name: "word/media/blank.bin", data: Buffer.alloc(8 * 1024 * 1024) }]);
    expect(zipWithinLimits(bytes)).toBe(false);
    expect((await reasonOf(bytes, "brief.docx")).result).toBe("UNREADABLE");
  });

  it(`refuses more than ${MAX_ZIP_ENTRIES} entries`, async () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `x/${i}.xml`, data: Buffer.from("<a/>") }));
    const bytes = docx(WORD_XML(para("Report")), many);
    expect(zipWithinLimits(bytes)).toBe(false);
    expect((await reasonOf(bytes, "brief.docx")).result).toBe("UNREADABLE");
  });

  it("refuses a central directory that lies about the sizes", () => {
    const bytes = Buffer.from(docx(Buffer.alloc(25 * 1024 * 1024, para("a"))));
    // Claim 1 KB for every entry, as a bomb would: the real inflate still finds 25 MB.
    let at = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (at >= 0) {
      bytes.writeUInt32LE(1024, at + 24);
      at = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at - 1);
    }
    expect(zipWithinLimits(new Uint8Array(bytes))).toBe(false);
  });

  it("refuses zips it cannot measure (truncated, not a zip)", () => {
    const good = docx(WORD_XML(para("Report")));
    expect(zipWithinLimits(good.subarray(0, good.length - 10))).toBe(false);
    expect(zipWithinLimits(new TextEncoder().encode("PK not really"))).toBe(false);
  });
});

describe("PDF limits", { timeout: 30_000 }, () => {
  it("reads only the first 30 pages", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 35; n++) doc.addPage([400, 300]).drawText(`Section ${n} marker text for page number ${n}`, { x: 40, y: 200, size: 12, font });
    const r = await extractBriefText(await doc.save(), "long.pdf", "application/pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("page number 30");
    expect(r.text).not.toContain("page number 31");
  });
});

describe("the extraction worker", { timeout: 30_000 }, () => {
  const saved = { ...EXTRACT_LIMITS };
  afterEach(() => Object.assign(EXTRACT_LIMITS, saved));

  it("gives up after the time limit and answers UNREADABLE", async () => {
    EXTRACT_LIMITS.timeoutMs = 1;
    expect((await reasonOf(fixture("en-usm-scores-table.pdf"), "brief.pdf")).result).toBe("UNREADABLE");
    expect((await reasonOf(fixture("en-capstone-list.docx"), "brief.docx")).result).toBe("UNREADABLE");
  });

  it("survives a worker that runs out of memory, and the next file still reads", async () => {
    // ~17 MB of text that does not compress well: inside the zip limits, but mammoth needs far more than 64 MB.
    const hex = randomBytes(5.5 * 1024 * 1024).toString("hex");
    const paras: string[] = [];
    for (let i = 0; i < hex.length; i += 64) paras.push(para(hex.slice(i, i + 64)));
    const bytes = docx(WORD_XML(paras.join("")));
    expect(zipWithinLimits(bytes)).toBe(true);
    EXTRACT_LIMITS.heapMb = 64;
    expect((await reasonOf(bytes, "big.docx")).result).toBe("UNREADABLE");
    Object.assign(EXTRACT_LIMITS, saved);
    expect((await reasonOf(fixture("en-usm-scores-table.pdf"), "brief.pdf")).result).toBe("ok");
  });
});
