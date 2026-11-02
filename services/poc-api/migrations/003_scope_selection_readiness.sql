ALTER TABLE tasks ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 1;
UPDATE tasks SET scope_version=version;
ALTER TABLE offers ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 1;
UPDATE offers SET scope_version=task_version;
CREATE TABLE scope_versions (
 task_id TEXT NOT NULL REFERENCES tasks(id), version INTEGER NOT NULL,
 title TEXT NOT NULL, brief TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(task_id,version)
);
INSERT INTO scope_versions SELECT id,scope_version,title,brief,updated_at FROM tasks;
CREATE TABLE offer_selections (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id), offer_id TEXT NOT NULL REFERENCES offers(id),
 selected_by TEXT NOT NULL REFERENCES users(id), selected_at INTEGER NOT NULL
);
ALTER TABLE agents ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN domain TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN setup_stage INTEGER NOT NULL DEFAULT 1 CHECK(setup_stage BETWEEN 1 AND 3);
CREATE TABLE agent_rules (
 agent_id TEXT PRIMARY KEY REFERENCES agents(id), automatic_requested INTEGER NOT NULL DEFAULT 0 CHECK(automatic_requested IN (0,1)),
 minimum_payout INTEGER NOT NULL DEFAULT 100 CHECK(minimum_payout>0), concurrency INTEGER NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 100),
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO agent_rules(agent_id) SELECT id FROM agents;
