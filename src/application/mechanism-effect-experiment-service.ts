import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { AdoptedMechanismSnapshot } from "@/application/mechanism-asset-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";
import { parseMechanismEffectExperimentBlindReview } from "@/application/mechanism-effect-experiment-blind-review-service";

type RecordValue = Record<string, unknown>;
const PROTOCOLS = ["chat_completions", "responses", "ollama_native"] as const;
const RISK_LEVELS = ["none", "minor", "major", "blocker"] as const;

export interface MechanismEffectRouteSnapshot {
  providerProfileId: string;
  baseURL: string;
  model: string;
  protocol: typeof PROTOCOLS[number];
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyMarginRatio: number;
}

export interface MechanismEffectCandidate {
  candidateId: string;
  draftDocumentId: string;
  draftArtifactRevision: number;
  actualInputTokens: number | "unknown";
  actualOutputTokens: number | "unknown";
}

export interface MechanismEffectPair {
  pairId: string;
  chapterId: string;
  chapterContractRevision: number;
  sourceManifestId: string;
  targetSignals: string[];
  routeSnapshot: MechanismEffectRouteSnapshot;
  candidates: [MechanismEffectCandidate, MechanismEffectCandidate];
}

export interface MechanismEffectBlindMapping {
  pairId: string;
  baselineCandidateId: string;
  treatedCandidateId: string;
}

type BlindDecision = string | "tie" | "inconclusive";
type RiskLevel = typeof RISK_LEVELS[number];

export interface MechanismEffectAssessment {
  pairId: string;
  blindReviewDocumentId: string;
  blindReviewArtifactRevision: number;
  structuredTargetEffect: BlindDecision;
  humanBlindDecision: BlindDecision;
  candidateRisks: Array<{
    candidateId: string;
    chapterContract: RiskLevel;
    continuity: RiskLevel;
    originality: RiskLevel;
    readability: RiskLevel;
  }>;
  /** Only anonymous candidate identifiers are accepted; source identity/text never enters this artifact. */
  sourceLeakageCandidateIds: string[];
}

export interface MechanismEffectExperiment {
  schema_version: 1;
  kind: "mechanism_effect_experiment";
  experimentId: string;
  state: "prepared" | "completed";
  mechanismAssetId: string;
  mechanismRevision: number;
  protocol: { contextBudgetTokens: number; maxOutputTokens: number; seed: number | "unknown" };
  pairs: MechanismEffectPair[];
  /** Accepted on save, but deliberately never copied into the readable project-document payload. */
  blindMapping: MechanismEffectBlindMapping[];
  assessments?: MechanismEffectAssessment[];
}

export interface MechanismEffectExperimentSummary {
  verdict: "prepared" | "passed" | "failed" | "inconclusive";
  treatedWins: number;
  alignedPairs: number;
  majorRegressionCount: number;
  sourceLeakageCount: number;
}

export interface MechanismEffectExperimentService {
  save(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; expectedRevision: number | null; experiment: MechanismEffectExperiment }): Promise<CommandResult>;
  get(input: { projectId: string; experimentId: string }): Promise<(Omit<MechanismEffectExperiment, "blindMapping"> & { blindMappingObjectHash: string; experimentDesignObjectHash: string; summary: MechanismEffectExperimentSummary }) | null>;
  /** 仅供受控 P6 Writer 宿主读取；绝不映射到 MCP/CLI 查询工具。 */
  getExecutionPlan(input: { projectId: string; experimentId: string }): Promise<MechanismEffectExperiment | null>;
}

/**
 * P6 的记录层只保存已完成的配对输入、匿名盲评和可复算门槛。它不调用 Writer，
 * 不把 A/B 映射交给 Reader/Reviewer，也不会据此自动改变 MechanismAsset 生命周期。
 */
export function createMechanismEffectExperimentService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  mechanisms: Pick<{ listAdoptedSnapshots(projectId: string): Promise<AdoptedMechanismSnapshot[]> }, "listAdoptedSnapshots">;
}): MechanismEffectExperimentService {
  return {
    async save(input) {
      assertId(input.projectId, "projectId");
      assertExpectedRevision(input.expectedRevision);
      const experiment = parseExperiment(input.experiment);
      const adopted = await options.mechanisms.listAdoptedSnapshots(input.projectId);
      const mechanism = adopted.find((item) => item.card.id === experiment.mechanismAssetId);
      if (!mechanism || mechanism.revision !== experiment.mechanismRevision || !mechanism.card.targetLayers.includes("draft")) {
        throw new Error("机制效用实验只能使用当前项目已采纳、可供 Writer 使用的单张方法卡。 ");
      }
      if (experiment.state === "completed" && input.expectedRevision === null) throw new Error("盲评结果必须在已冻结的 prepared 实验上以当前 revision 提交。 ");

      const designObject = await options.objects.put({
        content: new TextEncoder().encode(JSON.stringify(experimentDesign(experiment))),
        mediaType: "application/vnd.ainovr.mechanism-effect-experiment-design+json",
      });
      const mappingObject = await options.objects.put({
        content: new TextEncoder().encode(JSON.stringify({ schema_version: 1, kind: "mechanism_effect_blind_mapping", experimentId: experiment.experimentId, pairs: experiment.blindMapping })),
        mediaType: "application/vnd.ainovr.mechanism-effect-blind-mapping+json",
      });
      if (experiment.state === "completed") {
        const previous = await currentExperiment(options.driver, input.projectId, experiment.experimentId);
        if (!previous || previous.revision !== input.expectedRevision || previous.state !== "prepared") throw new Error("盲评结果必须基于当前 prepared 实验 revision 提交。 ");
        if (previous.blindMappingObjectHash !== mappingObject.sha256 || previous.experimentDesignObjectHash !== designObject.sha256) throw new Error("completed 实验不得替换已冻结的匿名映射或实验设计。 ");
        await assertBoundBlindReviews(options.driver, options.objects, input.projectId, experiment);
      }
      const summary = summariseMechanismEffectExperiment(experiment);
      const payload = {
        schema_version: 1,
        kind: "mechanism_effect_experiment",
        experimentId: experiment.experimentId,
        state: experiment.state,
        mechanismAssetId: experiment.mechanismAssetId,
        mechanismRevision: experiment.mechanismRevision,
        protocol: experiment.protocol,
        pairs: experiment.pairs,
        ...(experiment.assessments ? { assessments: experiment.assessments } : {}),
        blindMappingObjectHash: mappingObject.sha256,
        experimentDesignObjectHash: designObject.sha256,
        summary,
      };
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(input.expectedRevision === null ? {} : { expectedRevision: input.expectedRevision }),
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: experimentDocumentId(experiment.experimentId),
          documentType: "mechanism_effect_experiment",
          status: experiment.state,
          expectedRevision: input.expectedRevision,
          payload,
          dependencies: [
            { artifactId: `mechanism:${experiment.mechanismAssetId}`, revision: experiment.mechanismRevision },
            ...experiment.pairs.flatMap((pair) => [
              { artifactId: `document:${planningDocumentId(input.projectId, "chapter_contract", pair.chapterId)}`, revision: pair.chapterContractRevision },
              ...(experiment.state === "completed" ? pair.candidates.map((candidate) => ({ artifactId: `document:${candidate.draftDocumentId}`, revision: candidate.draftArtifactRevision })) : []),
            ]),
            ...(experiment.state === "completed" ? (experiment.assessments ?? []).map((assessment) => ({ artifactId: `document:${assessment.blindReviewDocumentId}`, revision: assessment.blindReviewArtifactRevision })) : []),
          ],
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.experimentId, "experimentId");
      const rows = await options.driver.query<{ document_type: string; payload_json: string; stale: number }>({
        sql: `SELECT doc.document_type, revision.payload_json,
                     CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
              FROM project_documents doc
              INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
              INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
              WHERE doc.project_id = ? AND doc.document_id = ?`,
        params: [input.projectId, experimentDocumentId(input.experimentId)],
      });
      const row = rows[0];
      if (!row || row.document_type !== "mechanism_effect_experiment" || row.stale === 1) return null;
      return readableExperiment(parseReadableExperiment(JSON.parse(row.payload_json)));
    },

    async getExecutionPlan(input) {
      assertId(input.projectId, "projectId");
      assertId(input.experimentId, "experimentId");
      const rows = await options.driver.query<{ document_type: string; payload_json: string; stale: number }>({
        sql: `SELECT doc.document_type, revision.payload_json,
                     CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
              FROM project_documents doc
              INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
              INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
              WHERE doc.project_id = ? AND doc.document_id = ?`,
        params: [input.projectId, experimentDocumentId(input.experimentId)],
      });
      const row = rows[0];
      if (!row || row.document_type !== "mechanism_effect_experiment" || row.stale === 1) return null;
      const payload = recordValue(JSON.parse(row.payload_json), "机制效用实验文档");
      const mappingHash = text(payload.blindMappingObjectHash, "blindMappingObjectHash");
      const mapping = recordValue(JSON.parse(new TextDecoder().decode(await options.objects.read(mappingHash))), "盲映射对象");
      if (mapping.schema_version !== 1 || mapping.kind !== "mechanism_effect_blind_mapping" || mapping.experimentId !== input.experimentId || !Array.isArray(mapping.pairs)) throw new Error("盲映射对象与实验不匹配。 ");
      return parseExperiment({ ...payload, blindMapping: mapping.pairs });
    },
  };
}

export function summariseMechanismEffectExperiment(value: unknown): MechanismEffectExperimentSummary {
  const experiment = parseExperiment(value);
  if (experiment.state === "prepared") return { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 };
  const mappings = new Map(experiment.blindMapping.map((mapping) => [mapping.pairId, mapping]));
  let treatedWins = 0;
  let alignedPairs = 0;
  let majorRegressionCount = 0;
  let sourceLeakageCount = 0;
  let unresolved = false;
  let baselineWon = false;
  for (const assessment of experiment.assessments ?? []) {
    const mapping = mappings.get(assessment.pairId)!;
    if (isDirectionalDecision(assessment.structuredTargetEffect) && assessment.structuredTargetEffect === assessment.humanBlindDecision) alignedPairs += 1;
    if (assessment.structuredTargetEffect === mapping.treatedCandidateId) treatedWins += 1;
    if (assessment.structuredTargetEffect === mapping.baselineCandidateId) baselineWon = true;
    if (assessment.structuredTargetEffect === "tie" || assessment.structuredTargetEffect === "inconclusive" || assessment.humanBlindDecision === "tie" || assessment.humanBlindDecision === "inconclusive") unresolved = true;
    sourceLeakageCount += assessment.sourceLeakageCandidateIds.length;
    majorRegressionCount += countTreatedRegressions(assessment, mapping);
  }
  const passed = treatedWins >= 2 && alignedPairs >= 2 && majorRegressionCount === 0 && sourceLeakageCount === 0;
  return { verdict: passed ? "passed" : (sourceLeakageCount > 0 || majorRegressionCount > 0 || baselineWon ? "failed" : (unresolved ? "inconclusive" : "failed")), treatedWins, alignedPairs, majorRegressionCount, sourceLeakageCount };
}

function parseExperiment(value: unknown): MechanismEffectExperiment {
  const record = recordValue(value, "机制效用实验");
  if (record.schema_version !== 1 || record.kind !== "mechanism_effect_experiment") throw new Error("机制效用实验 schema 非法。 ");
  const state = record.state;
  if (state !== "prepared" && state !== "completed") throw new Error("机制效用实验状态非法。 ");
  const experimentId = text(record.experimentId, "experimentId");
  const mechanismAssetId = text(record.mechanismAssetId, "mechanismAssetId");
  const mechanismRevision = positive(record.mechanismRevision, "mechanismRevision");
  const protocol = parseProtocol(record.protocol);
  const pairs = parsePairs(record.pairs);
  const mapping = parseMapping(record.blindMapping, pairs);
  const assessments = record.assessments === undefined ? undefined : parseAssessments(record.assessments, pairs);
  if (state === "prepared" && assessments !== undefined) throw new Error("prepared 实验不得包含盲评结果。 ");
  if (state === "completed" && !assessments) throw new Error("completed 实验必须包含三组匿名盲评。 ");
  return { schema_version: 1, kind: "mechanism_effect_experiment", experimentId, state, mechanismAssetId, mechanismRevision, protocol, pairs, blindMapping: mapping, ...(assessments ? { assessments } : {}) };
}

function parseReadableExperiment(value: unknown): Omit<MechanismEffectExperiment, "blindMapping"> & { blindMappingObjectHash: string; experimentDesignObjectHash: string; summary: MechanismEffectExperimentSummary } {
  const record = recordValue(value, "机制效用实验文档");
  const blindMappingObjectHash = text(record.blindMappingObjectHash, "blindMappingObjectHash");
  const experimentDesignObjectHash = text(record.experimentDesignObjectHash, "experimentDesignObjectHash");
  const summary = recordValue(record.summary, "实验结论");
  const pairs = Array.isArray(record.pairs) ? record.pairs : [];
  const readable = {
    ...record,
    // 仅用于复用严格 payload 校验；此合成映射绝不从 get() 返回。
    blindMapping: pairs.map((pair) => {
      const item = recordValue(pair, "实验配对");
      const candidates = Array.isArray(item.candidates) ? item.candidates : [];
      const first = recordValue(candidates[0], "候选 A");
      const second = recordValue(candidates[1], "候选 B");
      return { pairId: item.pairId, baselineCandidateId: first.candidateId, treatedCandidateId: second.candidateId };
    }),
  };
  const experiment = parseExperiment(readable);
  return { ...experiment, blindMappingObjectHash, experimentDesignObjectHash, summary: { verdict: readVerdict(summary.verdict), treatedWins: nonNegative(summary.treatedWins, "treatedWins"), alignedPairs: nonNegative(summary.alignedPairs, "alignedPairs"), majorRegressionCount: nonNegative(summary.majorRegressionCount, "majorRegressionCount"), sourceLeakageCount: nonNegative(summary.sourceLeakageCount, "sourceLeakageCount") } };
}

function readableExperiment(value: Omit<MechanismEffectExperiment, "blindMapping"> & { blindMappingObjectHash: string; experimentDesignObjectHash: string; summary: MechanismEffectExperimentSummary }) {
  const { blindMapping: _hidden, ...safe } = value as MechanismEffectExperiment & { blindMappingObjectHash: string; experimentDesignObjectHash: string; summary: MechanismEffectExperimentSummary };
  return safe;
}

function parseProtocol(value: unknown) {
  const protocol = recordValue(value, "实验协议");
  const seed = protocol.seed;
  if (seed !== "unknown" && !Number.isInteger(seed)) throw new Error("seed 必须是整数或 unknown。 ");
  return { contextBudgetTokens: positive(protocol.contextBudgetTokens, "contextBudgetTokens"), maxOutputTokens: positive(protocol.maxOutputTokens, "maxOutputTokens"), seed: seed as number | "unknown" };
}

function parsePairs(value: unknown): MechanismEffectPair[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("正式机制效用实验必须恰好包含三组配对。 ");
  const pairs = value.map((item, index) => {
    const pair = recordValue(item, `pairs[${index}]`);
    const candidates = pair.candidates;
    if (!Array.isArray(candidates) || candidates.length !== 2) throw new Error("每组配对必须恰好有两份匿名草稿。 ");
    const signals = stringList(pair.targetSignals, `pairs[${index}].targetSignals`);
    if (signals.length === 0) throw new Error("每组配对必须冻结至少一项目标信号。 ");
    return { pairId: text(pair.pairId, "pairId"), chapterId: text(pair.chapterId, "chapterId"), chapterContractRevision: positive(pair.chapterContractRevision, "chapterContractRevision"), sourceManifestId: text(pair.sourceManifestId, "sourceManifestId"), targetSignals: signals, routeSnapshot: parseRoute(pair.routeSnapshot), candidates: [parseCandidate(candidates[0], "candidates[0]"), parseCandidate(candidates[1], "candidates[1]")] as [MechanismEffectCandidate, MechanismEffectCandidate] };
  });
  if (new Set(pairs.map((pair) => pair.pairId)).size !== 3 || new Set(pairs.map((pair) => pair.chapterId)).size !== 3 || new Set(pairs.map((pair) => pair.sourceManifestId)).size !== 3) throw new Error("三组配对的 pairId、ChapterContract 与冻结 ContextManifest 必须各自唯一。 ");
  const fingerprints = pairs.map((pair) => JSON.stringify({ routeSnapshot: pair.routeSnapshot, protocol: { contextBudgetTokens: 0 } }));
  if (new Set(fingerprints).size !== 1) throw new Error("三组配对必须使用同一冻结路由。 ");
  const allCandidates = pairs.flatMap((pair) => pair.candidates);
  if (new Set(allCandidates.map((candidate) => candidate.candidateId)).size !== 6 || new Set(allCandidates.map((candidate) => candidate.draftDocumentId)).size !== 6) throw new Error("实验草稿和匿名候选不可跨配对复用。 ");
  return pairs;
}

function parseRoute(value: unknown): MechanismEffectRouteSnapshot {
  const route = recordValue(value, "冻结路由");
  const protocol = route.protocol;
  if (!(PROTOCOLS as readonly string[]).includes(protocol as string)) throw new Error("冻结路由协议非法。 ");
  const safetyMarginRatio = route.safetyMarginRatio;
  if (typeof safetyMarginRatio !== "number" || safetyMarginRatio < 0 || safetyMarginRatio >= 1) throw new Error("冻结路由安全余量非法。 ");
  return { providerProfileId: text(route.providerProfileId, "providerProfileId"), baseURL: text(route.baseURL, "baseURL"), model: text(route.model, "model"), protocol: protocol as MechanismEffectRouteSnapshot["protocol"], contextWindowTokens: positive(route.contextWindowTokens, "contextWindowTokens"), maxOutputTokens: positive(route.maxOutputTokens, "maxOutputTokens"), safetyMarginRatio };
}

function parseCandidate(value: unknown, label: string): MechanismEffectCandidate {
  const candidate = recordValue(value, label);
  return { candidateId: text(candidate.candidateId, `${label}.candidateId`), draftDocumentId: text(candidate.draftDocumentId, `${label}.draftDocumentId`), draftArtifactRevision: positive(candidate.draftArtifactRevision, `${label}.draftArtifactRevision`), actualInputTokens: usage(candidate.actualInputTokens, `${label}.actualInputTokens`), actualOutputTokens: usage(candidate.actualOutputTokens, `${label}.actualOutputTokens`) };
}

function parseMapping(value: unknown, pairs: readonly MechanismEffectPair[]): MechanismEffectBlindMapping[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("盲映射必须覆盖全部三组配对。 ");
  const mapping = value.map((item, index) => {
    const row = recordValue(item, `blindMapping[${index}]`);
    return { pairId: text(row.pairId, "blindMapping.pairId"), baselineCandidateId: text(row.baselineCandidateId, "baselineCandidateId"), treatedCandidateId: text(row.treatedCandidateId, "treatedCandidateId") };
  });
  if (new Set(mapping.map((item) => item.pairId)).size !== 3) throw new Error("盲映射 pairId 不可重复。 ");
  for (const row of mapping) {
    const pair = pairs.find((item) => item.pairId === row.pairId);
    if (!pair || row.baselineCandidateId === row.treatedCandidateId || !pair.candidates.some((candidate) => candidate.candidateId === row.baselineCandidateId) || !pair.candidates.some((candidate) => candidate.candidateId === row.treatedCandidateId)) throw new Error("盲映射必须将同组两个匿名候选分别映射为 A/B。 ");
  }
  return mapping;
}

function parseAssessments(value: unknown, pairs: readonly MechanismEffectPair[]): MechanismEffectAssessment[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("正式实验必须保存恰好三组盲评。 ");
  const assessments = value.map((item, index) => {
    const assessment = recordValue(item, `assessments[${index}]`);
    const pairId = text(assessment.pairId, "assessment.pairId");
    const pair = pairs.find((candidate) => candidate.pairId === pairId);
    if (!pair) throw new Error("盲评引用了不存在的配对。 ");
    const ids = pair.candidates.map((candidate) => candidate.candidateId);
    const risks = assessment.candidateRisks;
    if (!Array.isArray(risks) || risks.length !== 2) throw new Error("每组盲评必须逐份记录四类风险。 ");
    const candidateRisks = risks.map((risk, riskIndex) => parseRisk(risk, ids, `candidateRisks[${riskIndex}]`));
    if (new Set(candidateRisks.map((risk) => risk.candidateId)).size !== 2) throw new Error("每组盲评的候选风险不可重复。 ");
    const leaks = stringList(assessment.sourceLeakageCandidateIds, "sourceLeakageCandidateIds");
    if (leaks.some((id) => !ids.includes(id))) throw new Error("来源泄漏只能标记本组匿名候选。 ");
    return { pairId, blindReviewDocumentId: text(assessment.blindReviewDocumentId, "blindReviewDocumentId"), blindReviewArtifactRevision: positive(assessment.blindReviewArtifactRevision, "blindReviewArtifactRevision"), structuredTargetEffect: decision(assessment.structuredTargetEffect, ids, "structuredTargetEffect"), humanBlindDecision: decision(assessment.humanBlindDecision, ids, "humanBlindDecision"), candidateRisks, sourceLeakageCandidateIds: leaks };
  });
  if (new Set(assessments.map((assessment) => assessment.pairId)).size !== 3) throw new Error("盲评必须逐一覆盖三组配对。 ");
  if (new Set(assessments.map((assessment) => assessment.blindReviewDocumentId)).size !== 3) throw new Error("每组配对必须绑定不同的匿名盲评报告。 ");
  return assessments;
}

async function assertBoundBlindReviews(driver: SqlDriver, objects: ObjectStore, projectId: string, experiment: MechanismEffectExperiment): Promise<void> {
  for (const assessment of experiment.assessments ?? []) {
    const pair = experiment.pairs.find((item) => item.pairId === assessment.pairId)!;
    const rows = await driver.query<{ document_type: string; current_revision: number; payload_json: string; content_object_hash: string | null }>({
      sql: `SELECT doc.document_type, artifact.current_revision, revision.payload_json, revision.content_object_hash
            FROM project_documents doc
            INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
            INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
            WHERE doc.project_id = ? AND doc.document_id = ?`,
      params: [projectId, assessment.blindReviewDocumentId],
    });
    const row = rows[0];
    if (!row || row.document_type !== "local_creation_draft" || row.current_revision !== assessment.blindReviewArtifactRevision || !row.content_object_hash) throw new Error("匿名盲评报告不存在或 revision 与实验配对不一致。 ");
    const payload = recordValue(JSON.parse(row.payload_json), "匿名盲评报告 payload");
    const metadata = recordValue(payload.contextMetadata, "匿名盲评报告 metadata");
    const candidateIds = pair.candidates.map((candidate) => candidate.candidateId);
    if (metadata.kind !== "mechanism_effect_experiment_blind_review" || metadata.experimentId !== experiment.experimentId || metadata.pairId !== pair.pairId || !sameStringSet(metadata.candidateIds, candidateIds)) throw new Error("匿名盲评报告 metadata 与冻结实验配对不一致。 ");
    const report = parseMechanismEffectExperimentBlindReview(new TextDecoder().decode(await objects.read(row.content_object_hash)), { experimentId: experiment.experimentId, pairId: pair.pairId, candidateIds });
    if (!sameBlindReviewResult(report, assessment)) throw new Error("提交的结构化盲评与冻结匿名盲评报告不一致。 ");
  }
}

function sameBlindReviewResult(report: { structuredTargetEffect: BlindDecision; candidateRisks: MechanismEffectAssessment["candidateRisks"]; sourceLeakageCandidateIds: string[] }, assessment: MechanismEffectAssessment): boolean {
  return report.structuredTargetEffect === assessment.structuredTargetEffect
    && sameStringSet(report.sourceLeakageCandidateIds, assessment.sourceLeakageCandidateIds)
    && report.candidateRisks.length === assessment.candidateRisks.length
    && report.candidateRisks.every((risk) => {
      const submitted = assessment.candidateRisks.find((item) => item.candidateId === risk.candidateId);
      return submitted !== undefined && submitted.chapterContract === risk.chapterContract && submitted.continuity === risk.continuity && submitted.originality === risk.originality && submitted.readability === risk.readability;
    });
}

function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item) => typeof item === "string") && new Set(value).size === value.length && value.every((item) => expected.includes(item));
}

function parseRisk(value: unknown, ids: string[], label: string) {
  const risk = recordValue(value, label);
  const candidateId = text(risk.candidateId, `${label}.candidateId`);
  if (!ids.includes(candidateId)) throw new Error("盲评风险引用了其他配对的候选。 ");
  const level = (name: "chapterContract" | "continuity" | "originality" | "readability") => {
    const value = risk[name];
    if (!(RISK_LEVELS as readonly string[]).includes(value as string)) throw new Error(`${label}.${name} 风险级别非法。 `);
    return value as RiskLevel;
  };
  return { candidateId, chapterContract: level("chapterContract"), continuity: level("continuity"), originality: level("originality"), readability: level("readability") };
}

function decision(value: unknown, ids: string[], label: string): BlindDecision {
  if (value === "tie" || value === "inconclusive") return value;
  if (typeof value !== "string" || !ids.includes(value)) throw new Error(`${label} 必须是本组匿名候选、tie 或 inconclusive。 `);
  return value;
}

function isDirectionalDecision(value: BlindDecision): value is string {
  return value !== "tie" && value !== "inconclusive";
}

function countTreatedRegressions(assessment: MechanismEffectAssessment, mapping: MechanismEffectBlindMapping): number {
  const baseline = assessment.candidateRisks.find((risk) => risk.candidateId === mapping.baselineCandidateId)!;
  const treated = assessment.candidateRisks.find((risk) => risk.candidateId === mapping.treatedCandidateId)!;
  return (["chapterContract", "continuity", "originality", "readability"] as const).filter((field) => riskRank(treated[field]) >= riskRank("major") && riskRank(treated[field]) > riskRank(baseline[field])).length;
}

function experimentDesign(experiment: MechanismEffectExperiment): RecordValue {
  return { schema_version: 1, kind: "mechanism_effect_experiment_design", experimentId: experiment.experimentId, mechanismAssetId: experiment.mechanismAssetId, mechanismRevision: experiment.mechanismRevision, protocol: experiment.protocol, pairs: experiment.pairs };
}

async function currentExperiment(driver: SqlDriver, projectId: string, experimentId: string): Promise<{ revision: number; state: "prepared" | "completed"; blindMappingObjectHash: string; experimentDesignObjectHash: string } | null> {
  const rows = await driver.query<{ document_type: string; current_revision: number; payload_json: string }>({
    sql: `SELECT doc.document_type, artifact.current_revision, revision.payload_json
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ?`,
    params: [projectId, experimentDocumentId(experimentId)],
  });
  const row = rows[0];
  if (!row || row.document_type !== "mechanism_effect_experiment") return null;
  const payload = recordValue(JSON.parse(row.payload_json), "已冻结机制效用实验");
  const state = payload.state;
  if (state !== "prepared" && state !== "completed") throw new Error("已冻结机制效用实验状态损坏。 ");
  return { revision: positive(row.current_revision, "已冻结实验 revision"), state, blindMappingObjectHash: text(payload.blindMappingObjectHash, "blindMappingObjectHash"), experimentDesignObjectHash: text(payload.experimentDesignObjectHash, "experimentDesignObjectHash") };
}

function experimentDocumentId(experimentId: string): string { return `production:mechanism_effect_experiment:${experimentId}`; }
function riskRank(value: RiskLevel): number { return RISK_LEVELS.indexOf(value); }
function usage(value: unknown, label: string): number | "unknown" { if (value === "unknown") return value; return nonNegative(value, label); }
function stringList(value: unknown, label: string): string[] { if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。 `); const result = value.map((item) => text(item, label)); if (new Set(result).size !== result.length) throw new Error(`${label} 不可重复。 `); return result; }
function recordValue(value: unknown, label: string): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。 `); return value as RecordValue; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。 `); return value.trim(); }
function positive(value: unknown, label: string): number { if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} 必须是正整数。 `); return Number(value); }
function nonNegative(value: unknown, label: string): number { if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} 必须是非负整数。 `); return Number(value); }
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `); }
function assertExpectedRevision(value: number | null): void { if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error("expectedRevision 必须是 null 或正整数。 "); }
function readVerdict(value: unknown): MechanismEffectExperimentSummary["verdict"] { if (value === "prepared" || value === "passed" || value === "failed" || value === "inconclusive") return value; throw new Error("实验结论 verdict 非法。 "); }
