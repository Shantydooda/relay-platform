CREATE INDEX relay_v1_owner ON relay_private.relay_v1_documents (kind, owner_id, id);
CREATE INDEX relay_v1_tenant ON relay_private.relay_v1_documents (kind, tenant_id, id);
CREATE INDEX relay_v1_status ON relay_private.relay_v1_documents (kind, status, id);
