import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { assessMechanismCardRuntime } from "@/lib/analysis/mechanism-card";
import { projectTransferMechanismCard, type TransferMechanismCard } from "@/lib/analysis/transfer-card";
import type { EpistemicStatus, MechanismCard, MechanismEvidenceInstance, MechanismFalsification, MechanismScope, MechanismTargetLayer } from "@/lib/analysis/types";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const EPISTEMIC_STATUSES: readonly EpistemicStatus[] = ["observed", "inferred", "hypothesis", "ambiguous", "unknown", "not_observed", "not_applicable", "extractor_error"];
const TARGET_LAYERS: readonly MechanismTargetLayer[] = ["outline", "chapter_plan", "draft", "editor"];
const REVIEW_STATUSES = ["adopted", "editor_only", "rejected"] as const;

export type MechanismReviewStatus = typeof REVIEW_STATUSES[number];

interface MechanismAssetPayload {
  schema_version: 1;
  kind: "mechanism_asset";
  card: MechanismCard;
  rawOutputObjectHash: string;
  forbiddenTerms: string[];
}

export interface MechanismAssetDetail {
  mechanismAssetId: string;
  analysisProjectId: string;
  status: string;
  revision: number;
  card: MechanismCard;
  neutralExampleObjectHash: string;
  forbiddenTerms: string[];
  adoptions: Array<{ projectId: string; status: MechanismReviewStatus; createdAt: number }>;
}

export interface MechanismAssetService {
  propose(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
  listCandidates(analysisProjectId?: string): Promise<MechanismAssetDetail[]>;
  get(mechanismAssetId: string): Promise<MechanismAssetDetail | null>;
  review(input: { command: Omit<CommandEnvelope, "tool" | "args"> & { expectedRevision?: number; projectId?: string }; mechanismAssetId: string; status: MechanismReviewStatus }): Promise<CommandResult>;
  listAdopted(projectId: string): Promise<TransferMechanismCard[]>;
}

export interface CreateMechanismAssetServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  /** 只有机制候选编译需要写对象；审核既有候选不应要求 UI 拥有 ObjectStore 写权限。 */
  objects?: Pick<ObjectStore, "put">;
}

/**
 * 机制资产的唯一业务入口。候选保留分析侧完整审计信息；生产侧仅能经过
 * projectTransferMechanismCard 取得脱敏投影。
 */
export function createMechanismAssetService(options: CreateMechanismAssetServiceOptions): MechanismAssetService {
  return {
    async propose(input) {
      assertNonEmpty(input.analysisProjectId, "analysisProjectId");
      assertNonEmpty(input.rawOutput, "rawOutput");
      if (!options.objects) throw new Error("当前宿主未配置 MechanismAsset 候选对象存储。 ");
      const proposed = parseMechanismCandidateOutput(input.rawOutput);
      await assertAnalysisProjectExists(options.driver, input.analysisProjectId);
      const validated = await validateCandidate(options.driver, input.analysisProjectId, proposed);
      const rawOutput = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/json; charset=utf-8" });
      const neutralExample = await options.objects.put({ content: encoder.encode(proposed.neutralExample), mediaType: "text/plain; charset=utf-8" });
      const payload: MechanismAssetPayload = {
        schema_version: 1,
        kind: "mechanism_asset",
        card: validated.card,
        rawOutputObjectHash: rawOutput.sha256,
        forbiddenTerms: validated.forbiddenTerms,
      };
      return options.commands.execute({
        ...input.command,
        tool: "commit_mechanism_candidate",
        args: { analysisProjectId: input.analysisProjectId, mechanismAssetId: validated.card.id, rawOutput, neutralExample, payload },
      });
    },

    async listCandidates(analysisProjectId) {
      if (analysisProjectId !== undefined) {
        assertNonEmpty(analysisProjectId, "analysisProjectId");
        await assertAnalysisProjectExists(options.driver, analysisProjectId);
      }
      const rows = await readAssetRows(options.driver, analysisProjectId);
      return Promise.all(rows.map((row) => toDetail(options.driver, row)));
    },

    async get(mechanismAssetId) {
      assertNonEmpty(mechanismAssetId, "mechanismAssetId");
      const rows = await readAssetRows(options.driver, undefined, mechanismAssetId);
      return rows[0] ? toDetail(options.driver, rows[0]) : null;
    },

    async review(input) {
      assertNonEmpty(input.mechanismAssetId, "mechanismAssetId");
      if (!REVIEW_STATUSES.includes(input.status)) throw new Error("机制采纳状态无效。 ");
      if (input.command.actor.kind !== "human" && input.command.actor.kind !== "human_via_agent") throw new Error("机制采纳必须由 human 或 human_via_agent 明确执行。 ");
      const projectId = input.command.projectId;
      if (!projectId || !projectId.trim()) throw new Error("机制采纳必须指定原创 projectId。 ");
      if (!Number.isInteger(input.command.expectedRevision) || (input.command.expectedRevision as number) < 1) throw new Error("机制采纳必须携带 expectedRevision。 ");
      await assertNovelProjectExists(options.driver, projectId);
      const rows = await readAssetRows(options.driver, undefined, input.mechanismAssetId);
      const row = rows[0];
      if (!row) throw new Error("MechanismAsset 不存在。 ");
      const detail = await toDetail(options.driver, row);
      if (detail.revision !== input.command.expectedRevision) {
        return { kind: "conflict", currentRevision: detail.revision, diagnostics: [{ code: "revision_conflict", message: "MechanismAsset 已被更新，请重新读取后再采纳。", resourceId: input.mechanismAssetId }] };
      }
      const card: MechanismCard = {
        ...detail.card,
        lifecycle: input.status === "rejected" ? "rejected" : "verified",
        adoption: input.status,
      };
      const payload: MechanismAssetPayload = {
        schema_version: 1,
        kind: "mechanism_asset",
        card,
        rawOutputObjectHash: parsePayload(row.payload_json).rawOutputObjectHash,
        forbiddenTerms: detail.forbiddenTerms,
      };
      if (!payload.rawOutputObjectHash) throw new Error("MechanismAsset 原始编译对象引用损坏。 ");
      return options.commands.execute({
        ...input.command,
        projectId,
        tool: "review_mechanism_asset",
        args: {
          mechanismAssetId: input.mechanismAssetId,
          projectId,
          reviewStatus: input.status,
          expectedRevision: input.command.expectedRevision,
          nextStatus: input.status === "rejected" ? detail.status : "verified",
          neutralExampleObjectHash: detail.neutralExampleObjectHash,
          payload,
        },
      });
    },

    async listAdopted(projectId) {
      assertNonEmpty(projectId, "projectId");
      await assertNovelProjectExists(options.driver, projectId);
      const rows = await options.driver.query<AdoptedRow>({
        sql: `SELECT asset.mechanism_asset_id, asset.analysis_project_id, asset.status, asset.current_revision,
                     revision.payload_json, revision.neutral_example_object_hash, adoption.status AS adoption_status
              FROM mechanism_adoptions adoption
              INNER JOIN mechanism_assets asset ON asset.mechanism_asset_id = adoption.mechanism_asset_id
              INNER JOIN mechanism_asset_revisions revision ON revision.mechanism_asset_id = asset.mechanism_asset_id AND revision.revision = asset.current_revision
              WHERE adoption.project_id = ?
                AND adoption.adoption_id = (
                  SELECT nested.adoption_id FROM mechanism_adoptions nested
                  WHERE nested.mechanism_asset_id = adoption.mechanism_asset_id AND nested.project_id = adoption.project_id
                  ORDER BY nested.created_at DESC, nested.adoption_id DESC LIMIT 1
                )
                AND adoption.status IN ('adopted', 'editor_only')
              ORDER BY adoption.created_at ASC, adoption.adoption_id ASC`,
        params: [projectId],
      });
      return rows.map((row) => {
        const payload = parsePayload(row.payload_json);
        const adoption = readReviewStatus(row.adoption_status);
        const projected = projectTransferMechanismCard({ ...payload.card, lifecycle: "verified", adoption }, { forbiddenTerms: payload.forbiddenTerms }, { allowEditorOnly: adoption === "editor_only" });
        if (!projected.ok) throw new Error(`机制 ${row.mechanism_asset_id} 无法进入 Writer 投影：${projected.reason}。`);
        return projected.card;
      });
    },
  };
}

/** Command planner 用的最小防御性验证；分析归属及质量门只在 Application Service 中判定。 */
export function parsePlannedMechanismPayload(value: unknown): MechanismAssetPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return parsePayload(JSON.stringify(value));
  } catch {
    return null;
  }
}

interface ProposedMechanism {
  card: MechanismCard;
  neutralExample: string;
  forbiddenTerms: string[];
}

function parseMechanismCandidateOutput(value: string): ProposedMechanism {
  const root = parseRecord(value, "机制候选输出必须是单个 JSON 对象。 ");
  assertExactKeys(root, ["card", "neutralExample", "forbiddenTerms"], "机制候选输出");
  return {
    card: parseCard(root.card, true),
    neutralExample: readString(root.neutralExample, "neutralExample"),
    forbiddenTerms: uniqueStrings(root.forbiddenTerms, "forbiddenTerms"),
  };
}

function parseCard(value: unknown, isNewCandidate: boolean): MechanismCard {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("机制卡必须是对象。 ");
  const card = value as Record<string, unknown>;
  assertExactKeys(card, ["id", "title", "observation", "effectHypothesis", "when", "do", "avoid", "evidenceSpanIds", "counterexampleSpanIds", "epistemicStatus", "lifecycle", "falsification", "scope", "applicability", "targetLayers", "adoption", "originCandidateIds", "evidenceInstances"], "机制卡");
  const epistemicStatus = readEnum(card.epistemicStatus, EPISTEMIC_STATUSES, "mechanism.epistemicStatus");
  const lifecycle = card.lifecycle;
  const scope = card.scope;
  const adoption = card.adoption;
  if (lifecycle !== "candidate" && lifecycle !== "verified" && lifecycle !== "rejected") throw new Error("机制卡 lifecycle 无效。 ");
  if (scope !== "distributed" && scope !== "local" && scope !== "exception") throw new Error("机制卡 scope 无效。 ");
  if (adoption !== "pending" && adoption !== "adopted" && adoption !== "editor_only" && adoption !== "rejected") throw new Error("机制卡 adoption 无效。 ");
  if (isNewCandidate && lifecycle !== "candidate") throw new Error("新机制卡 lifecycle 必须为 candidate。 ");
  if (isNewCandidate && adoption !== "pending") throw new Error("新机制卡 adoption 必须为 pending。 ");
  return {
    id: readString(card.id, "mechanism.id"),
    title: readString(card.title, "mechanism.title"),
    observation: readString(card.observation, "mechanism.observation"),
    effectHypothesis: readString(card.effectHypothesis, "mechanism.effectHypothesis"),
    when: uniqueStrings(card.when, "mechanism.when"),
    do: uniqueStrings(card.do, "mechanism.do"),
    avoid: uniqueStrings(card.avoid, "mechanism.avoid"),
    evidenceSpanIds: uniqueStrings(card.evidenceSpanIds, "mechanism.evidenceSpanIds"),
    counterexampleSpanIds: uniqueStrings(card.counterexampleSpanIds, "mechanism.counterexampleSpanIds"),
    epistemicStatus,
    lifecycle,
    falsification: parseFalsification(card.falsification),
    scope: scope as MechanismScope,
    applicability: uniqueStrings(card.applicability, "mechanism.applicability"),
    targetLayers: readTargetLayers(card.targetLayers),
    adoption,
    originCandidateIds: uniqueStrings(card.originCandidateIds, "mechanism.originCandidateIds"),
    evidenceInstances: parseEvidenceInstances(card.evidenceInstances),
  };
}

function parseFalsification(value: unknown): MechanismFalsification {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mechanism.falsification 必须是对象。 ");
  const item = value as Record<string, unknown>;
  assertExactKeys(item, ["status", "alternativeExplanations", "applicabilityLimits"], "mechanism.falsification");
  const status = item.status;
  if (status !== "not_run" && status !== "passed" && status !== "bounded" && status !== "failed") throw new Error("mechanism.falsification.status 无效。 ");
  return { status, alternativeExplanations: uniqueStrings(item.alternativeExplanations, "mechanism.falsification.alternativeExplanations"), applicabilityLimits: uniqueStrings(item.applicabilityLimits, "mechanism.falsification.applicabilityLimits") };
}

function parseEvidenceInstances(value: unknown): MechanismEvidenceInstance[] {
  if (!Array.isArray(value)) throw new Error("mechanism.evidenceInstances 必须是数组。 ");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`mechanism.evidenceInstances[${index}] 必须是对象。`);
    const item = entry as Record<string, unknown>;
    assertExactKeys(item, ["id", "originCandidateId", "spanIds", "chapterIndexes", "threadIds"], `mechanism.evidenceInstances[${index}]`);
    const id = readString(item.id, `mechanism.evidenceInstances[${index}].id`);
    if (ids.has(id)) throw new Error(`mechanism.evidenceInstances id 重复：${id}。`);
    ids.add(id);
    if (!Array.isArray(item.chapterIndexes) || item.chapterIndexes.some((chapter) => !Number.isInteger(chapter) || (chapter as number) < 0)) throw new Error(`mechanism.evidenceInstances[${index}].chapterIndexes 无效。`);
    return { id, originCandidateId: readString(item.originCandidateId, `mechanism.evidenceInstances[${index}].originCandidateId`), spanIds: uniqueStrings(item.spanIds, `mechanism.evidenceInstances[${index}].spanIds`), chapterIndexes: item.chapterIndexes as number[], threadIds: uniqueStrings(item.threadIds, `mechanism.evidenceInstances[${index}].threadIds`) };
  });
}

function readTargetLayers(value: unknown): MechanismTargetLayer[] {
  const layers = uniqueStrings(value, "mechanism.targetLayers");
  if (layers.some((layer) => !TARGET_LAYERS.includes(layer as MechanismTargetLayer))) throw new Error("mechanism.targetLayers 含非法层级。 ");
  return layers as MechanismTargetLayer[];
}

interface OriginConclusion {
  id: string;
  epistemicStatus: EpistemicStatus;
  evidenceSpanIds: string[];
}

interface OriginAssessment {
  conclusionId: string;
  status: "passed" | "bounded" | "failed" | "unknown";
  counterEvidenceSpanIds: string[];
  alternativeExplanations: string[];
  applicabilityLimits: string[];
}

async function validateCandidate(driver: SqlDriver, analysisProjectId: string, proposed: ProposedMechanism): Promise<{ card: MechanismCard; forbiddenTerms: string[] }> {
  const [origins, assessments, spans, forbiddenTerms] = await Promise.all([
    readOriginConclusions(driver, analysisProjectId),
    readOriginAssessments(driver, analysisProjectId),
    readProjectSpans(driver, analysisProjectId),
    readForbiddenTerms(driver, analysisProjectId, proposed.forbiddenTerms),
  ]);
  const byId = new Map(origins.map((origin) => [origin.id, origin]));
  const assessmentById = new Map(assessments.map((assessment) => [assessment.conclusionId, assessment]));
  const cardOrigins = proposed.card.originCandidateIds ?? [];
  if (cardOrigins.some((id) => !byId.has(id))) throw new Error("机制卡引用了不属于当前 AnalysisProject 的 ResearchConclusion。 ");
  const supporting = new Set(cardOrigins.flatMap((id) => byId.get(id)!.evidenceSpanIds));
  if (proposed.card.evidenceSpanIds.some((spanId) => !supporting.has(spanId))) throw new Error("机制卡 evidenceSpanIds 必须来自其来源结论的支持证据。 ");
  const counter = new Set(cardOrigins.flatMap((id) => assessmentById.get(id)?.counterEvidenceSpanIds ?? []));
  if (proposed.card.counterexampleSpanIds.some((spanId) => !counter.has(spanId))) throw new Error("机制卡 counterexampleSpanIds 必须来自独立反证。 ");
  const allAssessments = cardOrigins.map((id) => assessmentById.get(id));
  if (allAssessments.some((assessment) => !assessment || (assessment.status !== "passed" && assessment.status !== "bounded"))) throw new Error("机制卡的每个来源结论都必须已完成 passed 或 bounded 的独立反证。 ");
  const verifiedAssessments = allAssessments as OriginAssessment[];
  const actualFalsification: MechanismFalsification = {
    status: verifiedAssessments.every((assessment) => assessment.status === "passed") ? "passed" : "bounded",
    alternativeExplanations: unique(verifiedAssessments.flatMap((assessment) => assessment.alternativeExplanations)),
    applicabilityLimits: unique(verifiedAssessments.flatMap((assessment) => assessment.applicabilityLimits)),
  };
  const card = { ...proposed.card, falsification: actualFalsification };
  if (card.scope === "distributed") {
    const unitBySpan = new Map(spans.map((span) => [span.id, span.analysisUnitId]));
    const unitIds = new Set(card.evidenceInstances!.flatMap((instance) => instance.spanIds.map((spanId) => unitBySpan.get(spanId))).filter((id): id is string => typeof id === "string"));
    if (unitIds.size < 3) throw new Error("distributed 机制必须由三个不同 AnalysisUnit 的证据实例支撑。 ");
  }
  const reasons = assessMechanismCardRuntime(
    card,
    spans.map((span) => ({ id: span.id, position: span.startByte })),
    cardOrigins.map((id) => ({ id, epistemicStatus: byId.get(id)!.epistemicStatus, evidenceSpanIds: byId.get(id)!.evidenceSpanIds })),
    verifiedAssessments.map((assessment) => ({ candidateId: assessment.conclusionId, status: assessment.status })),
    { verifyOriginLinks: true },
  );
  if (reasons.length > 0) throw new Error(`机制卡未通过质量门：${reasons.join(", ")}。`);
  if (containsForbidden(proposed.neutralExample, forbiddenTerms)) throw new Error("中性示范包含登记的源作专名或事件词，不能保存。 ");
  return { card, forbiddenTerms };
}

async function readOriginConclusions(driver: SqlDriver, analysisProjectId: string): Promise<OriginConclusion[]> {
  const rows = await driver.query<{ payload_json: string }>({ sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ?", params: [analysisProjectId] });
  return rows.flatMap((row) => {
    const payload = parseRecord(row.payload_json, "AnalysisItem payload 损坏。 ");
    if (payload.kind !== "research_conclusion" || !payload.conclusion || typeof payload.conclusion !== "object" || Array.isArray(payload.conclusion)) return [];
    const conclusion = payload.conclusion as Record<string, unknown>;
    const id = nonEmptyString(conclusion.id);
    const epistemicStatus = conclusion.epistemicStatus;
    if (!id || typeof epistemicStatus !== "string" || !EPISTEMIC_STATUSES.includes(epistemicStatus as EpistemicStatus)) return [];
    try { return [{ id, epistemicStatus: epistemicStatus as EpistemicStatus, evidenceSpanIds: uniqueStrings(conclusion.evidenceSpanIds, "stored conclusion evidenceSpanIds") }]; } catch { return []; }
  });
}

async function readOriginAssessments(driver: SqlDriver, analysisProjectId: string): Promise<OriginAssessment[]> {
  const rows = await driver.query<{ payload_json: string }>({ sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ?", params: [analysisProjectId] });
  return rows.flatMap((row) => {
    const payload = parseRecord(row.payload_json, "AnalysisItem payload 损坏。 ");
    if (payload.kind !== "independent_falsification" || !payload.assessment || typeof payload.assessment !== "object" || Array.isArray(payload.assessment)) return [];
    const assessment = payload.assessment as Record<string, unknown>;
    const conclusionId = nonEmptyString(assessment.conclusionId);
    const status = assessment.status;
    if (!conclusionId || (status !== "passed" && status !== "bounded" && status !== "failed" && status !== "unknown")) return [];
    try { return [{ conclusionId, status, counterEvidenceSpanIds: uniqueStrings(assessment.counterEvidenceSpanIds, "assessment.counterEvidenceSpanIds"), alternativeExplanations: uniqueStrings(assessment.alternativeExplanations, "assessment.alternativeExplanations"), applicabilityLimits: uniqueStrings(assessment.applicabilityLimits, "assessment.applicabilityLimits") }]; } catch { return []; }
  });
}

async function readProjectSpans(driver: SqlDriver, analysisProjectId: string): Promise<Array<{ id: string; startByte: number; analysisUnitId: string | null }>> {
  const rows = await driver.query<{ span_id: string; start_byte: number; analysis_unit_id: string | null }>({
    sql: `SELECT span.span_id, span.start_byte, span.analysis_unit_id FROM source_spans span
          INNER JOIN analysis_projects project ON project.source_edition_id = span.source_edition_id
          WHERE project.analysis_project_id = ?`,
    params: [analysisProjectId],
  });
  if (rows.length === 0) throw new Error("AnalysisProject 没有可引用的 SourceSpan。 ");
  return rows.map((row) => ({ id: row.span_id, startByte: row.start_byte, analysisUnitId: row.analysis_unit_id }));
}

async function readForbiddenTerms(driver: SqlDriver, analysisProjectId: string, supplied: string[]): Promise<string[]> {
  const titles = await driver.query<{ title: string }>({
    sql: `SELECT work.title FROM reference_works work
          INNER JOIN source_editions edition ON edition.reference_work_id = work.reference_work_id
          INNER JOIN analysis_projects project ON project.source_edition_id = edition.source_edition_id
          WHERE project.analysis_project_id = ?`,
    params: [analysisProjectId],
  });
  return unique([...titles.map((row) => row.title), ...supplied].map((term) => term.trim()).filter(Boolean));
}

interface AssetRow {
  mechanism_asset_id: string;
  analysis_project_id: string;
  status: string;
  current_revision: number;
  payload_json: string;
  neutral_example_object_hash: string | null;
}

interface AdoptedRow extends AssetRow { adoption_status: string }

async function readAssetRows(driver: SqlDriver, analysisProjectId?: string, mechanismAssetId?: string): Promise<AssetRow[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (analysisProjectId) { where.push("asset.analysis_project_id = ?"); params.push(analysisProjectId); }
  if (mechanismAssetId) { where.push("asset.mechanism_asset_id = ?"); params.push(mechanismAssetId); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return driver.query<AssetRow>({
    sql: `SELECT asset.mechanism_asset_id, asset.analysis_project_id, asset.status, asset.current_revision, revision.payload_json, revision.neutral_example_object_hash
          FROM mechanism_assets asset INNER JOIN mechanism_asset_revisions revision
            ON revision.mechanism_asset_id = asset.mechanism_asset_id AND revision.revision = asset.current_revision
          ${clause} ORDER BY asset.created_at ASC, asset.mechanism_asset_id ASC`,
    params,
  });
}

async function toDetail(driver: SqlDriver, row: AssetRow): Promise<MechanismAssetDetail> {
  const payload = parsePayload(row.payload_json);
  if (!row.neutral_example_object_hash) throw new Error("MechanismAsset 缺少中性示范对象。 ");
  const adoptions = await driver.query<{ project_id: string | null; status: string; created_at: number }>({
    sql: "SELECT project_id, status, created_at FROM mechanism_adoptions WHERE mechanism_asset_id = ? ORDER BY created_at ASC, adoption_id ASC",
    params: [row.mechanism_asset_id],
  });
  return {
    mechanismAssetId: row.mechanism_asset_id,
    analysisProjectId: row.analysis_project_id,
    status: row.status,
    revision: row.current_revision,
    card: payload.card,
    neutralExampleObjectHash: row.neutral_example_object_hash,
    forbiddenTerms: payload.forbiddenTerms,
    adoptions: adoptions.flatMap((adoption) => adoption.project_id ? [{ projectId: adoption.project_id, status: readReviewStatus(adoption.status), createdAt: adoption.created_at }] : []),
  };
}

function parsePayload(value: string): MechanismAssetPayload {
  const payload = parseRecord(value, "MechanismAsset payload 损坏。 ");
  if (payload.schema_version !== 1 || payload.kind !== "mechanism_asset" || typeof payload.rawOutputObjectHash !== "string" || !/^[a-f0-9]{64}$/.test(payload.rawOutputObjectHash) || !Array.isArray(payload.forbiddenTerms)) throw new Error("MechanismAsset payload 字段无效。 ");
  if (!payload.card || typeof payload.card !== "object" || Array.isArray(payload.card)) throw new Error("MechanismAsset 卡片损坏。 ");
  const card = parseCard(payload.card, false);
  return { schema_version: 1, kind: "mechanism_asset", card, rawOutputObjectHash: payload.rawOutputObjectHash, forbiddenTerms: uniqueStrings(payload.forbiddenTerms, "MechanismAsset forbiddenTerms") };
}

function readReviewStatus(value: string): MechanismReviewStatus {
  if (!REVIEW_STATUSES.includes(value as MechanismReviewStatus)) throw new Error("MechanismAsset 采纳状态损坏。 ");
  return value as MechanismReviewStatus;
}

async function assertAnalysisProjectExists(driver: SqlDriver, analysisProjectId: string): Promise<void> {
  const rows = await driver.query<{ analysis_project_id: string }>({ sql: "SELECT analysis_project_id FROM analysis_projects WHERE analysis_project_id = ?", params: [analysisProjectId] });
  if (rows.length !== 1) throw new Error("AnalysisProject 不存在。 ");
}

async function assertNovelProjectExists(driver: SqlDriver, projectId: string): Promise<void> {
  const rows = await driver.query<{ project_id: string }>({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] });
  if (rows.length !== 1) throw new Error("原创 Project 不存在。 ");
}

function uniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  const strings = value.map((item, index) => readString(item, `${label}[${index}]`));
  if (new Set(strings).size !== strings.length) throw new Error(`${label} 不允许重复。`);
  return strings;
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function containsForbidden(value: string, terms: string[]): boolean { const text = value.toLocaleLowerCase(); return terms.some((term) => text.includes(term.toLocaleLowerCase())); }
function nonEmptyString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function readString(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`); return value; }
function readEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] { if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} 枚举值无效。`); return value as T[number]; }
function assertNonEmpty(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`); }
function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void { const expected = new Set(keys); if (Object.keys(value).length !== expected.size || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`${label} 字段不完整或包含额外字段。`); }
function parseRecord(value: string, message: string): Record<string, unknown> { let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new Error(message); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(message); return parsed as Record<string, unknown>; }
