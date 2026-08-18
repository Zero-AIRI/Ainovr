/**
 * Node 与 Tauri 共同使用的 R1 首个迁移。正文、原文、Prompt 等大文本只存对象 Hash。
 */
import initialSchemaSql from "@/persistence/migrations/0001-initial-schema.sql?raw";
import commandExpectedRevisionSql from "@/persistence/migrations/0002-command-expected-revision.sql?raw";
import providerProfileRevisionsSql from "@/persistence/migrations/0003-provider-profile-revisions.sql?raw";
import dataPolicyRevisionsSql from "@/persistence/migrations/0004-data-policy-revisions.sql?raw";
import projectScopedPlanningDocumentIdsSql from "@/persistence/migrations/0005-project-scoped-planning-document-ids.sql?raw";

export const INITIAL_SCHEMA_VERSION = "0001";
export const INITIAL_SCHEMA_SQL = initialSchemaSql;
export const COMMAND_EXPECTED_REVISION_SCHEMA_VERSION = "0002";
export const COMMAND_EXPECTED_REVISION_SQL = commandExpectedRevisionSql;
export const PROVIDER_PROFILE_REVISIONS_SCHEMA_VERSION = "0003";
export const PROVIDER_PROFILE_REVISIONS_SQL = providerProfileRevisionsSql;
export const DATA_POLICY_REVISIONS_SCHEMA_VERSION = "0004";
export const DATA_POLICY_REVISIONS_SQL = dataPolicyRevisionsSql;
export const PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SCHEMA_VERSION = "0005";
export const PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SQL = projectScopedPlanningDocumentIdsSql;
