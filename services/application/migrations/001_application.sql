CREATE TABLE relay_private.relay_v1_documents (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
  PRIMARY KEY (kind, id)
);

CREATE TABLE relay_private.relay_v1_receipts (
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL CHECK (jsonb_typeof(response::jsonb) = 'object'),
  PRIMARY KEY (actor_id, request_key)
);

REVOKE ALL ON ALL TABLES IN SCHEMA relay_private FROM PUBLIC;
