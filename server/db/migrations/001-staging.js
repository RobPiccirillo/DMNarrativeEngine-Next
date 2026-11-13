export const migration = {
    version: 1, name: 'staging-foundation', sql: `
CREATE TABLE staging_campaign (singleton INTEGER PRIMARY KEY CHECK(singleton=1), binding TEXT NOT NULL);
CREATE TABLE migration_runs (
 run_id TEXT PRIMARY KEY, manifest_hash TEXT NOT NULL, importer TEXT NOT NULL, verifier TEXT,
 status TEXT NOT NULL CHECK(status IN ('incomplete','imported','verified','blocked')),
 revision INTEGER NOT NULL CHECK(revision>=1), report_digest TEXT, report_body TEXT, blocking_count INTEGER);
CREATE TABLE migration_sources (
 run_id TEXT NOT NULL REFERENCES migration_runs(run_id), source_id TEXT NOT NULL, path TEXT NOT NULL,
 family TEXT NOT NULL, presence TEXT NOT NULL CHECK(presence IN ('present','missing')),
 raw_hash TEXT, byte_length INTEGER NOT NULL, source_version TEXT NOT NULL, descriptor TEXT,
 parse_status TEXT NOT NULL, expected_count INTEGER, observed_count INTEGER, staged_count INTEGER NOT NULL,
 PRIMARY KEY(run_id,source_id));
CREATE TABLE staged_records (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, locator TEXT NOT NULL, kind TEXT NOT NULL,
 ordinal INTEGER NOT NULL, original_key TEXT, compatibility_ref TEXT NOT NULL, canonical_ref TEXT,
 encoding TEXT NOT NULL CHECK(encoding IN ('json','base64')), payload TEXT NOT NULL, semantic_hash TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id,locator), FOREIGN KEY(run_id,source_id) REFERENCES migration_sources(run_id,source_id));
CREATE INDEX records_kind_order ON staged_records(run_id,kind,ordinal);
CREATE INDEX records_key ON staged_records(run_id,original_key);
CREATE TABLE staged_links (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, locator TEXT NOT NULL, relation TEXT NOT NULL, ordinal INTEGER NOT NULL,
 raw_target TEXT NOT NULL, target_source TEXT, target_locator TEXT, disposition TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id,locator,relation,ordinal),
 FOREIGN KEY(run_id,source_id,locator) REFERENCES staged_records(run_id,source_id,locator),
 FOREIGN KEY(run_id,target_source,target_locator) REFERENCES staged_records(run_id,source_id,locator));
CREATE TABLE migration_findings (
 run_id TEXT NOT NULL REFERENCES migration_runs(run_id), finding_id INTEGER NOT NULL, source_id TEXT, locator TEXT,
 code TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('informational','warning','cutover-blocking')),
 disposition TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(run_id,finding_id));
CREATE TABLE domain_authority (
 run_id TEXT NOT NULL REFERENCES migration_runs(run_id), domain TEXT NOT NULL, state TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope='staging-only'), control_hash TEXT, PRIMARY KEY(run_id,domain));
CREATE TABLE migration_command_outcomes (
 campaign TEXT NOT NULL, domain TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('command-id','caller-key')),
 logical_key TEXT NOT NULL, semantic_request TEXT NOT NULL, owner TEXT NOT NULL, epoch INTEGER NOT NULL,
 outcome TEXT NOT NULL, PRIMARY KEY(campaign,domain,mode,logical_key));
` };
