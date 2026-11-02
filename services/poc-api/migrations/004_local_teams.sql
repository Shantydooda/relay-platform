CREATE TABLE company_workspaces (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE team_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES company_workspaces(tenant_id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('employee','approver')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','revoked')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  accepted_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX team_invites_tenant ON team_invites(tenant_id,created_at);
CREATE TABLE team_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
