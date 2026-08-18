import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { buildStructuralReadingMap, type StructuralReadingMap } from "@/lib/analysis/structural-reading-map";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface StructuralReadingMapService {
  create(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }): Promise<CommandResult>;
  get(analysisProjectId: string): Promise<StructuralReadingMap | null>;
}

export interface CreateStructuralReadingMapServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * ReadingMap 的第一层是可机械验证的结构地图：它只反映冻结的段落、单元和 UTF-8 区间。
 * 实体、事件和跨单元候选必须由后续严格 FactLedger/ThreadGraph 任务生成，不能在这里臆测。
 */
export function createStructuralReadingMapService(options: CreateStructuralReadingMapServiceOptions): StructuralReadingMapService {
  const now = options.now ?? Date.now;
  return {
    async create(input) {
      if (!input.analysisProjectId.trim()) throw new Error("analysisProjectId 必须是非空字符串。");
      const corpus = await readCorpusMetadata(options.driver, input.analysisProjectId);
      if (!corpus) throw new Error("AnalysisProject 不存在或未冻结 AnalysisCorpus。");
      const map = buildStructuralReadingMap({ ...corpus, analysisProjectId: input.analysisProjectId, createdAt: now() });
      const mapObject = await options.objects.put({
        content: encoder.encode(JSON.stringify(map)),
        mediaType: "application/vnd.ainovr.structural-reading-map+json",
      });
      return options.commands.execute({
        ...input.command,
        tool: "commit_structural_reading_map",
        args: {
          analysisProjectId: input.analysisProjectId,
          mapObject,
          map: {
            schema_version: map.schema_version,
            kind: map.kind,
            sourceEditionId: map.sourceEditionId,
            segmentationId: map.segmentationId,
            sourceHash: map.sourceHash,
            totalUnits: map.totalUnits,
            totalSpans: map.totalSpans,
            units: map.units,
          },
        },
      });
    },

    async get(analysisProjectId) {
      const rows = await options.driver.query<{ payload_json: string }>({
        sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at DESC, analysis_item_id DESC",
        params: [analysisProjectId],
      });
      for (const row of rows) {
        const reference = parseMapReference(row.payload_json);
        if (!reference) continue;
        const map = parseMap(decoder.decode(await options.objects.read(reference.objectHash)));
        if (map.analysisProjectId !== analysisProjectId) throw new Error("ReadingMap 与 AnalysisProject 不匹配。");
        return map;
      }
      return null;
    },
  };
}

async function readCorpusMetadata(driver: SqlDriver, analysisProjectId: string): Promise<Omit<Parameters<typeof buildStructuralReadingMap>[0], "analysisProjectId" | "createdAt"> | null> {
  const projects = await driver.query<{ source_edition_id: string; segmentation_id: string; source_hash: string }>({
    sql: `SELECT project.source_edition_id, project.segmentation_id, edition.source_hash
          FROM analysis_projects project INNER JOIN source_editions edition ON edition.source_edition_id = project.source_edition_id
          WHERE project.analysis_project_id = ?`,
    params: [analysisProjectId],
  });
  const project = projects[0];
  if (!project || !project.segmentation_id) return null;
  const [units, spans] = await Promise.all([
    driver.query<{ analysis_unit_id: string; ordinal: number; start_byte: number; end_byte: number }>({
      sql: "SELECT analysis_unit_id, ordinal, start_byte, end_byte FROM analysis_units WHERE segmentation_id = ? ORDER BY ordinal ASC",
      params: [project.segmentation_id],
    }),
    driver.query<{ span_id: string; analysis_unit_id: string; start_byte: number; end_byte: number; locator_json: string }>({
      sql: `SELECT span.span_id, span.analysis_unit_id, span.start_byte, span.end_byte, span.locator_json
            FROM source_spans span
            INNER JOIN analysis_units unit ON unit.analysis_unit_id = span.analysis_unit_id
            WHERE unit.segmentation_id = ? AND span.source_edition_id = ?
            ORDER BY span.start_byte ASC, span.span_id ASC`,
      params: [project.segmentation_id, project.source_edition_id],
    }),
  ]);
  const spansByUnit = new Map<string, Array<{ spanId: string; kind: string; startByte: number; endByte: number }>>();
  for (const span of spans) {
    const locator = parseRecord(span.locator_json, "SourceSpan locator");
    const kind = typeof locator.kind === "string" && locator.kind.trim() ? locator.kind : "unknown";
    const values = spansByUnit.get(span.analysis_unit_id) ?? [];
    values.push({ spanId: span.span_id, kind, startByte: span.start_byte, endByte: span.end_byte });
    spansByUnit.set(span.analysis_unit_id, values);
  }
  return {
    sourceEditionId: project.source_edition_id,
    segmentationId: project.segmentation_id,
    sourceHash: project.source_hash,
    units: units.map((unit) => ({
      analysisUnitId: unit.analysis_unit_id,
      ordinal: unit.ordinal,
      startByte: unit.start_byte,
      endByte: unit.end_byte,
      spans: spansByUnit.get(unit.analysis_unit_id) ?? [],
    })),
  };
}

function parseMapReference(value: string): { objectHash: string } | null {
  const payload = parseRecord(value, "AnalysisItem payload");
  if (payload.kind !== "structural_reading_map") return null;
  return typeof payload.mapObjectHash === "string" && /^[a-f0-9]{64}$/.test(payload.mapObjectHash) ? { objectHash: payload.mapObjectHash } : null;
}

function parseMap(value: string): StructuralReadingMap {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ReadingMap 对象损坏。");
  const map = parsed as StructuralReadingMap;
  if (map.schema_version !== 1 || map.kind !== "structural_reading_map" || !Array.isArray(map.units)) throw new Error("ReadingMap schema 无效。");
  return map;
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} 损坏。`);
  return parsed as Record<string, unknown>;
}
