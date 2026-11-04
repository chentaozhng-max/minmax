/**
 * 文档 → 纯文本。
 *
 * 只负责「把文件变成字」，不负责理解内容。三种格式各用一个库：
 *   PDF   unpdf（pdfjs 的 Node 封装，不依赖 canvas）
 *   DOCX  mammoth（读 document.xml，保留段落）
 *   XLSX  SheetJS（每个工作表转 CSV，题干和选项常被排成两列）
 *
 * 老式 .doc 是二进制格式，mammoth 读不了 —— 明确拒绝，而不是返回空字符串
 * 让用户以为文件是空的。
 */

export type ParsedDocument = {
  text: string;
  kind: "pdf" | "docx" | "xlsx" | "text";
  /** 原始字符数，用于前端提示「只读到 0 个字」这类问题 */
  chars: number;
};

/** 单个文件最多读这么多字，超出的截断 —— 再长模型也吃不下 */
export const MAX_TEXT_CHARS = 120_000;

const TEXT_EXTENSIONS = [".txt", ".md", ".csv"];

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export async function extractDocumentText(file: {
  name: string;
  buffer: Uint8Array;
}): Promise<ParsedDocument> {
  const ext = extensionOf(file.name);
  const buffer = Buffer.from(file.buffer);

  if (!buffer.length) throw new Error("文件是空的");

  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    return finish(result.text, "pdf");
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return finish(result.value, "docx");
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const XLSX = await import("xlsx");
    const book = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const parts: string[] = [];
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) parts.push(`【工作表：${name}】\n${csv}`);
    }
    return finish(parts.join("\n\n"), "xlsx");
  }

  if (TEXT_EXTENSIONS.includes(ext)) {
    return finish(buffer.toString("utf8"), "text");
  }

  if (ext === ".doc") {
    throw new Error("不支持旧版 .doc，请用 Word 另存为 .docx 再上传");
  }

  throw new Error(`不支持的文件类型：${ext || "未知"}（支持 PDF / DOCX / XLSX / TXT）`);
}

function finish(raw: string, kind: ParsedDocument["kind"]): ParsedDocument {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  return { text, kind, chars: text.length };
}
