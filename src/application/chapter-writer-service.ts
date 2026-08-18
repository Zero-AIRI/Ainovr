import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { ChapterContextManifestService, WriterContextManifest } from "@/application/chapter-context-manifest-service";
import type { LocalCreationService, LocalCreationDraft } from "@/application/local-creation-service";
import type { TaskRecord } from "@/application/task-runner";

export interface ChapterWriterDraft {
  documentId: string;
  projectId: string;
  chapterId: string;
  manifestId: string;
  title: string;
  text: string;
  model: string;
  taskId: string;
  revision: "v1";
}

export interface ChapterWriterService {
  start(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    taskId: string;
    documentId: string;
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
  getDraft(input: { documentId: string }): Promise<ChapterWriterDraft | null>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

/**
 * Writer V1 的受控入口：调用前只读取 frozen ContextManifest，调用后仅留下
 * 可审阅草稿，绝不自行触碰 Canon、ReaderState 或正式 ProductionCommit。
 */
export function createChapterWriterService(options: {
  local: LocalCreationService;
  manifests: Pick<ChapterContextManifestService, "get">;
}): ChapterWriterService {
  return {
    async start(input) {
      const manifest = await options.manifests.get({ projectId: input.projectId, manifestId: input.manifestId });
      assertWriterManifest(manifest, input.projectId, input.chapterId, input.manifestId);
      if (input.documentId !== `production:chapter_draft:${input.chapterId}:v1`) throw new Error("Writer V1 必须写入当前章节的受控 V1 草稿文档。 ");
      const prompt = writerPrompt(manifest);
      return options.local.start({
        command: input.command,
        taskId: input.taskId,
        documentId: input.documentId,
        projectId: input.projectId,
        title: input.title,
        prompt,
        baseURL: input.baseURL,
        model: input.model,
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        metadata: { schema_version: 1, kind: "chapter_writer_draft", chapterId: input.chapterId, manifestId: input.manifestId, revision: "v1" },
      });
    },

    run(taskId) {
      return options.local.run(taskId);
    },

    cancel(taskId) {
      return options.local.cancel(taskId);
    },

    async getDraft(input) {
      const draft = await options.local.getDraft(input.documentId);
      return draft ? chapterDraft(draft) : null;
    },

    getTask(taskId) {
      return options.local.getTask(taskId);
    },
  };
}

function writerPrompt(manifest: WriterContextManifest): string {
  return [
    "你是 Ainovr 的 Writer V1。只依据下列已冻结的原创 ContextManifest 写出本章完整正文。",
    "不得解释工作过程，不得复述设定，不得输出标题、Markdown、JSON 或评审意见。",
    "不得增添与契约矛盾的核心规则；必须完成 ChapterContract 的状态推进、压力、转折和下一章接口。",
    "只输出正文。正文必须完整收束在一个可审阅的场景边界，不能因篇幅在句中截断。",
    "<AINOVR_CONTEXT_MANIFEST>",
    JSON.stringify(manifest),
    "</AINOVR_CONTEXT_MANIFEST>",
  ].join("\n");
}

function assertWriterManifest(manifest: WriterContextManifest | null, projectId: string, chapterId: string, manifestId: string): asserts manifest is WriterContextManifest {
  if (!manifest || manifest.schema_version !== 1 || manifest.kind !== "chapter_context_manifest" || manifest.taskRole !== "writer" || manifest.projectId !== projectId || manifest.chapterId !== chapterId || manifest.manifestId !== manifestId || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0) throw new Error("Writer ContextManifest 不存在或不属于目标章节。 ");
  const expected = ["chapter_contract", "story_contract_and_system", "canon_and_character", "recent_accepted_text", "reader_state_and_promises", "creative_recipe"];
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== expected.length || manifest.layers.some((layer, index) => layer.name !== expected[index])) throw new Error("Writer ContextManifest 缺少六层上下文。 ");
  const recipe = manifest.layers[5]?.value;
  const serialized = JSON.stringify(recipe);
  if (/"(?:source|provenance|evidence|span|analysisProjectId)"/i.test(serialized)) throw new Error("Writer ContextManifest 含来源侧字段。 ");
}

function chapterDraft(draft: LocalCreationDraft): ChapterWriterDraft | null {
  const metadata = draft.metadata;
  if (!metadata || metadata.schema_version !== 1 || metadata.kind !== "chapter_writer_draft" || metadata.revision !== "v1" || typeof metadata.chapterId !== "string" || !metadata.chapterId.trim() || typeof metadata.manifestId !== "string" || !metadata.manifestId.trim()) return null;
  return {
    documentId: draft.documentId,
    projectId: draft.projectId,
    chapterId: metadata.chapterId,
    manifestId: metadata.manifestId,
    title: draft.title,
    text: draft.text,
    model: draft.model,
    taskId: draft.taskId,
    revision: "v1",
  };
}
