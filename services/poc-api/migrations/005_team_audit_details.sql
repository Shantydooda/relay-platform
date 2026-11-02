ALTER TABLE team_audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
CREATE INDEX team_audit_tenant ON team_audit(tenant_id);
