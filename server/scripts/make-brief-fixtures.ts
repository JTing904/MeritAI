// Writes the binary brief fixtures (PDF and Word) used by tests/extract.test.ts.
// Run from server/: npx tsx scripts/make-brief-fixtures.ts
// The .txt fixtures next to them are hand-written; these are generated so the tests exercise
// real files (PDF text positions, Word numbering and tables) rather than hand-made bytes.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts } from "pdf-lib";

const OUT = resolve(import.meta.dirname, "../tests/fixtures/briefs");
const FIXED_DATE = new Date("2026-09-01T00:00:00Z");

async function newPdf() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer("MeritAI test fixtures");
  doc.setCreator("MeritAI test fixtures");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

function text(page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 10) {
  page.drawText(s, { x, y, size, font });
}

/** A marking table whose cells are drawn out of reading order (weights first, bottom row first). */
async function scoresTablePdf() {
  const { doc, font, bold } = await newPdf();
  const page = doc.addPage([595, 842]);
  let y = 780;
  text(page, bold, "UNIVERSITI SAINS MALAYSIA", 60, y, 16);
  text(page, font, "School of Computer Sciences", 60, (y -= 22));
  text(page, font, "CPT211 Mobile Application Development", 60, (y -= 16));
  text(page, font, "Group Assignment Brief - Semester 1, 2026/2027", 60, (y -= 16));
  y -= 34;
  text(page, font, "Your group will design and build a mobile app that helps students book study rooms", 60, y);
  text(page, font, "in the library. This assignment contributes 40% of the final grade for CPT211.", 60, (y -= 14));
  y -= 34;
  text(page, bold, "Assessment Components", 60, y, 12);
  y -= 22;
  const header = y;
  const rows: [string, string, string, string][] = [
    ["1", "Project proposal", "10", "CLO1"],
    ["2", "Literature review", "15", "CLO1"],
    ["3", "Mobile app prototype", "35", "CLO2"],
    ["4", "Final report", "25", "CLO3"],
    ["5", "Presentation and demo", "15", "CLO3"],
  ];
  const cols = [60, 110, 300, 420];
  const rowY = (i: number) => header - 16 * (i + 1);
  for (let i = rows.length - 1; i >= 0; i--) text(page, font, rows[i]![2], cols[2]!, rowY(i));
  for (let i = rows.length - 1; i >= 0; i--) text(page, font, rows[i]![1], cols[1]!, rowY(i));
  for (let i = 0; i < rows.length; i++) {
    text(page, font, rows[i]![3], cols[3]!, rowY(i));
    text(page, font, rows[i]![0], cols[0]!, rowY(i));
  }
  ["No.", "Component", "Weightage (%)", "CLO"].forEach((h, k) => text(page, bold, h, cols[k]!, header));
  text(page, bold, "100", cols[2]!, rowY(rows.length));
  text(page, bold, "Total", cols[1]!, rowY(rows.length));
  y = rowY(rows.length) - 34;
  text(page, font, "Late submissions lose 5% of the marks for each day.", 60, y);
  text(page, font, "Grade scale: A 80 - 100, B 65 - 79, C 50 - 64, F below 50.", 60, (y -= 14));
  return doc.save();
}

/** A bulleted task list with a wrapped line, nested sub-items and a page break in the middle. */
async function listPdf() {
  const { doc, font, bold } = await newPdf();
  let page = doc.addPage([595, 842]);
  let y = 780;
  text(page, bold, "Multimedia University", 60, y, 16);
  text(page, font, "FIT2104 Web Programming - Group Project Brief", 60, (y -= 22), 12);
  y -= 34;
  text(page, bold, "Instructions:", 60, y);
  const instructions = [
    "1. Form a group of 4 to 5 members and register on eBwise by Week 2.",
    "2. Submit your work through eBwise before 11:59 pm on the due date.",
    "3. Plagiarism will result in zero marks for the whole group.",
  ];
  for (const s of instructions) text(page, font, s, 60, (y -= 14));
  y -= 34;
  text(page, bold, "Project Tasks", 60, y, 12);
  text(page, font, "Your group is required to:", 60, (y -= 18));
  const bullet = (s: string, x: number) => {
    y -= 14;
    text(page, font, "•", x, y);
    text(page, font, s, x + 12, y);
  };
  bullet("Interview at least three shop owners in Cyberjaya to collect their", 72);
  text(page, font, "requirements for an online ordering website.", 84, (y -= 14));
  bullet("Design the page layouts and the colour scheme in Figma.", 72);
  bullet("Develop the website using PHP and MySQL.", 72);
  y -= 14;
  text(page, font, "–", 96, y);
  text(page, font, "The website must work on mobile phones.", 108, y);
  y -= 14;
  text(page, font, "–", 96, y);
  text(page, font, "Store all orders in the database.", 108, y);

  page = doc.addPage([595, 842]);
  y = 794;
  bullet("Write a technical report that explains the design and the testing.", 72);
  bullet("Present a live demo of the website in Week 13.", 72);
  y -= 34;
  text(page, bold, "Assessment", 60, y, 12);
  text(page, font, "The marking rubric will be released on eBwise in Week 3.", 60, (y -= 18));
  return doc.save();
}

/** A PNG of grey "text lines": what a photographed or scanned brief looks like to the rules. */
function fakeScanPng(width = 480, height = 320): Uint8Array {
  const raw = Buffer.alloc((width + 1) * height);
  for (let r = 0; r < height; r++) {
    raw[r * (width + 1)] = 0;
    const inkRow = r % 24 >= 8 && r % 24 < 16 && r > 30 && r < height - 30;
    for (let c = 0; c < width; c++) {
      const ink = inkRow && c > 40 && c < width - 40 - ((r * 7) % 120) && (c * 13 + r) % 17 > 3;
      raw[r * (width + 1) + 1 + c] = ink ? 40 : 245;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

async function scannedPdf() {
  const { doc, font } = await newPdf();
  const page = doc.addPage([595, 842]);
  const png = await doc.embedPng(fakeScanPng());
  page.drawImage(png, { x: 40, y: 260, width: 515, height: 540 });
  text(page, font, "Page 1 of 1", 270, 40, 9);
  return doc.save();
}

const numbering = {
  config: [
    {
      reference: "numbered",
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2)", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ],
    },
  ],
};

const numbered = (s: string, instance: number) => new Paragraph({ text: s, numbering: { reference: "numbered", level: 0, instance } });
const bulleted = (s: string, level = 0) => new Paragraph({ text: s, bullet: { level } });
const cellRow = (cells: string[]) =>
  new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph(c)], width: { size: 50, type: WidthType.PERCENTAGE } })) });

/** Chinese brief: Word auto-numbering for the requirements and a 评分标准 table with bare numbers. */
async function zhDocx() {
  const doc = new Document({
    creator: "MeritAI test fixtures",
    numbering,
    sections: [
      {
        children: [
          new Paragraph({ text: "思特雅大学 信息技术学院", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("课程：BIT2123 软件工程"),
          new Paragraph("小组项目：社区诊所预约系统"),
          new Paragraph({ text: "一、项目要求", heading: HeadingLevel.HEADING_2 }),
          numbered("访谈诊所职员，整理系统需求。", 1),
          numbered("设计系统界面原型。", 1),
          numbered("开发预约系统，包括病人登记、预约和提醒功能。", 1),
          numbered("撰写测试报告。", 1),
          numbered("期末向讲师展示系统。", 1),
          new Paragraph({ text: "二、评分标准", heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              cellRow(["项目", "分值"]),
              cellRow(["需求分析报告", "15"]),
              cellRow(["系统原型开发", "40"]),
              cellRow(["测试报告", "15"]),
              cellRow(["项目展示", "20"]),
              cellRow(["组会记录", "10"]),
              cellRow(["合计", "100"]),
            ],
          }),
          new Paragraph({ text: "三、注意事项", heading: HeadingLevel.HEADING_2 }),
          bulleted("迟交每天扣 5 分。"),
          bulleted("报告须通过学习平台提交。"),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** English brief: two numbered lists (instructions, tasks) and nested bullets, no scores. */
async function enDocx() {
  const doc = new Document({
    creator: "MeritAI test fixtures",
    numbering,
    sections: [
      {
        children: [
          new Paragraph({ text: "Sunway University", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("PRJ3103 Capstone Project - Phase 1 Brief"),
          new Paragraph({ text: "Instructions", heading: HeadingLevel.HEADING_2 }),
          numbered("Form a group of 4 members and register it with your supervisor.", 1),
          numbered("Submit all documents through eLearn in PDF format.", 1),
          numbered("Plagiarism will be reported to the Academic Integrity Committee.", 1),
          new Paragraph({ text: "Tasks", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("Your group is required to:"),
          numbered("Conduct interviews with at least five potential users.", 2),
          numbered("Write a project proposal with objectives and scope.", 2),
          bulleted("Include a Gantt chart.", 1),
          bulleted("Include a risk register.", 1),
          numbered("Build a clickable prototype of the main screens.", 2),
          numbered("Hold weekly meetings and keep minutes.", 2),
          new Paragraph({ text: "Assessment", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("The marking rubric will be shared in Week 3."),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const files: [string, () => Promise<Uint8Array>][] = [
  ["en-usm-scores-table.pdf", scoresTablePdf],
  ["en-mmu-list-wrapped.pdf", listPdf],
  ["scanned-brief.pdf", scannedPdf],
  ["zh-clinic-brief.docx", zhDocx],
  ["en-capstone-list.docx", enDocx],
];

for (const [name, make] of files) {
  const bytes = await make();
  writeFileSync(resolve(OUT, name), bytes);
  console.log(`wrote ${name} (${bytes.byteLength} bytes)`);
}
