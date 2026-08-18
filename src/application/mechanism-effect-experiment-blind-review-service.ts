import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { ChapterContextManifestService, WriterContextManifest } from "@/application/chapter-context-manifest-service";
import type { LocalCreationDraft, LocalCreationService } from "@/application/local-creation-service";
import type { LocalCreationOutputValidationInput } from "@/application/local-creation-service";
import type { MechanismEffectExperimentService, MechanismEffectAssessment } from "@/application/mechanism-effect-experiment-service";
import type { ResolvedModelRoute } from "@/application/model-resolver";
import type { TaskRecord } from "@/application/task-runner";

const RISK_LEVELS = ["none", "minor", "major", "blocker"] as const;
type RiskLevel = typeof RISK_LEVELS[number];

export interface MechanismEffectExperimentBlindReview {
  schema_version: 1;
  kind: "mechanism_effect_experiment_blind_review";
  experimentId: string;
  pairId: string;
  structuredTargetEffect: string | "tie" | "inconclusive";
  candidateRisks: MechanismEffectAssessment["candidateRisks"];
  sourceLeakageCandidateIds: string[];
}

export interface MechanismEffectExperimentBlindReviewService {
  start(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; experimentId: string; pairId: string; sourceManifestId: string; taskId: string; documentId: string; title: string }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  getReport(input: { documentId: string }): Promise<MechanismEffectExperimentBlindReview | null>;
}

/** 独立盲评只读取同一章的 ChapterContract、目标信号和两份匿名正文。 */
export function createMechanismEffectExperimentBlindReviewService(options: {
  experiments: Pick<MechanismEffectExperimentService, "getExecutionPlan">;
  manifests: Pick<ChapterContextManifestService, "get">;
  drafts: Pick<LocalCreationService, "getDraft">;
  local: LocalCreationService;
}): MechanismEffectExperimentBlindReviewService {
  return {
    async start(input) {
      assertText(input.projectId, "projectId"); assertText(input.experimentId, "experimentId"); assertText(input.pairId, "pairId"); assertText(input.sourceManifestId, "sourceManifestId"); assertText(input.taskId, "taskId"); assertText(input.documentId, "documentId"); assertText(input.title, "title");
      const experiment = await options.experiments.getExecutionPlan({ projectId: input.projectId, experimentId: input.experimentId });
      if (!experiment || experiment.state !== "prepared") throw new Error("盲评只能读取当前 prepared 机制效用实验。 ");
      const pair = experiment.pairs.find((item) => item.pairId === input.pairId);
      if (!pair) throw new Error("实验配对不存在。 ");
      if (input.sourceManifestId !== pair.sourceManifestId) throw new Error("盲评必须使用实验配对冻结的 ContextManifest。 ");
      const manifest = await options.manifests.get({ projectId: input.projectId, manifestId: input.sourceManifestId });
      if (!manifest || manifest.chapterId !== pair.chapterId) throw new Error("盲评必须使用同一 ChapterContract 的冻结 ContextManifest。 ");
      const candidates = await Promise.all(pair.candidates.map(async (candidate) => {
        const draft = await options.drafts.getDraft(candidate.draftDocumentId);
        assertCandidateDraft(draft, input.projectId, experiment.experimentId, pair.pairId, candidate.candidateId, candidate.draftArtifactRevision);
        return { candidateId: candidate.candidateId, text: draft.text };
      }));
      const blindManifest = { schema_version: 1, kind: "blind_chapter_pair_review", experimentId: experiment.experimentId, pairId: pair.pairId, chapterContract: chapterContract(manifest), targetSignals: [...pair.targetSignals], candidates };
      return options.local.start({
        command: input.command, taskId: input.taskId, documentId: input.documentId, projectId: input.projectId, title: input.title,
        prompt: blindPrompt(blindManifest), baseURL: pair.routeSnapshot.baseURL, model: pair.routeSnapshot.model, frozenRoute: reviewerRoute(pair.routeSnapshot), maxTokens: Math.min(pair.routeSnapshot.maxOutputTokens, experiment.protocol.maxOutputTokens), outputMode: "structured_json",
        metadata: { schema_version: 1, kind: "mechanism_effect_experiment_blind_review", modelRole: "reviewer", experimentId: experiment.experimentId, pairId: pair.pairId, candidateIds: pair.candidates.map((candidate) => candidate.candidateId) },
      });
    },
    run(taskId) { return options.local.run(taskId); },
    cancel(taskId) { return options.local.cancel(taskId); },
    getTask(taskId) { return options.local.getTask(taskId); },
    async getReport(input) {
      const draft = await options.local.getDraft(input.documentId);
      if (!draft) return null;
      const metadata = record(draft.metadata);
      if (!metadata || metadata.kind !== "mechanism_effect_experiment_blind_review" || typeof metadata.experimentId !== "string" || typeof metadata.pairId !== "string" || !Array.isArray(metadata.candidateIds) || metadata.candidateIds.some((item) => typeof item !== "string")) return null;
      return parseMechanismEffectExperimentBlindReview(draft.text, { experimentId: metadata.experimentId, pairId: metadata.pairId, candidateIds: metadata.candidateIds as string[] });
    },
  };
}

export function parseMechanismEffectExperimentBlindReview(raw: string, input: { experimentId: string; pairId: string; candidateIds: [string, string] | string[] }): MechanismEffectExperimentBlindReview {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("盲评输出必须是 JSON 对象。 "); }
  const value = requiredRecord(parsed, "盲评输出");
  const allowed = new Set(["schema_version", "kind", "experimentId", "pairId", "structuredTargetEffect", "candidateRisks", "sourceLeakageCandidateIds"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("盲评输出包含未定义字段或 A/B 映射。 ");
  if (value.schema_version !== 1 || value.kind !== "mechanism_effect_experiment_blind_review" || value.experimentId !== input.experimentId || value.pairId !== input.pairId) throw new Error("盲评输出与冻结实验配对不匹配。 ");
  const ids = uniqueIds(input.candidateIds);
  const structuredTargetEffect = decision(value.structuredTargetEffect, ids);
  const candidateRisks = risks(value.candidateRisks, ids);
  const sourceLeakageCandidateIds = strings(value.sourceLeakageCandidateIds, "sourceLeakageCandidateIds");
  if (sourceLeakageCandidateIds.some((id) => !ids.includes(id))) throw new Error("来源泄漏只能标记本组匿名候选。 ");
  return { schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: input.experimentId, pairId: input.pairId, structuredTargetEffect, candidateRisks, sourceLeakageCandidateIds };
}

/** LocalCreation 的结构化输出闸门：无效匿名盲评绝不提交为可读取草稿。 */
export function validateMechanismEffectExperimentBlindReviewOutput(input: LocalCreationOutputValidationInput, text: string): void {
  const metadata = record(input.metadata);
  if (!metadata || metadata.kind !== "mechanism_effect_experiment_blind_review" || typeof metadata.experimentId !== "string" || typeof metadata.pairId !== "string" || !Array.isArray(metadata.candidateIds) || metadata.candidateIds.some((item) => typeof item !== "string")) throw new Error("盲评任务缺少受控匿名 metadata。 ");
  parseMechanismEffectExperimentBlindReview(text, { experimentId: metadata.experimentId, pairId: metadata.pairId, candidateIds: metadata.candidateIds as string[] });
}

function blindPrompt(manifest: Record<string, unknown>): string {
  return [
    "你是独立匿名章节盲评者。只依据下方冻结材料比较两份候选正文；不得推测候选来源、写作方法或作者意图。",
    "只输出严格 JSON，不输出 Markdown、评分、赞美或额外解释。目标效果只能选择一个匿名 candidateId、tie 或 inconclusive。四类风险只可为 none、minor、major、blocker。来源泄漏仅在候选正文直接出现来源身份、人物、剧情或原文时标记该 candidateId。",
    "JSON 字段固定为 schema_version、kind、experimentId、pairId、structuredTargetEffect、candidateRisks、sourceLeakageCandidateIds；candidateRisks 必须恰好覆盖两份匿名候选，每项字段固定为 candidateId、chapterContract、continuity、originality、readability。",
    "<AINOVR_BLIND_REVIEW_MANIFEST>", JSON.stringify(manifest), "</AINOVR_BLIND_REVIEW_MANIFEST>",
    "以下是必须原样保留固定 ID 和字段的 JSON 输出骨架。只填写 structuredTargetEffect、四项风险和 sourceLeakageCandidateIds；不得删除、改写或补充字段。",
    "<AINOVR_BLIND_REVIEW_OUTPUT_SKELETON>", JSON.stringify(blindReviewOutputSkeleton(manifest)), "</AINOVR_BLIND_REVIEW_OUTPUT_SKELETON>",
  ].join("\n");
}

function blindReviewOutputSkeleton(manifest: Record<string, unknown>): Record<string, unknown> {
  const candidates = Array.isArray(manifest.candidates) ? manifest.candidates : [];
  return {
    schema_version: 1,
    kind: "mechanism_effect_experiment_blind_review",
    experimentId: manifest.experimentId,
    pairId: manifest.pairId,
    structuredTargetEffect: candidates[0] && typeof candidates[0] === "object" && !Array.isArray(candidates[0]) ? (candidates[0] as Record<string, unknown>).candidateId : "",
    candidateRisks: candidates.map((candidate) => ({
      candidateId: candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>).candidateId : "",
      chapterContract: "none",
      continuity: "none",
      originality: "none",
      readability: "none",
    })),
    sourceLeakageCandidateIds: [],
  };
}

function chapterContract(manifest: WriterContextManifest): unknown {
  const layer = manifest.layers.find((item) => item.name === "chapter_contract");
  if (!layer) throw new Error("源 ContextManifest 缺少 ChapterContract。 ");
  return structuredClone(layer.value);
}

function assertCandidateDraft(draft: LocalCreationDraft | null, projectId: string, experimentId: string, pairId: string, candidateId: string, expectedRevision: number): asserts draft is LocalCreationDraft {
  const metadata = record(draft?.metadata);
  if (!draft || draft.projectId !== projectId || !draft.text.trim() || !metadata || metadata.kind !== "mechanism_effect_experiment_draft" || metadata.experimentId !== experimentId || metadata.pairId !== pairId || metadata.candidateId !== candidateId) throw new Error("匿名候选正文不存在、已被替换或不属于当前实验配对。 ");
  if (draft.revision !== expectedRevision) throw new Error("匿名候选正文 revision 与冻结实验配对不一致。 ");
}

function reviewerRoute(snapshot: { providerProfileId: string; baseURL: string; model: string; protocol: ResolvedModelRoute["protocol"]; contextWindowTokens: number; maxOutputTokens: number; safetyMarginRatio: number }): ResolvedModelRoute {
  return { role: "reviewer", providerProfileId: snapshot.providerProfileId, baseURL: snapshot.baseURL, model: snapshot.model, protocol: snapshot.protocol, contextWindowTokens: snapshot.contextWindowTokens, maxOutputTokens: snapshot.maxOutputTokens, safetyMarginRatio: snapshot.safetyMarginRatio, isCloud: !loopback(snapshot.baseURL), cloudEscalation: "always" };
}

function risks(value: unknown, ids: string[]) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error("盲评 candidateRisks 必须恰好覆盖两份匿名候选。 ");
  const output = value.map((item) => {
    const risk = requiredRecord(item, "candidateRisks"); const candidateId = text(risk.candidateId, "candidateRisks.candidateId");
    if (!ids.includes(candidateId)) throw new Error("盲评风险必须引用本组匿名候选。 ");
    const level = (name: "chapterContract" | "continuity" | "originality" | "readability") => { const value = risk[name]; if (!(RISK_LEVELS as readonly string[]).includes(value as string)) throw new Error(`candidateRisks.${name} 风险级别非法。 `); return value as RiskLevel; };
    return { candidateId, chapterContract: level("chapterContract"), continuity: level("continuity"), originality: level("originality"), readability: level("readability") };
  });
  if (new Set(output.map((item) => item.candidateId)).size !== 2) throw new Error("盲评风险必须逐一覆盖匿名候选。 ");
  return output;
}

function decision(value: unknown, ids: string[]): string | "tie" | "inconclusive" { if (value === "tie" || value === "inconclusive") return value; if (typeof value !== "string" || !ids.includes(value)) throw new Error("structuredTargetEffect 必须为本组匿名候选、tie 或 inconclusive。 "); return value; }
function uniqueIds(value: readonly string[]): string[] { const result = strings(value, "candidateIds"); if (result.length !== 2) throw new Error("盲评必须包含两份匿名候选。 "); return result; }
function strings(value: unknown, label: string): string[] { if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。 `); const result = value.map((item) => text(item, label)); if (new Set(result).size !== result.length) throw new Error(`${label} 不可重复。 `); return result; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function requiredRecord(value: unknown, label: string): Record<string, unknown> { const parsed = record(value); if (!parsed) throw new Error(`${label} 必须是对象。 `); return parsed; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。 `); return value; }
function assertText(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `); }
function loopback(baseURL: string): boolean { try { const host = new URL(baseURL).hostname; return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; } catch { throw new Error("盲评冻结路由 baseURL 无效。 "); } }
