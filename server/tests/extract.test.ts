import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Extracted, extractBriefText, MAX_BRIEF_BYTES } from "../src/lib/plan/extract";
import { parseBriefWithRules } from "../src/lib/plan/rules";

// Binary fixtures come from scripts/make-brief-fixtures.ts.
const FIXTURES = fileURLToPath(new URL("./fixtures/briefs/", import.meta.url));
const file = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

async function textOf(bytes: Uint8Array, name: string, mime = ""): Promise<string> {
  const r = await extractBriefText(bytes, name, mime);
  if (!r.ok) throw new Error(`expected text from ${name}, got ${r.reason}`);
  return r.text;
}

const reason = async (bytes: Uint8Array, name: string, mime = "") => {
  const r: Extracted = await extractBriefText(bytes, name, mime);
  return r.ok ? "ok" : r.reason;
};

const titles = (text: string) => {
  const r = parseBriefWithRules(text);
  return r.ok ? { method: r.method, tasks: r.tasks.map((t) => [t.title, t.weight, t.kind]) } : { reason: r.reason };
};

// The first PDF and Word reads load pdf.js and mammoth, which can take seconds on a busy machine.
describe("PDF", { timeout: 20_000 }, () => {
  it("rebuilds reading order in a table drawn out of order", async () => {
    const text = await textOf(file("en-usm-scores-table.pdf"), "en-usm-scores-table.pdf", "application/pdf");
    expect(text).toContain("UNIVERSITI SAINS MALAYSIA\nSchool of Computer Sciences");
    expect(text).toMatch(/^No\.\tComponent\tWeightage \(%\)\tCLO$/m);
    expect(text).toMatch(/^1\tProject proposal\t10\tCLO1\n2\tLiterature review\t15\tCLO1$/m);
    expect(text).toMatch(/^\s*Total\t100$/m);
    expect(titles(text)).toEqual({
      method: "SCORES",
      tasks: [
        ["Project proposal", 10, "DOC"],
        ["Literature review", 15, "RESEARCH"],
        ["Mobile app prototype", 35, "CODE"],
        ["Final report", 25, "DOC"],
        ["Presentation and demo", 15, "DESIGN"],
      ],
    });
  });

  it("keeps both pages, indentation and wrapped lines of a list", async () => {
    const text = await textOf(file("en-mmu-list-wrapped.pdf"), "brief.PDF");
    expect(text.indexOf("Present a live demo")).toBeGreaterThan(text.indexOf("Develop the website"));
    expect(text).toMatch(/^ {2,}• Develop the website using PHP and MySQL\.$/m);
    expect(text).toMatch(/^ {4,}– Store all orders in the database\.$/m);
    expect(titles(text)).toEqual({
      method: "LIST",
      tasks: [
        ["Interview at least three shop owners in Cyberjaya to collect their requirements for an online ordering website", 1, "RESEARCH"],
        ["Design the page layouts and the colour scheme in Figma", 1, "DESIGN"],
        ["Develop the website using PHP and MySQL", 1, "CODE"],
        ["Write a technical report that explains the design and the testing", 1, "DOC"],
        ["Present a live demo of the website in Week 13", 1, "DESIGN"],
      ],
    });
  });

  it("reports a scanned PDF (an image with a page number) as unreadable", async () => {
    expect(await reason(file("scanned-brief.pdf"), "scan.pdf", "application/pdf")).toBe("UNREADABLE");
  });

  it("reports a broken PDF as unreadable", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >>\nthis is not really a pdf");
    expect(await reason(broken, "broken.pdf", "application/pdf")).toBe("UNREADABLE");
  });
});

describe("Word .docx", { timeout: 20_000 }, () => {
  it("keeps automatic numbering and turns tables into rows", async () => {
    const text = await textOf(file("zh-clinic-brief.docx"), "zh-clinic-brief.docx");
    expect(text).toContain("1. 访谈诊所职员，整理系统需求。");
    expect(text).toContain("项目 | 分值\n需求分析报告 | 15");
    expect(titles(text)).toEqual({
      method: "SCORES",
      tasks: [
        ["需求分析报告", 15, "DOC"],
        ["系统原型开发", 40, "CODE"],
        ["测试报告", 15, "DOC"],
        ["项目展示", 20, "DESIGN"],
        ["组会记录", 10, "MEETING"],
      ],
    });
  });

  it("keeps nested lists indented and restarts numbering per list", async () => {
    const text = await textOf(file("en-capstone-list.docx"), "brief.docx");
    expect(text).toContain("Instructions\n1. Form a group");
    expect(text).toContain("2. Write a project proposal with objectives and scope.\n  • Include a Gantt chart.");
    expect(titles(text)).toEqual({
      method: "LIST",
      tasks: [
        ["Conduct interviews with at least five potential users", 1, "RESEARCH"],
        ["Write a project proposal with objectives and scope", 1, "DOC"],
        ["Build a clickable prototype of the main screens", 1, "CODE"],
        ["Hold weekly meetings and keep minutes", 1, "MEETING"],
      ],
    });
  });

  it("recognises a .docx by its MIME type or its contents when the name has no extension", async () => {
    const bytes = file("en-capstone-list.docx");
    expect(await reason(bytes, "brief", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("ok");
    expect(await reason(bytes, "brief", "application/octet-stream")).toBe("ok");
  });

  it("reports a broken .docx as unreadable", async () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await reason(broken, "broken.docx")).toBe("UNREADABLE");
  });
});

describe("plain text", () => {
  it("reads UTF-8 .txt and .md files", async () => {
    const bytes = file("zh-mkt201-marketing.txt");
    const text = await textOf(bytes, "brief.txt", "text/plain");
    expect(text.startsWith("南方大学学院")).toBe(true);
    expect(await textOf(bytes, "brief.md")).toBe(text);
    expect(await textOf(bytes, "brief", "text/plain")).toBe(text);
  });

  it("strips a BOM and normalises Windows line endings", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("1. Report (60%)\r\n2. Poster (40%)\r\n")]);
    expect(await textOf(bytes, "brief.txt")).toBe("1. Report (60%)\n2. Poster (40%)");
  });

  it("reads UTF-16 (Notepad 'Unicode') and GBK (Chinese Windows) files", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from("1. 报告（60 分）\n2. 海报（40 分）", "utf16le")]);
    expect(await textOf(utf16, "brief.txt")).toBe("1. 报告（60 分）\n2. 海报（40 分）");
    const gbk = new Uint8Array([0xd7, 0xf7, 0xd2, 0xb5, 0xd2, 0xaa, 0xc7, 0xf3]); // 作业要求
    expect(await textOf(gbk, "brief.txt")).toBe("作业要求");
  });

  it("treats blank files as empty", async () => {
    expect(await reason(new Uint8Array(0), "brief.txt")).toBe("EMPTY");
    expect(await reason(file("blank.txt"), "blank.txt")).toBe("EMPTY");
  });

  it("refuses binary data that only claims to be text", async () => {
    const binary = new Uint8Array(400).map((_, i) => (i % 3 === 0 ? 0 : 65 + (i % 26)));
    expect(await reason(binary, "notes.txt")).toBe("UNSUPPORTED_TYPE");
  });
});

describe("file types and limits", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
  const webp = new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ");
  const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);

  it.each([
    ["photo.png", png],
    ["photo.jpg", jpeg],
    ["photo.jpeg", jpeg],
    ["photo.webp", webp],
    ["IMG_0042.HEIC", heic],
    ["brief.pdf", jpeg],
    ["scan.jpg", new Uint8Array([1, 2, 3])],
  ])("photos are unreadable: %s", async (name, bytes) => {
    expect(await reason(bytes, name)).toBe("UNREADABLE");
  });

  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0]);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

  it.each([
    ["slides.pptx", zip],
    ["sheet.xlsx", zip],
    ["brief.zip", zip],
    ["old.doc", ole],
    ["slides.ppt", ole],
    ["notes.rtf", new TextEncoder().encode("{\\rtf1\\ansi Hello}")],
    ["page.html", new TextEncoder().encode("<html><body>1. Report</body></html>")],
    ["brief.odt", zip],
    ["data", new TextEncoder().encode("1. Report (60%)")],
  ])("other types are unsupported: %s", async (name, bytes) => {
    expect(await reason(bytes, name, "application/octet-stream")).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects files over the size limit before reading them", async () => {
    const big = new Uint8Array(MAX_BRIEF_BYTES + 1).fill(0x41);
    expect(await reason(big, "brief.txt", "text/plain")).toBe("TOO_LARGE");
    expect(await reason(new Uint8Array(MAX_BRIEF_BYTES).fill(0x41), "brief.txt")).toBe("ok");
  });
});
