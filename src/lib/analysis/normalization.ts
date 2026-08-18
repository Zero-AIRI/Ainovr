export const SOURCE_NORMALIZATION_VERSION = "source-normalization-v1";

export type SourceNormalizationKind =
  | "remove_bom"
  | "normalize_crlf"
  | "normalize_cr";

export interface SourceNormalizationTransformation {
  kind: SourceNormalizationKind;
  originalStartOffset: number;
  originalEndOffset: number;
  normalizedOffset: number;
}

/**
 * 原文不可变；该视图只处理会妨碍稳定分段的 BOM 和换行差异。
 * boundary 映射长度始终是 normalizedText.length + 1，可把任意半开区间
 * 精确映回原文半开区间，不做同义替换、空白压缩或“智能清洗”。
 */
export interface NormalizedSourceView {
  version: typeof SOURCE_NORMALIZATION_VERSION;
  text: string;
  originalLength: number;
  originalOffsetByNormalizedBoundary: number[];
  transformations: SourceNormalizationTransformation[];
}

export function createNormalizedSourceView(
  originalText: string,
): NormalizedSourceView {
  let originalOffset = 0;
  let normalizedText = "";
  const transformations: SourceNormalizationTransformation[] = [];
  const originalOffsetByNormalizedBoundary = [0];

  if (originalText.charCodeAt(0) === 0xfeff) {
    transformations.push({
      kind: "remove_bom",
      originalStartOffset: 0,
      originalEndOffset: 1,
      normalizedOffset: 0,
    });
    originalOffset = 1;
    originalOffsetByNormalizedBoundary[0] = 1;
  }

  while (originalOffset < originalText.length) {
    const current = originalText[originalOffset];
    if (current === "\r" && originalText[originalOffset + 1] === "\n") {
      transformations.push({
        kind: "normalize_crlf",
        originalStartOffset: originalOffset,
        originalEndOffset: originalOffset + 2,
        normalizedOffset: normalizedText.length,
      });
      normalizedText += "\n";
      originalOffset += 2;
      originalOffsetByNormalizedBoundary.push(originalOffset);
      continue;
    }
    if (current === "\r") {
      transformations.push({
        kind: "normalize_cr",
        originalStartOffset: originalOffset,
        originalEndOffset: originalOffset + 1,
        normalizedOffset: normalizedText.length,
      });
      normalizedText += "\n";
      originalOffset += 1;
      originalOffsetByNormalizedBoundary.push(originalOffset);
      continue;
    }

    normalizedText += current;
    originalOffset += 1;
    originalOffsetByNormalizedBoundary.push(originalOffset);
  }

  return {
    version: SOURCE_NORMALIZATION_VERSION,
    text: normalizedText,
    originalLength: originalText.length,
    originalOffsetByNormalizedBoundary,
    transformations,
  };
}

export function mapNormalizedRangeToOriginal(
  view: NormalizedSourceView,
  normalizedStartOffset: number,
  normalizedEndOffset: number,
): { startOffset: number; endOffset: number } {
  if (
    !Number.isInteger(normalizedStartOffset) ||
    !Number.isInteger(normalizedEndOffset) ||
    normalizedStartOffset < 0 ||
    normalizedEndOffset < normalizedStartOffset ||
    normalizedEndOffset > view.text.length
  ) {
    throw new Error(
      `规范化范围越界：${normalizedStartOffset}..${normalizedEndOffset} / ${view.text.length}`,
    );
  }

  return {
    startOffset:
      view.originalOffsetByNormalizedBoundary[normalizedStartOffset],
    endOffset: view.originalOffsetByNormalizedBoundary[normalizedEndOffset],
  };
}
