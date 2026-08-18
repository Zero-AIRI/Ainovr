import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { ChapterContextManifestService, WriterContextManifest } from "@/application/chapter-context-manifest-service";
import type { LocalCreationService } from "@/application/local-creation-service";
import type { AdoptedMechanismSnapshot } from "@/application/mechanism-asset-service";
import type { MechanismEffectExperimentService, MechanismEffectPair, MechanismEffectRouteSnapshot } from "@/application/mechanism-effect-experiment-service";
import type { ResolvedModelRoute } from "@/application/model-resolver";
import type { TaskRecord } from "@/application/task-runner";

/**
 * P6 Writer 只从同一已冻结 Writer ContextManifest 派生一对输入：五个公共层完全复用，
 * creative_recipe 层仅在 writerMechanisms 的空集/单张已采纳卡之间变化。
 */
export interface MechanismEffectExperimentWriterService {
  start(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    experimentId: string;
    pairId: string;
    candidateId: string;
    sourceManifestId: string;
    taskId: string;
    title: string;
  }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

export function createMechanismEffectExperimentWriterService(options: {
  experiments: Pick<MechanismEffectExperimentService, "getExecutionPlan">;
  manifests: Pick<ChapterContextManifestService, "get">;
  mechanisms: Pick<{ listAdoptedSnapshots(projectId: string): Promise<AdoptedMechanismSnapshot[]> }, "listAdoptedSnapshots">;
  local: LocalCreationService;
}): MechanismEffectExperimentWriterService {
  return {
    async start(input) {
      requireText(input.projectId, "projectId");
      requireText(input.experimentId, "experimentId");
      requireText(input.pairId, "pairId");
      requireText(input.candidateId, "candidateId");
      requireText(input.sourceManifestId, "sourceManifestId");
      requireText(input.taskId, "taskId");
      requireText(input.title, "title");
      const experiment = await options.experiments.getExecutionPlan({ projectId: input.projectId, experimentId: input.experimentId });
      if (!experiment || experiment.state !== "prepared") throw new Error("机制效用实验不存在、已过期或不再处于 prepared 状态。 ");
      const pair = experiment.pairs.find((item) => item.pairId === input.pairId);
      if (!pair) throw new Error("机制效用实验配对不存在。 ");
      const candidate = pair.candidates.find((item) => item.candidateId === input.candidateId);
      if (!candidate) throw new Error("机制效用实验匿名候选不存在。 ");
      const mapping = experiment.blindMapping.find((item) => item.pairId === pair.pairId);
      if (!mapping || (mapping.baselineCandidateId !== candidate.candidateId && mapping.treatedCandidateId !== candidate.candidateId)) throw new Error("匿名候选不属于已冻结盲映射。 ");
      if (input.sourceManifestId !== pair.sourceManifestId) throw new Error("实验 Writer 必须使用实验配对冻结的 ContextManifest。 ");
      const source = await options.manifests.get({ projectId: input.projectId, manifestId: input.sourceManifestId });
      if (!source || source.chapterId !== pair.chapterId || source.taskRole !== "writer") throw new Error("实验 Writer 必须使用同一 ChapterContract 的已冻结 ContextManifest。 ");
      const adopted = await options.mechanisms.listAdoptedSnapshots(input.projectId);
      const mechanism = adopted.find((item) => item.card.id === experiment.mechanismAssetId);
      if (!mechanism || mechanism.revision !== experiment.mechanismRevision || !mechanism.card.targetLayers.includes("draft")) throw new Error("实验方法卡不再是当前项目可供 Writer 使用的已采纳卡。 ");
      assertPairRoute(pair, experiment.protocol);
      const manifest = pairedManifest(source, experiment.experimentId, pair, mechanism, candidate.candidateId === mapping.treatedCandidateId);
      return options.local.start({
        command: input.command,
        taskId: input.taskId,
        documentId: candidate.draftDocumentId,
        projectId: input.projectId,
        title: input.title,
        prompt: writerPrompt(manifest),
        baseURL: pair.routeSnapshot.baseURL,
        model: pair.routeSnapshot.model,
        frozenRoute: frozenWriterRoute(pair.routeSnapshot),
        maxTokens: experiment.protocol.maxOutputTokens,
        metadata: { schema_version: 1, kind: "mechanism_effect_experiment_draft", modelRole: "writer", experimentId: experiment.experimentId, pairId: pair.pairId, candidateId: candidate.candidateId, sourceManifestId: input.sourceManifestId },
      });
    },
    run(taskId) { return options.local.run(taskId); },
    cancel(taskId) { return options.local.cancel(taskId); },
    getTask(taskId) { return options.local.getTask(taskId); },
  };
}

function pairedManifest(source: WriterContextManifest, experimentId: string, pair: MechanismEffectPair, mechanism: AdoptedMechanismSnapshot, treated: boolean): WriterContextManifest {
  const manifest = structuredClone(source);
  manifest.manifestId = `experiment:${experimentId}:${pair.pairId}`;
  const recipeLayer = manifest.layers.find((layer) => layer.name === "creative_recipe");
  if (!recipeLayer || !isRecord(recipeLayer.value)) throw new Error("源 Writer ContextManifest 缺少 CreativeRecipe。 ");
  const sourceRecipe = recipeLayer.value;
  recipeLayer.value = {
    ...sourceRecipe,
    applicationId: null,
    applicationRevision: null,
    mechanismAssetId: treated ? mechanism.card.id : null,
    mechanismRevision: treated ? mechanism.revision : null,
    writerMechanisms: treated ? [mechanism.card] : [],
    editorMechanisms: [],
  };
  return manifest;
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

function assertPairRoute(pair: MechanismEffectPair, protocol: { contextBudgetTokens: number; maxOutputTokens: number }): void {
  if (pair.routeSnapshot.maxOutputTokens !== protocol.maxOutputTokens || protocol.contextBudgetTokens > pair.routeSnapshot.contextWindowTokens || protocol.maxOutputTokens >= protocol.contextBudgetTokens) throw new Error("实验配对的冻结模型预算与实验协议不一致。 ");
}

function frozenWriterRoute(snapshot: MechanismEffectRouteSnapshot): ResolvedModelRoute {
  return { role: "writer", providerProfileId: snapshot.providerProfileId, baseURL: snapshot.baseURL, model: snapshot.model, protocol: snapshot.protocol, contextWindowTokens: snapshot.contextWindowTokens, maxOutputTokens: snapshot.maxOutputTokens, safetyMarginRatio: snapshot.safetyMarginRatio, isCloud: !isLoopback(snapshot.baseURL), cloudEscalation: "always" };
}

function isLoopback(baseURL: string): boolean { try { const host = new URL(baseURL).hostname; return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; } catch { throw new Error("实验冻结路由 baseURL 无效。 "); } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function requireText(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `); }
