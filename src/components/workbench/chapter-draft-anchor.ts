export interface Utf8ByteRange {
  startByte: number;
  endByte: number;
}

export interface DraftAnchorSegments {
  before: string;
  highlighted: string;
  after: string;
}

/**
 * Reviewer 保存的是规范 UTF-8 字节区间；React 字符串则以 UTF-16 索引切片。
 * 这里显式建立字符边界映射，避免中文和代理对 emoji 被错误截断。
 */
export function splitDraftAtUtf8Range(text: string, range: Utf8ByteRange): DraftAnchorSegments | null {
  if (!Number.isInteger(range.startByte) || !Number.isInteger(range.endByte) || range.startByte < 0 || range.endByte <= range.startByte) return null;
  const offsets = new Map<number, number>();
  let byteOffset = 0;
  let utf16Offset = 0;
  offsets.set(byteOffset, utf16Offset);
  for (const character of text) {
    byteOffset += new TextEncoder().encode(character).byteLength;
    utf16Offset += character.length;
    offsets.set(byteOffset, utf16Offset);
  }
  const start = offsets.get(range.startByte);
  const end = offsets.get(range.endByte);
  if (start === undefined || end === undefined) return null;
  return { before: text.slice(0, start), highlighted: text.slice(start, end), after: text.slice(end) };
}
