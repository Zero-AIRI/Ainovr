import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();

export interface AnalysisBriefQuestion {
  id: string;
  question: string;
  rationale: string;
  productionUse: string;
  requiredEvidence: string[];
  estimatedCostTokens: number;
  abstentionReason: string;
}

export interface AnalysisBrief {
  analysisProjectId: string;
  status: "pending_review" | "approved";
  questions: Array<AnalysisBriefQuestion & { ordinal: number; status: "pending_review" | "approved" }>;
}

export interface AnalysisBriefService {
  submit(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
  approve(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }): Promise<CommandResult>;
  get(analysisProjectId: string): Promise<AnalysisBrief | null>;
}

export interface CreateAnalysisBriefServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * AnalysisBrief 是解释型分析的明确开关。事实/线程可以先运行，研究问题必须由人类批准后
 * 才能成为后续结论与反证任务的输入；它不把模型的自由描述当作已批准研究方向。
 */
export function createAnalysisBriefService(options: CreateAnalysisBriefServiceOptions): AnalysisBriefService {
  return {
    async submit(input) {
      if (!input.analysisProjectId.trim() || !input.rawOutput.trim()) throw new Error("analysisProjectId 与 rawOutput 必须是非空字符串。 ");
      const questions = parseAnalysisBriefOutput(input.rawOutput);
      const rawOutput = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/json; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        tool: "commit_analysis_brief",
        args: { analysisProjectId: input.analysisProjectId, rawOutput, questions },
      });
    },

    async approve(input) {
      if (!input.analysisProjectId.trim()) throw new Error("analysisProjectId 必须是非空字符串。 ");
      return options.commands.execute({ ...input.command, tool: "approve_analysis_brief", args: { analysisProjectId: input.analysisProjectId } });
    },

    async get(analysisProjectId) {
      const rows = await options.driver.query<{ research_question_id: string; payload_json: string; status: "pending_review" | "approved"; ordinal: number }>({
        sql: "SELECT research_question_id, payload_json, status, ordinal FROM research_questions WHERE analysis_project_id = ? ORDER BY ordinal ASC, research_question_id ASC",
        params: [analysisProjectId],
      });
      if (rows.length === 0) return null;
      const questions = rows.map((row) => ({ ...parseQuestionPayload(row.payload_json), id: row.research_question_id, ordinal: row.ordinal, status: row.status }));
      return {
        analysisProjectId,
        status: questions.every((question) => question.status === "approved") ? "approved" : "pending_review",
        questions,
      };
    },
  };
}

/** 解析模型或外部 Agent 提交的研究问题；不进行 Markdown 容错猜测。 */
export function parseAnalysisBriefOutput(rawOutput: string): AnalysisBriefQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error("AnalysisBrief 输出必须是单个 JSON 对象。 ");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["questions"]) || !Array.isArray(parsed.questions)) throw new Error("AnalysisBrief 必须只包含 questions 数组。 ");
  if (parsed.questions.length > 5) throw new Error("AnalysisBrief 最多只能包含五个研究问题。 ");
  const ids = new Set<string>();
  return parsed.questions.map((value, index) => {
    if (!isRecord(value) || !hasExactKeys(value, ["id", "question", "rationale", "productionUse", "requiredEvidence", "estimatedCostTokens", "abstentionReason"])) throw new Error(`questions[${index}] 字段不完整或包含额外字段。`);
    const id = nonEmpty(value.id, `questions[${index}].id`);
    if (ids.has(id)) throw new Error(`AnalysisBrief 问题 id 重复：${id}。`);
    ids.add(id);
    const requiredEvidence = stringList(value.requiredEvidence, `questions[${index}].requiredEvidence`);
    if (!Number.isInteger(value.estimatedCostTokens) || (value.estimatedCostTokens as number) < 0) throw new Error(`questions[${index}].estimatedCostTokens 必须是非负整数。`);
    return {
      id,
      question: nonEmpty(value.question, `questions[${index}].question`),
      rationale: nonEmpty(value.rationale, `questions[${index}].rationale`),
      productionUse: nonEmpty(value.productionUse, `questions[${index}].productionUse`),
      requiredEvidence,
      estimatedCostTokens: value.estimatedCostTokens as number,
      abstentionReason: nonEmpty(value.abstentionReason, `questions[${index}].abstentionReason`),
    };
  });
}

function parseQuestionPayload(value: string): Omit<AnalysisBriefQuestion, "id"> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.schema_version !== 1 || parsed.kind !== "analysis_brief_question" || !isRecord(parsed.question)) throw new Error("ResearchQuestion payload 损坏。 ");
  const question = parsed.question as unknown as AnalysisBriefQuestion;
  const validated = parseAnalysisBriefOutput(JSON.stringify({ questions: [{ ...question, id: "revalidate" }] }))[0]!;
  const { id: _id, ...result } = validated;
  return result;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  return value.map((item, index) => nonEmpty(item, `${label}[${index}]`));
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
