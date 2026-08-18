import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createApplicationMcpJsonRpcHandler, type ApplicationMcpJsonRpcRequest } from "@/application/application-mcp-jsonrpc";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createStructuralReadingMapService } from "@/application/structural-reading-map-service";
import { createLocalFactExtractionService } from "@/application/local-fact-extraction-service";
import { createLocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createResearchDossierService } from "@/application/research-dossier-service";
import { createEvidenceWorkbenchService } from "@/application/evidence-workbench-service";
import { createMechanismAssetService } from "@/application/mechanism-asset-service";
import { createStoryPlanningService } from "@/application/story-planning-service";
import { createCreativeRecipeService } from "@/application/creative-recipe-service";
import { createChapterMechanismApplicationService } from "@/application/chapter-mechanism-application-service";
import { createChapterMechanismOutcomeService } from "@/application/chapter-mechanism-outcome-service";
import { createMechanismEffectExperimentService } from "@/application/mechanism-effect-experiment-service";
import { createMechanismEffectExperimentWriterService } from "@/application/mechanism-effect-experiment-writer-service";
import { createMechanismEffectExperimentBlindReviewService, validateMechanismEffectExperimentBlindReviewOutput } from "@/application/mechanism-effect-experiment-blind-review-service";
import { createChapterMethodWorkbenchService } from "@/application/chapter-method-workbench-service";
import { createChapterContextManifestService } from "@/application/chapter-context-manifest-service";
import { createChapterReaderManifestService } from "@/application/chapter-reader-manifest-service";
import { createChapterReviewService } from "@/application/chapter-review-service";
import { createChapterEditorService } from "@/application/chapter-editor-service";
import { createChapterEditorTaskService, parseChapterEditorPatchOutput, validateChapterEditorPatchOutput } from "@/application/chapter-editor-task-service";
import { createChapterReaderService, validateChapterReaderOutput } from "@/application/chapter-reader-service";
import { createChapterReviewerService, validateChapterReviewerOutput } from "@/application/chapter-reviewer-service";
import { createChapterProductionCommitService } from "@/application/chapter-production-commit-service";
import { createChapterWriterService } from "@/application/chapter-writer-service";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createReferenceFileImportService } from "@/application/reference-file-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createWorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import { createWorkspaceExportService } from "@/application/workspace-export-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceBackupRepository } from "@/persistence/node-workspace-backup";
import { createNodeWorkspaceExportRepository } from "@/persistence/node-workspace-export";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import { createModelResolver } from "@/application/model-resolver";
import { createPipelineRevisionService } from "@/application/pipeline-revision-service";
import { createRoutedModelCaller } from "@/runtime/routed-model-caller";
import { createEnvironmentSecretStore } from "@/runtime/secret-store";
import { resolveWorkspacePath } from "@/runtime/workspace-resolution";

const workspaceRoot = resolveWorkspaceArg(process.argv.slice(2));
const driver = await createNodeSqlDriver({ workspacePath: workspaceRoot });
const schemas = createSchemaRegistry();
registerCorePayloadSchemas(schemas);
const tasks = createTaskRunner(driver);
const objects = await createNodeObjectStore({ workspacePath: workspaceRoot });
const modelResolver = createModelResolver(driver);
const application = createWorkspaceApplicationService({ driver, schemas, objects, tasks, modelResolver });
const modelCaller = createRoutedModelCaller({ secrets: createEnvironmentSecretStore() });
const pipelines = createPipelineRevisionService({ driver, commands: application.commands });
const maintenance = createWorkspaceMaintenanceService({
  commands: application.commands,
  tasks,
  objects,
  backups: createNodeWorkspaceBackupRepository({ workspacePath: workspaceRoot, driver }),
  hostId: `mcp-maintenance:${process.pid}`,
});
const exporter = createWorkspaceExportService({
  commands: application.commands,
  queries: application.queries,
  tasks,
  objects,
  repository: createNodeWorkspaceExportRepository({ workspacePath: workspaceRoot }),
  hostId: `mcp-export:${process.pid}`,
});
const creation = createLocalCreationService({
  driver,
  schemas,
  commands: application.commands,
  tasks,
  objects,
  caller: modelCaller,
  hostId: `mcp:${process.pid}`,
  modelResolver,
  defaultModelRole: "writer",
});
const references = createReferenceImportService({
  driver,
  commands: application.commands,
  objects,
});
const referenceFileImport = createReferenceFileImportService({
  commands: application.commands,
  tasks,
  objects,
  references,
  hostId: `mcp-reference-file:${process.pid}`,
});
const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, modelResolver });
const facts = createAnalysisFactService({ driver, commands: application.commands, objects });
const maps = createStructuralReadingMapService({ driver, commands: application.commands, objects });
const factExtraction = createLocalFactExtractionService({ driver, commands: application.commands, tasks, objects, facts, caller: { complete: async (input, signal) => modelCaller.complete({ baseURL: input.baseURL, model: input.model, providerProfileId: input.providerProfileId, protocol: input.protocol, prompt: `${input.systemPrompt}\n\n${input.prompt}`, maxTokens: input.maxTokens, outputMode: "structured_json" }, signal) }, hostId: `mcp-fact:${process.pid}`, modelResolver });
const batchFactExtraction = createLocalFactExtractionBatchService({ commands: application.commands, tasks, objects, corpus, extraction: factExtraction, hostId: `mcp-fact-batch:${process.pid}`, modelResolver });
const threads = createThreadGraphService({ driver, commands: application.commands, objects });
const brief = createAnalysisBriefService({ driver, commands: application.commands, objects });
const conclusions = createResearchConclusionService({ driver, commands: application.commands, objects });
const falsification = createIndependentFalsificationService({ driver, commands: application.commands, objects });
const dossier = createResearchDossierService({ driver, commands: application.commands, objects });
const workbench = createEvidenceWorkbenchService({ driver });
const mechanisms = createMechanismAssetService({ driver, commands: application.commands, objects });
const planning = createStoryPlanningService({ driver, commands: application.commands, objects });
const chapterMechanismApplications = createChapterMechanismApplicationService({ driver, commands: application.commands, mechanisms });
const recipes = createCreativeRecipeService({ driver, commands: application.commands, mechanisms, applications: chapterMechanismApplications });
const manifests = createChapterContextManifestService({ driver, commands: application.commands, objects, modelResolver });
const writer = createChapterWriterService({ local: creation, manifests });
let editorService: ReturnType<typeof createChapterEditorService> | null = null;
const chapterDrafts = { getDraft: async (documentId: string) => await editorService?.getDraft(documentId) ?? writer.getDraft({ documentId }) };
const readerManifests = createChapterReaderManifestService({ driver, commands: application.commands, objects, drafts: chapterDrafts });
const readerCreation = createLocalCreationService({ driver, schemas, commands: application.commands, tasks, objects, caller: modelCaller, hostId: `mcp-reader:${process.pid}`, validateOutput: validateChapterReaderOutput, modelResolver, defaultModelRole: "reader" });
const readers = createChapterReaderService({ local: readerCreation, manifests: readerManifests });
const reviews = createChapterReviewService({ driver, commands: application.commands, objects, drafts: chapterDrafts, readerManifests, applications: chapterMechanismApplications });
editorService = createChapterEditorService({ driver, commands: application.commands, objects, baseDrafts: chapterDrafts, reviews });
const chapterMechanismOutcomes = createChapterMechanismOutcomeService({ driver, commands: application.commands, applications: chapterMechanismApplications, reviews });
const mechanismEffectExperiments = createMechanismEffectExperimentService({ driver, commands: application.commands, objects, mechanisms });
const mechanismEffectWriter = createMechanismEffectExperimentWriterService({ experiments: mechanismEffectExperiments, manifests, mechanisms, local: creation });
const blindReviewCreation = createLocalCreationService({ driver, schemas, commands: application.commands, tasks, objects, caller: modelCaller, hostId: `mcp-mechanism-effect-blind-review:${process.pid}`, validateOutput: validateMechanismEffectExperimentBlindReviewOutput, modelResolver, defaultModelRole: "reviewer" });
const mechanismEffectBlindReview = createMechanismEffectExperimentBlindReviewService({ experiments: mechanismEffectExperiments, manifests, drafts: creation, local: blindReviewCreation });
const production = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts: chapterDrafts, applications: chapterMechanismApplications, outcomes: chapterMechanismOutcomes });
const chapterMethodWorkbench = createChapterMethodWorkbenchService({ driver, mechanisms, applications: chapterMechanismApplications, recipes, reviews, outcomes: chapterMechanismOutcomes, production });
// 运行时组装豁免：只有正式 Review commit 成功，TaskRunner 才会标记本机任务成功。
const reviewerCreation = createLocalCreationService({
  driver, schemas, commands: application.commands, tasks, objects, caller: modelCaller, hostId: `mcp-reviewer:${process.pid}`, modelResolver, defaultModelRole: "reviewer",
  validateOutput: validateChapterReviewerOutput,
  commitOutput: async ({ taskId, projectId, text, metadata }) => {
    const input = reviewerCommitMetadata(metadata);
    const result = await reviews.submit({
      command: { schemaVersion: 1, commandId: `commit:chapter-reviewer:${taskId}`, idempotencyKey: `commit:chapter-reviewer:${taskId}`, correlationId: `task:${taskId}`, actor: { kind: "internal_agent", id: `mcp-reviewer:${process.pid}` }, projectId, createdAt: Date.now() },
      projectId, chapterId: input.chapterId, draftDocumentId: input.draftDocumentId, reviewId: input.reviewId, readerManifestIds: input.readerManifestIds, readerFeedbackDocumentIds: input.readerFeedbackDocumentIds, rawOutput: text,
    });
    if (result.kind !== "ok") throw new Error(`Reviewer 正式报告提交失败：${result.kind}`);
  },
});
const reviewer = createChapterReviewerService({ local: reviewerCreation, drafts: chapterDrafts, readerManifests, readerFeedbacks: readers, reviews, applications: chapterMechanismApplications });
// 运行时组装豁免：补丁 JSON 与正式 Editor 草稿分别保留，任务成功依赖领域提交。
const editorCreation = createLocalCreationService({
  driver, schemas, commands: application.commands, tasks, objects, caller: modelCaller, hostId: `mcp-editor:${process.pid}`, modelResolver, defaultModelRole: "editor",
  validateOutput: validateChapterEditorPatchOutput,
  commitOutput: async ({ taskId, projectId, prompt, text, metadata, output, model }) => {
    const patch = parseChapterEditorPatchOutput({ taskId, projectId, prompt, metadata }, text);
      const result = await editorService!.create({
        command: { schemaVersion: 1, commandId: `commit:chapter-editor:${taskId}`, idempotencyKey: `commit:chapter-editor:${taskId}`, correlationId: `task:${taskId}`, actor: { kind: "internal_agent", id: `mcp-editor:${process.pid}` }, projectId, createdAt: Date.now() },
      executionRef: taskId, projectId, chapterId: patch.chapterId, documentId: patch.targetDocumentId, title: patch.title, sourceDraftDocumentId: patch.sourceDraftDocumentId, reviewId: patch.reviewId, selectedIssueIds: patch.selectedIssueIds, editedText: patch.editedText, rationale: patch.rationale, model, rawOutput: output,
    });
    if (result.kind !== "ok") throw new Error(`Editor 正式草稿提交失败：${result.kind}`);
  },
});
const editorTasks = createChapterEditorTaskService({ local: editorCreation, drafts: chapterDrafts, reviews, editor: editorService });
const desktopTransport = process.argv.includes("--desktop-ui") && process.env.AINOVR_DESKTOP_SIDECAR === "1" ? "desktop_ui" : "stdio";
const handler = createApplicationMcpJsonRpcHandler({ application, tasks, creation, maintenance, exporter, references, referenceFileImport, corpus, facts, maps, factExtraction, batchFactExtraction, threads, brief, conclusions, falsification, dossier, workbench, mechanisms, planning, chapterApplications: chapterMechanismApplications, chapterOutcomes: chapterMechanismOutcomes, mechanismEffectExperiments, mechanismEffectWriter, mechanismEffectBlindReview, chapterMethodWorkbench, recipes, manifests, readerManifests, readers, reviewer, reviews, editor: editorService, editorTasks, production, writer, pipelines, transport: desktopTransport });

const lines = createInterface({ input: stdin, crlfDelay: Infinity, terminal: false });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request: ApplicationMcpJsonRpcRequest;
  try {
    request = JSON.parse(line) as ApplicationMcpJsonRpcRequest;
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    continue;
  }
  try {
    const response = await handler(request);
    if (response !== null) write(response);
  } catch (cause) {
    write({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: safeError(cause) } });
  }
}

await driver.close();

function write(value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`);
}

function resolveWorkspaceArg(args: string[]): string {
  return resolveWorkspacePath({ args, env: process.env, cwd: process.cwd() });
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-****").slice(0, 1000);
}

function reviewerCommitMetadata(metadata: Record<string, unknown> | undefined): { reviewId: string; chapterId: string; draftDocumentId: string; readerManifestIds: string[]; readerFeedbackDocumentIds: string[] } {
  if (!metadata || metadata.kind !== "chapter_reviewer_report") throw new Error("Reviewer task 缺少受控提交 metadata。 ");
  const requireString = (key: string): string => {
    const value = metadata[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Reviewer task metadata.${key} 非法。`);
    return value;
  };
  const requireIds = (key: string): string[] => {
    const value = metadata[key];
    if (!Array.isArray(value) || value.length !== 3 || new Set(value).size !== 3 || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`Reviewer task metadata.${key} 必须是三个不重复的标识。`);
    return [...value] as string[];
  };
  return { reviewId: requireString("reviewId"), chapterId: requireString("chapterId"), draftDocumentId: requireString("draftDocumentId"), readerManifestIds: requireIds("readerManifestIds"), readerFeedbackDocumentIds: requireIds("readerFeedbackDocumentIds") };
}
