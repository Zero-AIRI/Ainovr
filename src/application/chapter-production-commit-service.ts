import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ChapterMechanismApplicationSnapshot } from "@/application/chapter-mechanism-application-service";
import type { ChapterMechanismOutcomeSnapshot } from "@/application/chapter-mechanism-outcome-service";
import { chapterMechanismOutcomeDocumentId } from "@/application/chapter-mechanism-outcome-service";
import type { ObjectReference, ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type RecordValue = Record<string, unknown>;

export interface RevisionPatch {
  expectedRevision: number | null;
  payload: RecordValue;
}

export interface CanonPatch extends RevisionPatch { canonEntryId: string; }
export interface CharacterKnowledgePatch extends RevisionPatch { knowledgeId: string; characterId: string; }
export interface ReaderStatePatch { readerStateId: string; expectedRevision?: number | null; payload: RecordValue; }
export interface ReaderPromisePatch { readerPromiseId: string; expectedRevision?: number | null; status: "establish" | "reinforce" | "delay" | "payoff" | "transform"; payload: RecordValue; }

export interface AcceptChapterDraftInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  projectId: string;
  chapterId: string;
  chapterOrdinal: number;
  productionCommitId: string;
  /** 人工明确选择的、已提交到领域存储的 V1/V2/V3 草稿。 */
  draftDocumentId: string;
  /** 有本章采用记录时，正式提交必须引用当前的人类应用结果。 */
  outcomeId?: string;
  chapterDelta: RecordValue;
  canonPatches: CanonPatch[];
  characterKnowledgePatches: CharacterKnowledgePatch[];
  readerState: ReaderStatePatch;
  readerPromiseUpdates: ReaderPromisePatch[];
  outlineDrift: { payload: RecordValue };
  /** 由已持久化的领域提案发起时，用于确认页和审计的安全引用。 */
  proposalId?: string;
  confirmationSummary?: ChapterProductionCommitConfirmationSummary;
}

/** 外部 Agent 提供的精确连续性写入计划；作者界面从不编辑或拼装这些字段。 */
export interface ChapterProductionCommitProposal {
  schema_version: 1;
  kind: "chapter_production_commit_proposal";
  proposalId: string;
  chapterId: string;
  chapterOrdinal: number;
  productionCommitId: string;
  draftDocumentId: string;
  outcomeId?: string;
  chapterDelta: RecordValue;
  canonPatches: CanonPatch[];
  characterKnowledgePatches: CharacterKnowledgePatch[];
  readerState: ReaderStatePatch;
  readerPromiseUpdates: ReaderPromisePatch[];
  outlineDrift: { payload: RecordValue };
}

export interface ChapterProductionCommitProposalSummary {
  proposalId: string;
  revision: number;
  draftDocumentId: string;
  productionCommitId: string;
  outcomeId: string | null;
  method: {
    applicationId: string;
    applicationRevision: number;
    reviewId: string;
    reviewRevision: number;
    outcomeId: string;
    outcomeRevision: number;
    disposition: "accept_current" | "accept_with_gap";
    humanDisagreements: string[];
    riskAcceptanceReason: string | null;
  } | null;
  continuity: {
    canonPatchCount: number;
    characterKnowledgePatchCount: number;
    readerPromiseUpdateCount: number;
    readerState: "更新读者状态";
    outlineDrift: "已准备大纲偏移记录";
  };
}

export interface ChapterProductionCommitConfirmationSummary extends ChapterProductionCommitProposalSummary {
  chapterId: string;
}

export interface AcceptedChapter {
  projectId: string;
  chapterId: string;
  revision: number;
  title: string;
  text: string;
  manifestId: string;
  draftDocumentId: string;
  draftRevision: "v1" | "v2" | "v3";
  draftModel: string;
  draftExecutionRef: string;
  reviewLineage: string[];
  lineage: ProductionLineage;
  chapterDelta: RecordValue;
  productionCommitId: string;
}

export interface ProductionLineage {
  schema_version: 1;
  selectedDraftExecutionRef: string;
  manifestId: string;
  reviewIds: string[];
  model: string;
  runId: string | null;
}

export interface ChapterProductionCommitService {
  /**
   * 人工接受一个现有草稿。调用方不能提供任意正文、标题或 Manifest，从而确保
   * ProductionCommit 始终指向 Writer/Editor 已产生且可审计的一个版本。
   */
  acceptDraft(input: AcceptChapterDraftInput): Promise<CommandResult>;
  saveProposal(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; expectedRevision: number | null; proposal: ChapterProductionCommitProposal }): Promise<CommandResult>;
  /** 仅返回给作者确认所需的安全摘要，不返回连续性 patch 的原始 JSON。 */
  getProposal(input: { projectId: string; chapterId: string }): Promise<ChapterProductionCommitProposalSummary | null>;
  /** 作者仅用提案标识发起持久确认；真实写入计划始终从领域存储读取。 */
  acceptProposal(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; proposalId: string }): Promise<CommandResult>;
  getAcceptedChapter(input: { projectId: string; chapterId: string }): Promise<AcceptedChapter | null>;
}

/**
 * 生产端唯一的正式落库入口。正文和 Manifest 先写对象库，随后由单个
 * CommandService 事务同时提交章节、所有状态 patch、版本和审计；内部 Agent
 * 不被允许调用它把自己的输出直接设为 accepted。
 */
export function createChapterProductionCommitService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
  applications?: Pick<{ get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismApplicationSnapshot | null> }, "get">;
  outcomes?: Pick<{ get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismOutcomeSnapshot | null> }, "get">;
}): ChapterProductionCommitService {
  return {
    async acceptDraft(input) {
      assertHumanActor(input.command);
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.productionCommitId, "productionCommitId");
      assertId(input.draftDocumentId, "draftDocumentId");
      if (!Number.isInteger(input.chapterOrdinal) || input.chapterOrdinal < 1) throw new Error("chapterOrdinal 非法。 ");
      const selected = await selectedDraft(options.driver, options.drafts, input.projectId, input.chapterId, input.draftDocumentId);
      await assertProductionChapterBoundary(options.driver, input.projectId, input.chapterId, input.chapterOrdinal);
      const manifest = await frozenManifest(options.driver, input.projectId, input.chapterId, selected.manifestId);
      const methodOutcome = await currentMethodOutcome(options, input, selected);
      const runId = await pipelineRunForExecution(options.driver, selected.executionRef);
      const previous = await currentChapter(options.driver, input.projectId, input.chapterId);
      const textObject = await options.objects.put({ content: encoder.encode(selected.text), mediaType: "text/plain; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(previous ? { expectedRevision: previous.chapterRevision } : {}),
        tool: "commit_chapter_production",
        args: {
          projectId: input.projectId,
          chapterId: input.chapterId,
          chapterOrdinal: input.chapterOrdinal,
          title: selected.title,
          productionCommitId: input.productionCommitId,
          manifestId: selected.manifestId,
          manifestObject: manifest.object,
          textObject,
          selectedDraft: {
            documentId: selected.documentId,
            revision: selected.revision,
            model: selected.model,
            executionRef: selected.executionRef,
            reviewLineage: selected.reviewLineage,
          },
          methodOutcome,
          runId,
          expectedChapterRevision: previous?.chapterRevision ?? null,
          expectedTextRevision: previous?.textRevision ?? null,
          chapterDelta: input.chapterDelta,
          canonPatches: input.canonPatches,
          characterKnowledgePatches: input.characterKnowledgePatches,
          readerState: input.readerState,
          readerPromiseUpdates: input.readerPromiseUpdates,
          outlineDrift: input.outlineDrift,
          ...(input.proposalId ? { proposalId: input.proposalId } : {}),
          ...(input.confirmationSummary ? { confirmationSummary: input.confirmationSummary } : {}),
        },
      });
    },

    async saveProposal(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertExpectedRevision(input.expectedRevision);
      const proposal = parseProposal(input.proposal, input.chapterId);
      const documentId = proposalDocumentId(input.chapterId);
      const current = await currentProposal(options.driver, input.projectId, documentId);
      if (current && current.revision !== input.expectedRevision) {
        return { kind: "conflict", currentRevision: current.revision, diagnostics: [{ code: "revision_conflict", message: "正式提交提案已更新，请重新读取后再保存。", resourceId: documentId }] };
      }
      if (!current && input.expectedRevision !== null) {
        return { kind: "blocked", diagnostics: [{ code: "revision_conflict", message: "正式提交提案尚不存在，不能用旧 revision 覆盖。", resourceId: documentId }] };
      }
      const method = await proposalMethodContext(options, input.projectId, proposal);
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(input.expectedRevision === null ? {} : { expectedRevision: input.expectedRevision }),
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId,
          documentType: "chapter_production_commit_proposal",
          status: "approved",
          expectedRevision: input.expectedRevision,
          payload: proposal,
          dependencies: method?.dependencies ?? [],
        },
      });
    },

    async getProposal(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const current = await currentProposal(options.driver, input.projectId, proposalDocumentId(input.chapterId));
      if (!current || current.stale || current.documentType !== "chapter_production_commit_proposal") return null;
      const proposal = parseProposal(current.payload, input.chapterId);
      return proposalSummary(proposal, current.revision, await proposalMethodContext(options, input.projectId, proposal));
    },

    async acceptProposal(input) {
      assertHumanActor(input.command);
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.proposalId, "proposalId");
      const current = await currentProposal(options.driver, input.projectId, proposalDocumentId(input.chapterId));
      if (!current || current.stale || current.documentType !== "chapter_production_commit_proposal") throw new Error("当前正式提交提案不存在或已过期，请由外部 Agent 重新准备。 ");
      const proposal = parseProposal(current.payload, input.chapterId);
      if (proposal.proposalId !== input.proposalId) throw new Error("正式提交提案不属于当前章节。 ");
      const summary = proposalSummary(proposal, current.revision, await proposalMethodContext(options, input.projectId, proposal));
      return this.acceptDraft({
        command: input.command,
        projectId: input.projectId,
        chapterId: input.chapterId,
        chapterOrdinal: proposal.chapterOrdinal,
        productionCommitId: proposal.productionCommitId,
        draftDocumentId: proposal.draftDocumentId,
        ...(proposal.outcomeId ? { outcomeId: proposal.outcomeId } : {}),
        chapterDelta: proposal.chapterDelta,
        canonPatches: proposal.canonPatches,
        characterKnowledgePatches: proposal.characterKnowledgePatches,
        readerState: proposal.readerState,
        readerPromiseUpdates: proposal.readerPromiseUpdates,
        outlineDrift: proposal.outlineDrift,
        proposalId: proposal.proposalId,
        confirmationSummary: { ...summary, chapterId: proposal.chapterId },
      });
    },

    async getAcceptedChapter(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const rows = await options.driver.query<{
        current_revision: number;
        payload_json: string;
        content_object_hash: string | null;
      }>({
        sql: `
          SELECT artifact.current_revision, revision.payload_json, revision.content_object_hash
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ? AND doc.document_type = 'chapter_text' AND doc.status = 'accepted'
        `,
        params: [input.projectId, chapterTextDocumentId(input.chapterId)],
      });
      const row = rows[0];
      if (!row || !row.content_object_hash) return null;
      const payload = parseRecord(row.payload_json, "ChapterText payload");
      if (payload.schema_version !== 1 || payload.kind !== "chapter_text" || payload.chapterId !== input.chapterId) throw new Error("ChapterText 文档损坏。 ");
      const selected = acceptedDraft(payload);
      const lineage = acceptedLineage(payload, selected, readString(payload.manifestId, "ChapterText.manifestId"));
      return {
        projectId: input.projectId,
        chapterId: input.chapterId,
        revision: row.current_revision,
        title: readString(payload.title, "ChapterText.title"),
        text: decoder.decode(await options.objects.read(row.content_object_hash)),
        manifestId: readString(payload.manifestId, "ChapterText.manifestId"),
        draftDocumentId: selected.documentId,
        draftRevision: selected.revision,
        draftModel: selected.model,
        draftExecutionRef: selected.executionRef,
        reviewLineage: selected.reviewLineage,
        lineage,
        chapterDelta: recordValue(payload.chapterDelta, "ChapterText.chapterDelta"),
        productionCommitId: readString(payload.productionCommitId, "ChapterText.productionCommitId"),
      };
    },
  };
}

async function assertProductionChapterBoundary(driver: SqlDriver, projectId: string, chapterId: string, ordinal: number): Promise<void> {
  const contractRows = await driver.query<{ payload_json: string }>(
    { sql: `SELECT revision.payload_json FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision WHERE doc.project_id = ? AND doc.document_id = ? AND doc.document_type = 'chapter_contract' AND doc.status = 'approved'`, params: [projectId, planningDocumentId(projectId, "chapter_contract", chapterId)] },
  );
  if (!contractRows[0]) throw new Error("ChapterContract 不存在或尚未批准，不能提交正式章节。 ");
  const contract = parseRecord(contractRows[0].payload_json, "ChapterContract");
  if (contract.chapterId !== chapterId || contract.ordinal !== ordinal) throw new Error("ProductionCommit 的 chapterOrdinal 必须匹配已批准 ChapterContract。 ");
  const current = await driver.query<{ ordinal: number }>({ sql: "SELECT ordinal FROM chapters WHERE project_id = ? AND chapter_id = ?", params: [projectId, chapterId] });
  if (current[0]) {
    if (current[0].ordinal !== ordinal) throw new Error("已存在章节的 ordinal 不可被 ProductionCommit 静默改变。 ");
    return;
  }
  const previous = await driver.query<{ ordinal: number }>({ sql: "SELECT MAX(ordinal) AS ordinal FROM chapters WHERE project_id = ?", params: [projectId] });
  if (previous[0]?.ordinal !== null && ordinal !== Number(previous[0].ordinal) + 1) throw new Error("新章节必须紧接当前生产游标，不能跳过或倒序提交。 ");
}

interface SelectedDraft {
  documentId: string;
  title: string;
  text: string;
  manifestId: string;
  model: string;
  executionRef: string;
  revision: "v1" | "v2" | "v3";
  reviewLineage: string[];
}

async function selectedDraft(
  driver: SqlDriver,
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">,
  projectId: string,
  chapterId: string,
  documentId: string,
): Promise<SelectedDraft> {
  const draft = await drafts.getDraft(documentId);
  if (!draft || draft.documentId !== documentId || draft.projectId !== projectId || draft.chapterId !== chapterId) {
    throw new Error("被选择的章节草稿不存在，或不属于当前作品和章节。 ");
  }
  if (draft.revision !== "v1" && draft.revision !== "v2" && draft.revision !== "v3") throw new Error("只能接受 V1、V2 或 V3 章节草稿。 ");
  if (draft.documentId !== expectedDraftDocumentId(chapterId, draft.revision)) throw new Error("被选择的章节草稿不是受控版本文档。 ");
  const title = nonEmpty(draft.title, "draft.title");
  const text = nonEmpty(draft.text, "draft.text");
  const manifestId = nonEmpty(draft.manifestId, "draft.manifestId");
  const model = nonEmpty(draft.model, "draft.model");
  const executionRef = nonEmpty(draft.executionRef, "draft.executionRef");
  return { documentId, title, text, manifestId, model, executionRef, revision: draft.revision, reviewLineage: await reviewLineage(driver, drafts, draft) };
}

async function currentMethodOutcome(
  options: Pick<Parameters<typeof createChapterProductionCommitService>[0], "applications" | "outcomes">,
  input: AcceptChapterDraftInput,
  selected: SelectedDraft,
): Promise<{ outcomeId: string; outcomeRevision: number; applicationId: string; applicationRevision: number; reviewId: string; reviewRevision: number } | null> {
  const application = await options.applications?.get({ projectId: input.projectId, chapterId: input.chapterId }) ?? null;
  if (!application) {
    if (input.outcomeId) throw new Error("零方法卡章节不得伪造本章应用结果。 ");
    return null;
  }
  if (!options.outcomes || !input.outcomeId?.trim()) throw new Error("使用本章采用记录的章节必须先保存当前本章应用结果。 ");
  const outcome = await options.outcomes.get({ projectId: input.projectId, chapterId: input.chapterId });
  if (!outcome || outcome.outcomeId !== input.outcomeId || outcome.applicationId !== application.applicationId || outcome.applicationRevision !== application.revision) throw new Error("ProductionCommit 必须引用当前且未过期的本章应用结果。 ");
  if (!selected.reviewLineage.includes(outcome.reviewId)) throw new Error("本章应用结果未绑定所选草稿的 Reviewer 反馈。 ");
  if (outcome.disposition !== "accept_current" && outcome.disposition !== "accept_with_gap") throw new Error("请求修订或暂缓的本章应用结果不能接受为正式章节。 ");
  return { outcomeId: outcome.outcomeId, outcomeRevision: outcome.revision, applicationId: application.applicationId, applicationRevision: application.revision, reviewId: outcome.reviewId, reviewRevision: outcome.reviewRevision };
}

async function reviewLineage(
  driver: SqlDriver,
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">,
  selected: ChapterReaderDraft,
): Promise<string[]> {
  const lineage: string[] = [];
  let current: ChapterReaderDraft = selected;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current.revision === "v1") {
      const reviewId = await requireV1Reviewer(driver, current.projectId, current.chapterId, current.documentId);
      return lineage.length > 0 ? lineage : [reviewId];
    }
    const editor = current as ChapterReaderDraft & { parentDocumentId?: unknown; parentRevision?: unknown; reviewId?: unknown };
    if (typeof editor.parentDocumentId !== "string" || !editor.parentDocumentId.trim() || typeof editor.reviewId !== "string" || !editor.reviewId.trim()) {
      throw new Error("Editor 草稿缺少父版本或 Reviewer 绑定，不能接受。 ");
    }
    const expectedParentRevision = current.revision === "v2" ? "v1" : "v2";
    if (editor.parentRevision !== expectedParentRevision || editor.parentDocumentId !== expectedDraftDocumentId(current.chapterId, expectedParentRevision)) {
      throw new Error("Editor 草稿的父版本链不完整，不能接受。 ");
    }
    lineage.unshift(editor.reviewId);
    const parent = await drafts.getDraft(editor.parentDocumentId);
    if (!parent || parent.documentId !== editor.parentDocumentId || parent.projectId !== current.projectId || parent.chapterId !== current.chapterId || parent.revision !== expectedParentRevision) {
      throw new Error("Editor 草稿的父版本不存在或不匹配，不能接受。 ");
    }
    current = parent;
  }
  throw new Error("章节草稿的版本链超过 V1/V2/V3 上限。 ");
}

async function requireV1Reviewer(driver: SqlDriver, projectId: string, chapterId: string, draftDocumentId: string): Promise<string> {
  const rows = await driver.query<{ payload_json: string }>({
    sql: `SELECT revision.payload_json
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_type = 'chapter_review' AND doc.status = 'reviewed'`,
    params: [projectId],
  });
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (payload.chapterId !== chapterId || payload.draftDocumentId !== draftDocumentId) continue;
    const reviewId = typeof payload.reviewId === "string" ? payload.reviewId : "";
    const manifests = Array.isArray(payload.readerManifestIds) ? payload.readerManifestIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : [];
    const feedback = Array.isArray(payload.readerFeedbackDocumentIds) ? payload.readerFeedbackDocumentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : [];
    if (!reviewId || manifests.length !== 3 || new Set(manifests).size !== 3 || feedback.length !== 3 || new Set(feedback).size !== 3) continue;
    const manifestDocumentIds = manifests.map((id) => `production:reader_context_manifest:${id}`);
    const placeholders = manifestDocumentIds.map(() => "?").join(",");
    const feedbackPlaceholders = feedback.map(() => "?").join(",");
    const counts = await driver.query<{ manifest_count: number; feedback_count: number }>({
      sql: `SELECT
              (SELECT COUNT(*) FROM project_documents WHERE project_id = ? AND document_type = 'reader_context_manifest' AND document_id IN (${placeholders})) AS manifest_count,
              (SELECT COUNT(*) FROM project_documents WHERE project_id = ? AND document_id IN (${feedbackPlaceholders})) AS feedback_count`,
      params: [projectId, ...manifestDocumentIds, projectId, ...feedback],
    });
    if (counts[0]?.manifest_count === 3 && counts[0]?.feedback_count === 3) return reviewId;
  }
  throw new Error("V1 草稿尚无绑定三个 Reader 与 Reviewer 正式报告，不能接受。 ");
}

function expectedDraftDocumentId(chapterId: string, revision: "v1" | "v2" | "v3"): string {
  return `production:chapter_draft:${chapterId}:${revision}`;
}

function acceptedDraft(payload: RecordValue): Pick<SelectedDraft, "documentId" | "revision" | "model" | "executionRef" | "reviewLineage"> {
  const selected = recordValue(payload.selectedDraft, "ChapterText.selectedDraft");
  const revision = selected.revision;
  if (revision !== "v1" && revision !== "v2" && revision !== "v3") throw new Error("ChapterText.selectedDraft.revision 非法。 ");
  return {
    documentId: readString(selected.documentId, "ChapterText.selectedDraft.documentId"),
    revision,
    model: readString(selected.model, "ChapterText.selectedDraft.model"),
    executionRef: readString(selected.executionRef, "ChapterText.selectedDraft.executionRef"),
    reviewLineage: stringList(selected.reviewLineage, "ChapterText.selectedDraft.reviewLineage"),
  };
}

function acceptedLineage(payload: RecordValue, selected: Pick<SelectedDraft, "executionRef" | "model" | "reviewLineage">, manifestId: string): ProductionLineage {
  const lineage = recordValue(payload.lineage, "ChapterText.lineage");
  const runId = lineage.runId;
  if (lineage.schema_version !== 1
    || lineage.selectedDraftExecutionRef !== selected.executionRef
    || lineage.manifestId !== manifestId
    || lineage.model !== selected.model
    || (runId !== null && (typeof runId !== "string" || !runId.trim()))) {
    throw new Error("ChapterText.lineage 与已接受草稿不一致。 ");
  }
  const reviewIds = stringList(lineage.reviewIds, "ChapterText.lineage.reviewIds");
  if (reviewIds.length !== selected.reviewLineage.length || reviewIds.some((id, index) => id !== selected.reviewLineage[index])) {
    throw new Error("ChapterText.lineage 的 Reviewer 链不一致。 ");
  }
  return { schema_version: 1, selectedDraftExecutionRef: selected.executionRef, manifestId, reviewIds, model: selected.model, runId: runId as string | null };
}

async function pipelineRunForExecution(driver: SqlDriver, executionRef: string): Promise<string | null> {
  const rows = await driver.query<{ run_id: string }>({
    sql: "SELECT run_id FROM run_nodes WHERE task_id = ? ORDER BY run_id LIMIT 2",
    params: [executionRef],
  });
  if (rows.length > 1) throw new Error("同一章节执行引用绑定了多个 PipelineRun，不能提交。 ");
  return rows[0]?.run_id ?? null;
}

function chapterTextDocumentId(chapterId: string): string {
  return `production:chapter_text:${chapterId}`;
}

export function chapterProductionCommitProposalDocumentId(chapterId: string): string {
  assertId(chapterId, "chapterId");
  return proposalDocumentId(chapterId);
}

function proposalDocumentId(chapterId: string): string {
  return `production:chapter_production_commit_proposal:${chapterId}`;
}

interface ProposalMethodContext {
  applicationId: string;
  applicationRevision: number;
  reviewId: string;
  reviewRevision: number;
  outcomeId: string;
  outcomeRevision: number;
  disposition: "accept_current" | "accept_with_gap";
  humanDisagreements: string[];
  riskAcceptanceReason: string | null;
  dependencies: Array<{ artifactId: string; revision: number }>;
}

async function proposalMethodContext(
  options: Pick<Parameters<typeof createChapterProductionCommitService>[0], "applications" | "outcomes">,
  projectId: string,
  proposal: ChapterProductionCommitProposal,
): Promise<ProposalMethodContext | null> {
  const application = await options.applications?.get({ projectId, chapterId: proposal.chapterId }) ?? null;
  if (!application) {
    if (proposal.outcomeId) throw new Error("零方法卡章节不得绑定本章应用结果。 ");
    return null;
  }
  if (!proposal.outcomeId || !options.outcomes) throw new Error("使用本章采用记录的章节必须让正式提交提案绑定当前本章应用结果。 ");
  const outcome = await options.outcomes.get({ projectId, chapterId: proposal.chapterId });
  if (!outcome || outcome.outcomeId !== proposal.outcomeId || outcome.applicationId !== application.applicationId || outcome.applicationRevision !== application.revision) {
    throw new Error("正式提交提案必须绑定当前且未过期的本章应用结果。 ");
  }
  if (outcome.disposition !== "accept_current" && outcome.disposition !== "accept_with_gap") throw new Error("请求修订或暂缓的本章应用结果不能准备正式提交提案。 ");
  return {
    applicationId: application.applicationId,
    applicationRevision: application.revision,
    reviewId: outcome.reviewId,
    reviewRevision: outcome.reviewRevision,
    outcomeId: outcome.outcomeId,
    outcomeRevision: outcome.revision,
    disposition: outcome.disposition,
    humanDisagreements: outcome.decisions.filter((decision) => decision.agreement === "disagree").map((decision) => decision.disagreementReason!),
    riskAcceptanceReason: outcome.riskAcceptanceReason ?? null,
    dependencies: [
      { artifactId: `document:${application.applicationId}`, revision: application.revision },
      { artifactId: `document:production:chapter_review:${outcome.reviewId}`, revision: outcome.reviewRevision },
      { artifactId: `document:${chapterMechanismOutcomeDocumentId(proposal.chapterId)}`, revision: outcome.revision },
    ],
  };
}

async function currentProposal(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentType: string; revision: number; stale: boolean; payload: RecordValue } | null> {
  const rows = await driver.query<{ document_type: string; current_revision: number; payload_json: string; stale: number }>({
    sql: `SELECT doc.document_type, artifact.current_revision, revision.payload_json,
                 CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ?`,
    params: [projectId, documentId],
  });
  const row = rows[0];
  return row ? { documentType: row.document_type, revision: row.current_revision, stale: row.stale === 1, payload: parseRecord(row.payload_json, "正式提交提案") } : null;
}

function parseProposal(value: unknown, chapterId: string): ChapterProductionCommitProposal {
  const proposal = recordValue(value, "正式提交提案");
  if (proposal.schema_version !== 1 || proposal.kind !== "chapter_production_commit_proposal") throw new Error("正式提交提案 schema 非法。 ");
  const proposalId = readString(proposal.proposalId, "proposalId");
  if (proposalId !== proposalDocumentId(chapterId)) throw new Error("proposalId 必须与章节唯一对应。 ");
  if (readString(proposal.chapterId, "chapterId") !== chapterId) throw new Error("正式提交提案 chapterId 不匹配。 ");
  const chapterOrdinal = proposal.chapterOrdinal;
  if (!Number.isInteger(chapterOrdinal) || (chapterOrdinal as number) < 1) throw new Error("正式提交提案 chapterOrdinal 非法。 ");
  const outcomeId = proposal.outcomeId === undefined ? undefined : readString(proposal.outcomeId, "outcomeId");
  const canonPatches = recordArray(proposal.canonPatches, "canonPatches") as unknown as CanonPatch[];
  const characterKnowledgePatches = recordArray(proposal.characterKnowledgePatches, "characterKnowledgePatches") as unknown as CharacterKnowledgePatch[];
  const readerPromiseUpdates = recordArray(proposal.readerPromiseUpdates, "readerPromiseUpdates") as unknown as ReaderPromisePatch[];
  const readerState = recordValue(proposal.readerState, "readerState") as unknown as ReaderStatePatch;
  const outlineDrift = recordValue(proposal.outlineDrift, "outlineDrift") as { payload: RecordValue };
  if (!readerState.readerStateId || !readerState.payload || !outlineDrift.payload) throw new Error("正式提交提案缺少读者状态或大纲偏移。 ");
  return {
    schema_version: 1,
    kind: "chapter_production_commit_proposal",
    proposalId,
    chapterId,
    chapterOrdinal: chapterOrdinal as number,
    productionCommitId: readString(proposal.productionCommitId, "productionCommitId"),
    draftDocumentId: readString(proposal.draftDocumentId, "draftDocumentId"),
    ...(outcomeId ? { outcomeId } : {}),
    chapterDelta: recordValue(proposal.chapterDelta, "chapterDelta"),
    canonPatches,
    characterKnowledgePatches,
    readerState,
    readerPromiseUpdates,
    outlineDrift,
  };
}

function proposalSummary(proposal: ChapterProductionCommitProposal, revision: number, method: ProposalMethodContext | null): ChapterProductionCommitProposalSummary {
  return {
    proposalId: proposal.proposalId,
    revision,
    draftDocumentId: proposal.draftDocumentId,
    productionCommitId: proposal.productionCommitId,
    outcomeId: proposal.outcomeId ?? null,
    method: method ? {
      applicationId: method.applicationId,
      applicationRevision: method.applicationRevision,
      reviewId: method.reviewId,
      reviewRevision: method.reviewRevision,
      outcomeId: method.outcomeId,
      outcomeRevision: method.outcomeRevision,
      disposition: method.disposition,
      humanDisagreements: [...method.humanDisagreements],
      riskAcceptanceReason: method.riskAcceptanceReason,
    } : null,
    continuity: {
      canonPatchCount: proposal.canonPatches.length,
      characterKnowledgePatchCount: proposal.characterKnowledgePatches.length,
      readerPromiseUpdateCount: proposal.readerPromiseUpdates.length,
      readerState: "更新读者状态",
      outlineDrift: "已准备大纲偏移记录",
    },
  };
}

async function frozenManifest(driver: SqlDriver, projectId: string, chapterId: string, manifestId: string): Promise<{ object: ObjectReference }> {
  const rows = await driver.query<{
    document_type: string;
    status: string;
    payload_json: string;
    content_object_hash: string | null;
    sha256: string | null;
    byte_length: number | null;
    media_type: string | null;
    stale: number;
  }>({
    sql: `
      SELECT doc.document_type, doc.status, revision.payload_json, revision.content_object_hash,
             object.sha256, object.byte_length, object.media_type,
             CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      LEFT JOIN objects object ON object.sha256 = revision.content_object_hash
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, `production:context_manifest:${manifestId}`],
  });
  const row = rows[0];
  if (!row || row.stale === 1 || row.document_type !== "context_manifest" || row.status !== "frozen" || !row.content_object_hash || !row.sha256 || row.byte_length === null || !row.media_type) throw new Error("必须使用当前且已冻结的 ContextManifest 提交章节。 ");
  const payload = parseRecord(row.payload_json, "ContextManifest payload");
  if (payload.schema_version !== 1 || payload.kind !== "context_manifest" || payload.manifestId !== manifestId || payload.chapterId !== chapterId || payload.taskRole !== "writer" || payload.contextObjectHash !== row.content_object_hash) throw new Error("ContextManifest 与章节不匹配。 ");
  return { object: { sha256: row.sha256, byteLength: row.byte_length, mediaType: row.media_type } };
}

async function currentChapter(driver: SqlDriver, projectId: string, chapterId: string): Promise<{ chapterRevision: number; textRevision: number } | null> {
  const rows = await driver.query<{ chapter_revision: number; text_revision: number | null }>({
    sql: `
      SELECT chapter.current_revision AS chapter_revision, artifact.current_revision AS text_revision
      FROM chapters chapter
      LEFT JOIN project_documents doc ON doc.project_id = chapter.project_id AND doc.document_id = ?
      LEFT JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      WHERE chapter.project_id = ? AND chapter.chapter_id = ?
    `,
    params: [chapterTextDocumentId(chapterId), projectId, chapterId],
  });
  const row = rows[0];
  if (!row) return null;
  if (!Number.isInteger(row.chapter_revision) || !Number.isInteger(row.text_revision)) throw new Error("章节与正文版本状态不一致。 ");
  return { chapterRevision: row.chapter_revision as number, textRevision: row.text_revision as number };
}

function assertHumanActor(command: Omit<CommandEnvelope, "tool" | "args">): void {
  if (command.actor.kind !== "human" && command.actor.kind !== "human_via_agent") throw new Error("只有人类或经人类确认的 Agent 可以接受正式章节。 ");
}

function parseRecord(value: string, label: string): RecordValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return recordValue(parsed, label);
  } catch {
    throw new Error(`${label} 不是 JSON 对象。`);
  }
}

function recordValue(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as RecordValue;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) {
    throw new Error(`${label} 必须是无重复的非空字符串数组。`);
  }
  return [...value] as string[];
}

function recordArray(value: unknown, label: string): RecordValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。 `);
  return value.map((item, index) => recordValue(item, `${label}[${index}]`));
}

function assertExpectedRevision(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error("expectedRevision 必须是 null 或正整数。 ");
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
