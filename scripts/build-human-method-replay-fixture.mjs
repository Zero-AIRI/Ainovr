/**
 * 仅用于人类可读写作方法切片的桌面回放验收。
 * 固定读取历史 r7 对象，固定写入 Codex 测试目录；不是 CLI/MCP 工具，不能接收任意路径。
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";

const repo = path.resolve(import.meta.dirname, "..");
const legacyWorkspace = path.join(repo, "data", "r7-dstdyj-20260809");
const targetWorkspace = "C:/Users/Zero/.codex/fixtures/ainovr-human-method-replay-2026-08-18/AppData/com.ainovr.app";
const now = 1_786_999_000_000;
const projectId = "project:fixture:human-method";
const chapterId = "chapter:fixture:01";
const emptyChapterId = "chapter:fixture:02";
const mechanismId = "mechanism:concrete-desire-recontext:v1";
const draftHash = "03fd169139e3b7c23e9d40e0c52492fdb6a3d0770346c2311a2a5c3cd944a07f";
const manifestHash = "fdd2c2bfd808b6d3ea3109fa3010228ac6fe77a7c364f61a04fac716ece0bb14";

await rm(targetWorkspace, { recursive: true, force: true });
await mkdir(path.join(targetWorkspace, "data", "objects"), { recursive: true });

const legacy = new Database(path.join(legacyWorkspace, "data", "ainovr.sqlite3"), { readonly: true });
const fixture = new Database(path.join(targetWorkspace, "data", "ainovr.sqlite3"));
fixture.pragma("foreign_keys = ON");
fixture.exec(await readFile(path.join(repo, "src", "persistence", "migrations", "0001-initial-schema.sql"), "utf8"));
fixture.exec(await readFile(path.join(repo, "src", "persistence", "migrations", "0002-command-expected-revision.sql"), "utf8"));
fixture.exec("ALTER TABLE provider_profiles ADD COLUMN artifact_id TEXT; ALTER TABLE provider_profiles ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1;");
fixture.exec("ALTER TABLE data_policies ADD COLUMN artifact_id TEXT;");
fixture.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);");
for (const version of ["0001", "0002", "0003", "0004", "0005"]) fixture.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, now);

const objectRows = legacy.prepare("SELECT sha256, byte_length, media_type, created_at, verified_at FROM objects").all();
const insertObject = fixture.prepare("INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)");
for (const object of objectRows) {
  const source = path.join(legacyWorkspace, "data", "objects", object.sha256);
  await cp(source, path.join(targetWorkspace, "data", "objects", object.sha256));
  insertObject.run(object.sha256, object.byte_length, object.media_type, object.created_at, object.verified_at);
}

fixture.prepare("INSERT INTO novel_projects (project_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, 'writing', 1, ?, ?)").run(projectId, "回放验收：零点电台", now, now);
fixture.prepare("INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'novel_project', 1, 'writing', ?, ?)").run(`project:${projectId}`, projectId, now, now);
fixture.prepare("INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, NULL, ?, ?)").run(`project:${projectId}`, JSON.stringify({ schema_version: 1, intent: "fixture_replay" }), JSON.stringify({ kind: "fixture_replay", id: "historical-r7" }), now);
fixture.prepare("INSERT INTO reference_works (reference_work_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, 'archived', 1, ?, ?)").run("reference:fixture:replay", "fixture replay reference", now, now);
fixture.prepare("INSERT INTO source_editions (source_edition_id, reference_work_id, raw_object_hash, normalized_object_hash, source_hash, encoding, byte_length, token_estimate, created_at) VALUES (?, ?, ?, ?, ?, 'utf-8', 1, 1, ?)").run("edition:fixture:replay", "reference:fixture:replay", draftHash, draftHash, draftHash, now);
fixture.prepare("INSERT INTO analysis_projects (analysis_project_id, source_edition_id, segmentation_id, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, 'prepared', 1, ?, ?)").run("analysis:fixture:replay", "edition:fixture:replay", now, now);

const fixtureSource = await readFile(path.join(legacyWorkspace, "data", "objects", draftHash), "utf8");
const evidenceQuote = "港城的夜雨总是带着铁锈味";
const evidenceEndByte = new TextEncoder().encode(evidenceQuote).byteLength;
const evidenceExactHash = createHash("sha256").update(evidenceQuote).digest("hex");
fixture.prepare("INSERT INTO source_spans (span_id, source_edition_id, analysis_unit_id, start_byte, end_byte, source_hash, exact_text_hash, locator_json) VALUES (?, ?, NULL, 0, ?, ?, ?, ?)").run("span:fixture:pending", "edition:fixture:replay", evidenceEndByte, draftHash, evidenceExactHash, JSON.stringify({ kind: "fixture_replay", label: "开场环境细节" }));
fixture.prepare("INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, NULL, ?, 'inferred', ?)").run("analysis-item:fixture:pending", "analysis:fixture:replay", JSON.stringify({ schema_version: 1, kind: "research_conclusion", conclusion: { id: "conclusion:fixture:pending" } }), now);
fixture.prepare("INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'supporting', ?, ?)").run("evidence:fixture:pending", "analysis-item:fixture:pending", "span:fixture:pending", JSON.stringify({ schema_version: 1, fixture_replay: true }), now);
const pendingCard = {
  id: "mechanism:fixture:pending", title: "先让环境触发选择", observation: "开场环境细节先制造身体感，再迫使人物选择行动。", effectHypothesis: "让读者先感到现实压力，再理解人物为什么必须行动。",
  when: ["章节开场需要让压力可感知。"], do: ["先写一个可感知的环境细节。", "再让人物用行动回应压力。"], avoid: ["不要用抽象设定替代可观察压力。"], evidenceSpanIds: ["span:fixture:pending"], counterexampleSpanIds: [], epistemicStatus: "inferred", lifecycle: "candidate", falsification: { status: "bounded", alternativeExplanations: ["人物目标本身也可能承担紧张感。"], applicabilityLimits: ["不适用于需要立即交代规则的场景。"] }, scope: "local", applicability: ["单章开场"], targetLayers: ["draft"], adoption: "pending", originCandidateIds: ["conclusion:fixture:pending"], evidenceInstances: [{ id: "evidence:fixture:pending", originCandidateId: "conclusion:fixture:pending", spanIds: ["span:fixture:pending"], chapterIndexes: [0], threadIds: [] }],
};
fixture.prepare("INSERT INTO mechanism_assets (mechanism_asset_id, analysis_project_id, status, current_revision, created_at, updated_at) VALUES (?, ?, 'candidate', 1, ?, ?)").run(pendingCard.id, "analysis:fixture:replay", now, now);
fixture.prepare("INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, 1, ?, NULL, ?)").run(pendingCard.id, JSON.stringify({ schema_version: 1, kind: "mechanism_asset", card: pendingCard, rawOutputObjectHash: draftHash, forbiddenTerms: [] }), now);

const legacyMechanism = legacy.prepare("SELECT payload_json, neutral_example_object_hash FROM mechanism_asset_revisions WHERE mechanism_asset_id = ? AND revision = 2").get(mechanismId);
fixture.prepare("INSERT INTO mechanism_assets (mechanism_asset_id, analysis_project_id, status, current_revision, created_at, updated_at) VALUES (?, ?, 'verified', 2, ?, ?)").run(mechanismId, "analysis:fixture:replay", now, now);
fixture.prepare("INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, 2, ?, ?, ?)").run(mechanismId, legacyMechanism.payload_json, legacyMechanism.neutral_example_object_hash, now);
fixture.prepare("INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, NULL, 'mechanism_asset', 2, 'verified', ?, ?)").run(`mechanism:${mechanismId}`, now, now);
fixture.prepare("INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 2, 1, ?, NULL, ?, ?)").run(`mechanism:${mechanismId}`, legacyMechanism.payload_json, JSON.stringify({ kind: "fixture_replay", id: "historical-r7" }), now);
fixture.prepare("INSERT INTO mechanism_adoptions (adoption_id, mechanism_asset_id, project_id, status, actor_json, created_at, updated_at) VALUES (?, ?, ?, 'adopted', ?, ?, ?)").run("adoption:fixture:method", mechanismId, projectId, JSON.stringify({ kind: "fixture_replay", id: "historical-r7" }), now, now);

function document(documentId, documentType, status, payload, contentHash = null) {
  const artifactId = `document:${documentId}`;
  fixture.prepare("INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, ?, ?, ?)").run(artifactId, projectId, status, now, now);
  fixture.prepare("INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)").run(documentId, projectId, documentType, status, artifactId, now, now);
  fixture.prepare("INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, ?, ?, ?)").run(artifactId, JSON.stringify(payload), contentHash, JSON.stringify({ kind: "fixture_replay", id: "historical-r7" }), now);
}

const card = JSON.parse(legacyMechanism.payload_json).card;
const transferCard = { id: card.id, title: card.title, targetEffect: card.effectHypothesis, scope: card.scope, when: card.when, operations: card.do, avoid: card.avoid, applicability: card.applicability, targetLayers: card.targetLayers };
function contract(id, ordinal) { return { schema_version: 1, kind: "chapter_contract", chapterId: id, ordinal, desire: "修好旧电台，验证父亲留下的信号。", pressure: "清场倒计时正在推进。", turningPoint: "电台传来带地标的求救。", emotionalCycle: "专注转为不安，再转为行动。", entryState: ["林岚在夜班维修站。"], exitState: ["林岚决定追查北岸老灯塔。"], mustNotHappen: ["不得揭示父亲失踪真相。"], nextChapterInterface: ["保留求救声的未解释细节。"], readerPromiseAction: "establish" }; }
document(`planning:${projectId}:chapter_contract:${chapterId}`, "chapter_contract", "approved", contract(chapterId, 1));
document(`planning:${projectId}:chapter_contract:${emptyChapterId}`, "chapter_contract", "approved", contract(emptyChapterId, 2));

const applicationId = `production:chapter_mechanism_application:${chapterId}`;
const fields = { reason: { status: "specified", value: "让行动选择从私人修复转为可验证追查。" }, plannedUse: { status: "specified", value: "在电台稳定和求救声出现之间建立清晰的愿望回收。" }, observableReaderEffect: { status: "specified", value: "读者会把林岚离开维修站理解为由早段愿望驱动的选择。" }, misuseToAvoid: { status: "specified", value: "不把求救声写成没有前置愿望的突兀反转。" }, reviewSignals: [{ status: "specified", value: "读者能感到早段愿望被后段行动重新解释" }, { status: "specified", value: "求救声没有替代人物自己的选择" }] };
document(applicationId, "chapter_mechanism_application", "approved", { schema_version: 1, kind: "chapter_mechanism_application", applicationId, chapterId, chapterContractRevision: 1, mechanismAssetId: mechanismId, mechanismRevision: 2, fields });
document(`production:creative_recipe:${chapterId}`, "creative_recipe", "approved", { schema_version: 1, kind: "creative_recipe", chapterId, chapterContractRevision: 1, applicationId, applicationRevision: 1, mechanismAssetId: mechanismId, mechanismRevision: 2, writerMechanisms: [transferCard], editorMechanisms: [transferCard] });
document("production:context_manifest:manifest:fixture:01:v1", "context_manifest", "frozen", { schema_version: 1, kind: "context_manifest", manifestId: "manifest:fixture:01:v1", chapterId, taskRole: "writer", tokenBudget: 8192, reservedOutputTokens: 2500, tokenEstimate: 1486, contextObjectHash: manifestHash }, manifestHash);
document(`production:chapter_draft:${chapterId}:v1`, "local_creation_draft", "draft", { schema_version: 1, kind: "local_creation_draft", taskId: "fixture_replay:writer-v1", provider: "fixture_replay", model: "historical-qwen3.5:9b", finishReason: "stop", generatedAt: now, contextMetadata: { schema_version: 1, kind: "chapter_writer_draft", chapterId, manifestId: "manifest:fixture:01:v1", revision: "v1" }, title: "第一章：零点前的杂音", fixtureReplay: true }, draftHash);

const draftText = fixtureSource;
const quote = "她想修好它";
const startByte = new TextEncoder().encode(draftText.slice(0, draftText.indexOf(quote))).byteLength;
const endByte = startByte + new TextEncoder().encode(quote).byteLength;
const readerManifestIds = ["fixture:reader:immersive", "fixture:reader:low-patience", "fixture:reader:logic"];
const readerFeedbackDocumentIds = ["production:reader_feedback:fixture:immersive", "production:reader_feedback:fixture:low-patience", "production:reader_feedback:fixture:logic"];
for (const [index, manifestId] of readerManifestIds.entries()) {
  document(`production:reader_context_manifest:${manifestId}`, "reader_context_manifest", "frozen", { schema_version: 1, kind: "reader_context_manifest", manifestId, chapterId, readerKind: ["immersive", "low_patience", "logic_sensitive"][index], fixtureReplay: true });
  document(readerFeedbackDocumentIds[index], "local_creation_draft", "draft", { schema_version: 1, kind: "chapter_reader_feedback", chapterId, manifestId, fixtureReplay: true });
}
const review = { schema_version: 1, kind: "chapter_review", reviewId: "review:fixture:01:v1", projectId, chapterId, draftDocumentId: `production:chapter_draft:${chapterId}:v1`, draftRevision: "v1", readerManifestIds, readerFeedbackDocumentIds, applicationId, applicationRevision: 1, writerManifestId: "manifest:fixture:01:v1", writerManifestRevision: 1, issues: [], effectAssessments: [{ signal: fields.reviewSignals[0], status: "observed", explanation: "早段修复愿望在离开维修站的行动中获得了新的、可观察的意义。", anchors: [{ startByte, endByte, quote }], suggestedAction: "accept_current" }, { signal: fields.reviewSignals[1], status: "partial", explanation: "求救声推动了行动，但仍可进一步压低外部信息替代人物选择的感觉。", anchors: [], sideEffect: "倒计时与求救声同时加压，可能掩盖人物主动判断。", suggestedAction: "request_revision" }] };
const reviewBytes = new TextEncoder().encode(JSON.stringify(review));
const reviewHash = createHash("sha256").update(reviewBytes).digest("hex");
await writeFile(path.join(targetWorkspace, "data", "objects", reviewHash), reviewBytes);
fixture.prepare("INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)").run(reviewHash, reviewBytes.byteLength, "application/vnd.ainovr.chapter-review+json", now, now);
document(`production:chapter_review:${review.reviewId}`, "chapter_review", "reviewed", { schema_version: 1, kind: "chapter_review", reviewId: review.reviewId, chapterId, draftDocumentId: review.draftDocumentId, draftRevision: "v1", readerManifestIds: review.readerManifestIds, readerFeedbackDocumentIds: review.readerFeedbackDocumentIds, applicationId, applicationRevision: 1, writerManifestId: "manifest:fixture:01:v1", writerManifestRevision: 1, issueCount: 0, effectAssessmentCount: 2, fixtureReplay: true }, reviewHash);
fixture.prepare("INSERT INTO workspace_meta (key, value_json, updated_at) VALUES ('fixture_replay', ?, ?)").run(JSON.stringify({ historicalWorkspace: "r7-dstdyj-20260809", purpose: "human_method_visual_acceptance", productionCommitExecuted: false }), now);
fixture.close(); legacy.close();
console.log(JSON.stringify({ workspace: targetWorkspace, projectId, chapterId, emptyChapterId, reviewId: review.reviewId, copiedObjects: objectRows.length, marker: "fixture_replay" }));
