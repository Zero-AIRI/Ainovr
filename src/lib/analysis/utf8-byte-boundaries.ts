const encoder = new TextEncoder();

/** 将 JavaScript UTF-16 boundary 映射为 UTF-8 byte boundary；surrogate 中间位置标为 null。 */
export function utf8ByteOffsetsByUtf16Boundary(text: string): Array<number | null> {
  const offsets: Array<number | null> = Array(text.length + 1).fill(null);
  let byteOffset = 0;
  let index = 0;
  offsets[0] = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index)!;
    const width = codePoint > 0xffff ? 2 : 1;
    offsets[index] = byteOffset;
    byteOffset += encoder.encode(String.fromCodePoint(codePoint)).byteLength;
    index += width;
    offsets[index] = byteOffset;
  }
  return offsets;
}

/** 把基于 UTF-16 的 [start,end) 转为源对象可验证的 UTF-8 半开区间。 */
export function utf8RangeAtCharacterBoundaries(text: string, startOffset: number, endOffset: number): { startByte: number; endByte: number } {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset < startOffset || endOffset > text.length) {
    throw new Error("文本偏移范围越界。");
  }
  const offsets = utf8ByteOffsetsByUtf16Boundary(text);
  const startByte = offsets[startOffset];
  const endByte = offsets[endOffset];
  if (startByte === null || endByte === null) throw new Error("文本偏移必须位于 UTF-8 字符边界。");
  return { startByte, endByte };
}
