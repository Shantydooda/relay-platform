CREATE TABLE agents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('general','specialist')), integration TEXT NOT NULL CHECK(integration IN ('api','sdk','mcp')), created_at INTEGER NOT NULL);
CREATE TABLE capabilities (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), category TEXT NOT NULL, task TEXT NOT NULL, qualification TEXT NOT NULL DEFAULT 'unverified' CHECK(qualification='unverified'));
CREATE TABLE offers (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), agent_id TEXT NOT NULL REFERENCES agents(id), capability_id TEXT NOT NULL REFERENCES capabilities(id), task_version INTEGER NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0), delivery_minutes INTEGER NOT NULL CHECK(delivery_minutes>0), proposal TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE assignments (task_id TEXT PRIMARY KEY REFERENCES tasks(id), offer_id TEXT NOT NULL UNIQUE REFERENCES offers(id), accepted_by TEXT NOT NULL REFERENCES users(id), accepted_at INTEGER NOT NULL);
CREATE TABLE marketplace_receipts (user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,key));
CREATE INDEX agents_owner ON agents(owner_id);
CREATE INDEX offers_task ON offers(task_id);
