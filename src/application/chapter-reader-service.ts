import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { ChapterReaderContextManifest, ChapterReaderKind } from "@/application/chapter-reader-manifest-service";
import type { LocalCreationOutputValidationInput, LocalCreationService } from "@/application/local-creation-service";
import type { TaskRecord } from "@/application/task-runner";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const READER_KINDS = ["immersive", "low_patience", "logic_sensitive"] as const;
const SEVERITIES = ["blocker", "major", "minor"] as const;
type RecordValue = Record<string, unknown>;

export interface ChapterReaderIssue {
  id: string;
  severity: typeof SEVERITIES[number];
  message: string;
  startByte: number;
  endByte: number;
  quote: string;
}

export interface ChapterReaderFeedback {
  schema_version: 1;
  kind: "chapter_reader_feedback";
  reportId: string;
  projectId: string;
  chapterId: string;
  manifestId: string;
  draftDocumentId: string;
  draftRevision: "v1" | "v2" | "v3";
  readerKind: ChapterReaderKind;
  issues: ChapterReaderIssue[];
}

export interface ChapterReaderService {
  start(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    taskId: string;
    documentId: string;
    reportId: string;
    projectId: string;
    chapterId: string;
    manifestId: string;
    title: string;
    baseURL: string;
    model: string;
    maxTokens?: number;
  }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  getReport(input: { documentId: string }): Promise<ChapterReaderFeedback | null>;
}

/**
 * Reader 是三个独立、可恢复的本机任务。它只把冻结 Reader Manifest 送入模型，
 * 输出在 LocalCreation 提交前通过 validateChapterReaderOutput 严格校验。
 */
export function createChapterReaderService(options: {
  local: LocalCreationService;
  manifests: Pick<{ get(input: { projectId: string; manifestId: string }): Promise<ChapterReaderContextManifest | null> }, "get">;
}): ChapterReaderService {
  return {
    async start(input) {
      const manifest = await options.manifests.get({ projectId: input.projectId, manifestId: input.manifestId });
      assertManifest(manifest, input.projectId, input.chapterId, input.manifestId);
      return options.local.start({
        command: input.command,
        taskId: input.taskId,
        documentId: input.documentId,
        projectId: input.projectId,
        title: input.title,
        prompt: readerPrompt(manifest, input.reportId),
        baseURL: input.baseURL,
        model: input.model,
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        outputMode: "structured_json",
        metadata: {
          schema_version: 1,
          kind: "chapter_reader_feedback",
          reportId: input.reportId,
          chapterId: input.chapterId,
          manifestId: input.manifestId,
          readerKind: manifest.readerKind,
          draftDocumentId: manifest.draft.documentId,
          draftRevision: manifest.draft.revision,
        },
      });
    },

    run(taskId) { return options.local.run(taskId); },
    cancel(taskId) { return options.local.cancel(taskId); },
    getTask(taskId) { return options.local.getTask(taskId); },

    async getReport(input) {
      const draft = await options.local.getDraft(input.documentId);
      if (!draft) return null;
      const metadata = recordValue(draft.metadata);
      if (!metadata || metadata.schema_version !== 1 || metadata.kind !== "chapter_reader_feedback") return null;
      const projectId = requiredString(metadata, "projectId", draft.projectId);
      const manifestId = requiredString(metadata, "manifestId");
      const manifest = await options.manifests.get({ projectId, manifestId });
      assertManifest(manifest, projectId, requiredString(metadata, "chapterId"), manifestId);
      const feedback = parseFeedback(draft.text);
      assertFeedbackMatches(feedback, manifest, requiredString(metadata, "reportId"));
      return normaliseFeedbackRanges(feedback, manifest.draft.text);
    },
  };
}

/** LocalCreation 的可注入钩子：在事务性草稿提交之前阻断无效 Reader JSON。 */
export function validateChapterReaderOutput(input: LocalCreationOutputValidationInput, text: string): void {
  const metadata = recordValue(input.metadata);
  if (!metadata || metadata.kind !== "chapter_reader_feedback") throw new Error("Reader 任务缺少受控 metadata。 ");
  const manifest = manifestFromPrompt(input.prompt);
  assertManifest(manifest, input.projectId, requiredString(metadata, "chapterId"), requiredString(metadata, "manifestId"));
  const feedback = parseFeedback(text);
  assertFeedbackMatches(feedback, manifest, requiredString(metadata, "reportId"));
  normaliseFeedbackRanges(feedback, manifest.draft.text);
}

function readerPrompt(manifest: ChapterReaderContextManifest, reportId: string): string {
  const focus = manifest.readerKind === "immersive"
    ? "从沉浸体验、情绪投入和期待是否被打断的角度诊断。"
    : manifest.readerKind === "low_patience"
      ? "从信息冗余、节奏拖滞和继续阅读动机的角度诊断。"
      : "从可见因果、事实一致性和行动逻辑的角度诊断。";
  return [
    `你是 Ainovr 的${readerLabel(manifest.readerKind)}。${focus}`,
    "只能依据下方冻结上下文阅读本次正文。不得评价作者意图，不得根据正文外信息推断，也不得输出赞美、评分、Markdown 或解释文字。",
    "只输出一个严格 JSON 对象。issues 可以为空；每个问题都必须给出正文规范 UTF-8 的半开字节区间 [startByte,endByte) 和完全一致的 quote。",
    "JSON 字段固定为：schema_version、kind、reportId、projectId、chapterId、manifestId、draftDocumentId、draftRevision、readerKind、issues；issue 字段固定为 id、severity、message、startByte、endByte、quote；severity 只能为 blocker、major 或 minor。",
    "请从以下骨架开始填充；不得改名、遗漏或增加字段：",
    JSON.stringify({ schema_version: 1, kind: "chapter_reader_feedback", reportId, projectId: manifest.projectId, chapterId: manifest.chapterId, manifestId: manifest.manifestId, draftDocumentId: manifest.draft.documentId, draftRevision: manifest.draft.revision, readerKind: manifest.readerKind, issues: [] }),
    "若发现问题，issues 内的每一项必须完整形如：{\"id\":\"issue_001\",\"severity\":\"minor\",\"message\":\"可执行的问题描述\",\"startByte\":12,\"endByte\":18,\"quote\":\"正文原样引文\"}。若没有问题，必须输出 issues: []，不能输出不完整对象。",
    "<AINOVR_READER_MANIFEST>",
    JSON.stringify(manifest),
    "</AINOVR_READER_MANIFEST>",
  ].join("\n");
}

function manifestFromPrompt(prompt: string): ChapterReaderContextManifest {
  const start = "<AINOVR_READER_MANIFEST>\n";
  const end = "\n</AINOVR_READER_MANIFEST>";
  const startIndex = prompt.indexOf(start);
  const endIndex = prompt.lastIndexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error("Reader 任务 Prompt 缺少冻结 Manifest。 ");
  try {
    const parsed = JSON.parse(prompt.slice(startIndex + start.length, endIndex));
    if (!recordValue(parsed)) throw new Error();
    return parsed as ChapterReaderContextManifest;
  } catch { throw new Error("Reader 任务 Prompt 的 Manifest 无效。 "); }
}

function parseFeedback(text: string): ChapterReaderFeedback {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Reader 输出必须是 JSON 对象。 "); }
  const value = recordValue(parsed);
  if (!value) throw new Error("Reader 输出必须是 JSON 对象。 ");
  const allowed = new Set(["schema_version", "kind", "reportId", "projectId", "chapterId", "manifestId", "draftDocumentId", "draftRevision", "readerKind", "issues"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Reader 输出包含赞美、评分或未定义字段。 ");
  if (value.schema_version !== 1 || value.kind !== "chapter_reader_feedback") throw new Error("Reader 输出 schema 无效。 ");
  const draftRevision = value.draftRevision;
  if (draftRevision !== "v1" && draftRevision !== "v2" && draftRevision !== "v3") throw new Error("Reader draftRevision 非法。 ");
  const readerKind = value.readerKind;
  if (!isReaderKind(readerKind)) throw new Error("Reader 类型非法。 ");
  return {
    schema_version: 1,
    kind: "chapter_reader_feedback",
    reportId: requiredString(value, "reportId"),
    projectId: requiredString(value, "projectId"),
    chapterId: requiredString(value, "chapterId"),
    manifestId: requiredString(value, "manifestId"),
    draftDocumentId: requiredString(value, "draftDocumentId"),
    draftRevision,
    readerKind,
    issues: feedbackIssues(value.issues),
  };
}

function feedbackIssues(value: unknown): ChapterReaderIssue[] {
  if (!Array.isArray(value)) throw new Error("Reader issues 必须是数组。 ");
  const issues = value.map((item, index) => {
    const issue = recordValue(item);
    if (!issue) throw new Error(`Reader issues[${index}] 必须是对象。`);
    const allowed = new Set(["id", "severity", "message", "startByte", "endByte", "quote"]);
    if (Object.keys(issue).some((key) => !allowed.has(key))) throw new Error("Reader 问题包含未定义字段。 ");
    const severity = issue.severity;
    if (!(SEVERITIES as readonly string[]).includes(severity as string)) throw new Error("Reader 问题严重度非法。 ");
    return { id: requiredString(issue, "id"), severity: severity as ChapterReaderIssue["severity"], message: requiredString(issue, "message"), startByte: Number.isInteger(issue.startByte) ? issue.startByte as number : -1, endByte: Number.isInteger(issue.endByte) ? issue.endByte as number : -1, quote: requiredString(issue, "quote") };
  });
  if (new Set(issues.map((issue) => issue.id)).size !== issues.length) throw new Error("Reader 问题 id 不可重复。 ");
  return issues;
}

function assertFeedbackMatches(feedback: ChapterReaderFeedback, manifest: ChapterReaderContextManifest, reportId: string): void {
  if (feedback.reportId !== reportId || feedback.projectId !== manifest.projectId || feedback.chapterId !== manifest.chapterId || feedback.manifestId !== manifest.manifestId || feedback.draftDocumentId !== manifest.draft.documentId || feedback.draftRevision !== manifest.draft.revision || feedback.readerKind !== manifest.readerKind) throw new Error("Reader 输出与冻结 Manifest 不匹配。 ");
}

function assertManifest(manifest: ChapterReaderContextManifest | null, projectId: string, chapterId: string, manifestId: string): asserts manifest is ChapterReaderContextManifest {
  if (!manifest || manifest.schema_version !== 1 || manifest.kind !== "chapter_reader_context_manifest" || manifest.projectId !== projectId || manifest.chapterId !== chapterId || manifest.manifestId !== manifestId || !isReaderKind(manifest.readerKind) || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0 || !manifest.draft?.text?.trim()) throw new Error("Reader Manifest 不存在、不属于目标章节或不完整。 ");
}

function normaliseFeedbackRanges(feedback: ChapterReaderFeedback, text: string): ChapterReaderFeedback {
  return { ...feedback, issues: feedback.issues.map((issue) => normaliseIssueRange(issue, text)) };
}

function normaliseIssueRange(issue: ChapterReaderIssue, text: string): ChapterReaderIssue {
  const bytes = encoder.encode(text);
  const boundaries = utf8Boundaries(text);
  if (isExactRange(issue, bytes, boundaries)) return issue;
  const matches = quoteRanges(text, issue.quote);
  if (matches.length === 1) {
    return { ...issue, startByte: matches[0]!.startByte, endByte: matches[0]!.endByte };
  }
  throw new Error("Reader 问题的 UTF-8 区间无效，且 quote 无法唯一定位。 ");
}

function isExactRange(issue: ChapterReaderIssue, bytes: Uint8Array, boundaries: Set<number>): boolean {
  return issue.startByte >= 0
    && issue.endByte > issue.startByte
    && issue.endByte <= bytes.length
    && boundaries.has(issue.startByte)
    && boundaries.has(issue.endByte)
    && decoder.decode(bytes.slice(issue.startByte, issue.endByte)) === issue.quote;
}

function quoteRanges(text: string, quote: string): Array<{ startByte: number; endByte: number }> {
  if (!quote) return [];
  const result: Array<{ startByte: number; endByte: number }> = [];
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    const startByte = encoder.encode(text.slice(0, index)).length;
    result.push({ startByte, endByte: startByte + encoder.encode(quote).length });
    from = index + quote.length;
  }
  return result;
}

function utf8Boundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const character of text) { offset += encoder.encode(character).length; boundaries.add(offset); }
  return boundaries;
}

function readerLabel(kind: ChapterReaderKind): string {
  return kind === "immersive" ? "沉浸型 Reader" : kind === "low_patience" ? "低耐心 Reader" : "逻辑敏感 Reader";
}

function isReaderKind(value: unknown): value is ChapterReaderKind {
  return typeof value === "string" && (READER_KINDS as readonly string[]).includes(value);
}

function requiredString(record: RecordValue, key: string, fallback?: string): string {
  const value = record[key] ?? fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  return value;
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}
