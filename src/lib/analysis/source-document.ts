import type {
  CorpusBoundary,
  SourceDocument,
  SourceSpan,
  SourceSpanKind,
} from "./types";
import { SOURCE_NORMALIZATION_VERSION } from "./normalization";

const CHAPTER_HEADING = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回卷部篇集幕](?:[\s·:：]+.*)?|序\s*[章幕](?:\s+.*)?|楔子(?:\s+.*)?|引子(?:\s+.*)?|尾\s*声(?:\s+.*)?|后记(?:\s+.*)?)$/;
const SEPARATOR = /^[※＊*·•—–_=-]{3,}$/;
const TERMINAL_PUNCTUATION = /[。！？!?；;，,：:]$/;

export async function createSourceDocument(input: {
  sourceId: string;
  title: string;
  text: string;
  boundary: CorpusBoundary;
}): Promise<SourceDocument> {
  const sourceHash = await sha256(input.text);
  const analysisVersion = await sha256(
    [sourceHash, SOURCE_NORMALIZATION_VERSION, input.boundary].join(":"),
  );
  const spans = indexSourceSpans(input.text);

  return {
    schemaVersion: 1,
    sourceId: input.sourceId,
    title: input.title,
    boundary: input.boundary,
    sourceHash,
    normalizationVersion: SOURCE_NORMALIZATION_VERSION,
    analysisVersion,
    originalText: input.text,
    spans,
  };
}

function indexSourceSpans(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let chapterIndex = 0;
  let sectionIndex = 0;
  let previousWasSeparator = false;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text)) !== null) {
    const rawLine = match[0];
    if (rawLine.length === 0) break;
    const withoutEnding = rawLine.replace(/(?:\r\n|\r|\n)$/, "");
    const leftTrimmed = withoutEnding.replace(/^\s+/, "");
    const content = leftTrimmed.replace(/\s+$/, "");
    if (!content) {
      previousWasSeparator = false;
      continue;
    }

    const leading = withoutEnding.length - leftTrimmed.length;
    const startOffset = match.index + leading;
    const endOffset = startOffset + content.length;
    const kind = classifySpan(content, previousWasSeparator);

    if (kind === "chapter_heading") {
      chapterIndex += 1;
      sectionIndex = 0;
    } else if (kind === "separator") {
      sectionIndex += 1;
    } else if (kind === "section_heading" && !previousWasSeparator) {
      sectionIndex += 1;
    }

    const ordinal = spans.length + 1;
    spans.push({
      // spanId 只需在 immutable source/version 内唯一。短 ID 显著降低模型抄写错误；
      // sourceHash 由 document/artifact envelope 负责跨文档隔离。
      id: `sp${String(ordinal).padStart(5, "0")}`,
      kind,
      text: text.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      position: text.length > 0 ? (startOffset + endOffset) / 2 / text.length : 0.5,
      ordinal,
      chapterIndex,
      sectionIndex,
    });

    previousWasSeparator = kind === "separator";
  }

  return spans;
}

function classifySpan(text: string, previousWasSeparator: boolean): SourceSpanKind {
  if (CHAPTER_HEADING.test(text)) return "chapter_heading";
  if (SEPARATOR.test(text)) return "separator";
  const looksLikeHeading =
    text.length <= 16 &&
    !TERMINAL_PUNCTUATION.test(text) &&
    !/^[“"'「『]/.test(text);
  if (previousWasSeparator || looksLikeHeading) return "section_heading";
  return "paragraph";
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
