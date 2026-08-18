-- 0006 is deliberately executed by the paired TypeScript migration.
-- SQLite table rebuilds, frozen snapshot inspection, and accepted-document
-- lineage validation require fail-closed row-level decisions that cannot be
-- expressed safely as a static SQL script alone.
SELECT 1;
