-- Tombstones survive removal and re-invitation: an old grant never becomes current again.
CREATE TABLE membership_epochs (
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  epoch INTEGER NOT NULL CHECK(epoch > 0),
  PRIMARY KEY(user_id,tenant_id)
);
INSERT INTO membership_epochs SELECT user_id,tenant_id,1 FROM memberships;
CREATE TRIGGER membership_epoch_insert AFTER INSERT ON memberships BEGIN
  INSERT INTO membership_epochs VALUES (NEW.user_id,NEW.tenant_id,1)
  ON CONFLICT(user_id,tenant_id) DO UPDATE SET epoch=epoch+1;
END;
CREATE TRIGGER membership_epoch_update AFTER UPDATE OF role ON memberships
WHEN OLD.role <> NEW.role BEGIN
  UPDATE membership_epochs SET epoch=epoch+1 WHERE user_id=NEW.user_id AND tenant_id=NEW.tenant_id;
END;
CREATE TRIGGER membership_epoch_delete AFTER DELETE ON memberships BEGIN
  UPDATE membership_epochs SET epoch=epoch+1 WHERE user_id=OLD.user_id AND tenant_id=OLD.tenant_id;
END;
