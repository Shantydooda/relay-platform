'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('./database.cjs');
const { fail, digest, token, text, emailInput, exactKeys } = require('./security.cjs');

// Local identity owns membership, so each operation rechecks the database rather
// than trusting a previously issued actor snapshot. Hosted identity is separate.
function createTeams(db, now = Date.now) {
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function active(actor) {
    if (!actor?.user?.id || actor.recoveryRequired || !get('SELECT id FROM users WHERE id=?', actor.user.id)) fail(403, 'FORBIDDEN', 'An active local account is required.');
  }
  function member(actor, id, owner = false) {
    active(actor);
    const row = get('SELECT m.role FROM memberships m JOIN company_workspaces c ON c.tenant_id=m.tenant_id WHERE m.user_id=? AND m.tenant_id=?', actor.user.id, id);
    if (!row || (owner && row.role !== 'owner')) fail(403, 'FORBIDDEN', 'Workspace administrator access is required.');
    return row;
  }
  function audit(actor, tenant, action, subject, details = {}) {
    run('INSERT INTO team_audit (id,tenant_id,actor_id,action,subject_id,created_at,details) VALUES (?,?,?,?,?,?,?)', randomUUID(), tenant, actor.user.id, action, subject, now(), JSON.stringify(details));
  }
  function createTeam(actor, body, key) {
    active(actor); exactKeys(body, ['name']);
    const name = text(body.name, 'Company name', 1, 80);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail(400, 'IDEMPOTENCY_REQUIRED', 'A request key is required.');
    return transaction(db, () => {
      const fingerprint = digest(JSON.stringify(['create-team', name]));
      const old = get('SELECT * FROM idempotency WHERE user_id=? AND key=?', actor.user.id, key);
      if (old) {
        if (old.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Request key already used.');
        return JSON.parse(old.response);
      }
      const count = get('SELECT count(*) AS n FROM company_workspaces WHERE created_by=?', actor.user.id).n;
      if (count >= 10) fail(409, 'TEAM_LIMIT', 'Local development supports ten company workspaces per account.');
      const tenantId = randomUUID();
      run('INSERT INTO tenants VALUES (?,?,?)', tenantId, name, now());
      run('INSERT INTO company_workspaces VALUES (?,?)', tenantId, actor.user.id);
      run('INSERT INTO memberships VALUES (?,?,?)', actor.user.id, tenantId, 'owner');
      audit(actor, tenantId, 'workspace.created', tenantId);
      const result = { tenantId };
      run('INSERT INTO idempotency VALUES (?,?,?,?,?)', actor.user.id, key, fingerprint, JSON.stringify(result), now());
      return result;
    });
  }
  function team(actor, id) {
    const access = member(actor, id);
    const owner = access.role === 'owner';
    return { id, name: get('SELECT name FROM tenants WHERE id=?', id).name, role: access.role,
      members: owner ? db.prepare('SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name').all(id) : [],
      invites: owner ? db.prepare("SELECT id,email,role,status,expires_at AS expiresAt FROM team_invites WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100").all(id).map(row=>({...row,status:row.status==='pending'&&row.expiresAt<=now()?'expired':row.status})) : [] };
  }
  function changeRole(actor, id, body) {
    exactKeys(body, ['memberId', 'role', 'expectedRole']);
    if (!['employee', 'approver'].includes(body.role)) fail(400, 'INVALID_ROLE', 'Choose employee or approver.');
    return transaction(db, () => {
      member(actor, id, true);
      const row = get('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', id, body.memberId);
      if (!row || row.role === 'owner') fail(409, 'MEMBER_PROTECTED', 'The workspace owner cannot be changed here.');
      if (row.role !== body.expectedRole) fail(409, 'MEMBER_CHANGED', 'This role has changed. Refresh the workspace before trying again.');
      if (row.role === body.role) return { ok: true };
      run('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?', body.role, id, body.memberId);
      audit(actor, id, 'member.role_changed', body.memberId, { from: row.role, to: body.role });
      return { ok: true };
    });
  }
  function history(actor, id, before = '') {
    member(actor, id, true);
    if (before && !/^[1-9][0-9]{0,14}$/.test(before)) fail(400, 'INVALID_CURSOR', 'Invalid history cursor.');
    const rows = db.prepare(`SELECT a.rowid AS cursor,a.id,a.action,a.created_at AS createdAt,a.details,
      u.name AS actorName,COALESCE(s.name,i.email,t.name,a.subject_id) AS subjectName
      FROM team_audit a JOIN users u ON u.id=a.actor_id
      LEFT JOIN users s ON s.id=a.subject_id LEFT JOIN team_invites i ON i.id=a.subject_id
      LEFT JOIN tenants t ON t.id=a.subject_id
      WHERE a.tenant_id=? AND a.rowid<? ORDER BY a.rowid DESC LIMIT 51`).all(id, before ? Number(before) : Number.MAX_SAFE_INTEGER);
    return { entries: rows.slice(0, 50).map(row => ({ ...row, details: JSON.parse(row.details) })),
      nextCursor: rows.length > 50 ? String(rows[49].cursor) : null };
  }
  function invite(actor, id, body) {
    exactKeys(body, ['email', 'role']);
    const email = emailInput(body.email);
    if (!['employee','approver'].includes(body.role)) fail(400, 'INVALID_ROLE', 'Choose employee or approver.');
    return transaction(db, () => {
      member(actor, id, true);
      if (get('SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.email=?', id, email)) fail(409, 'ALREADY_MEMBER', 'This account already belongs to the workspace.');
      if (get("SELECT 1 FROM team_invites WHERE tenant_id=? AND email=? AND status='pending' AND expires_at>?", id, email, now())) fail(409, 'INVITE_PENDING', 'An invitation already exists. Revoke it before creating a replacement link.');
      if (get("SELECT count(*) AS n FROM team_invites WHERE tenant_id=? AND status='pending' AND expires_at>?", id, now()).n >= 50) fail(409, 'INVITE_LIMIT', 'Resolve pending invitations before adding more.');
      const raw = token(), inviteId = randomUUID(), expiresAt = now()+24*3600000;
      run("INSERT INTO team_invites VALUES (?,?,?,?,?,'pending',?,?,NULL,?)", inviteId, id, email, body.role, digest(raw), expiresAt, actor.user.id, now());
      audit(actor, id, 'invitation.created', inviteId);
      return { inviteId, token: raw, expiresAt };
    });
  }
  function preview(actor, body) {
    active(actor); exactKeys(body, ['token']);
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) fail(400, 'INVITE_INVALID', 'Invalid invitation.');
    const row = get('SELECT i.*,t.name FROM team_invites i JOIN tenants t ON t.id=i.tenant_id WHERE token_hash=?', digest(body.token));
    const user = get('SELECT email FROM users WHERE id=?', actor.user.id);
    if (!row || row.status !== 'pending' || row.expires_at <= now() || row.email.toLowerCase() !== user.email.toLowerCase()) fail(404, 'INVITE_UNAVAILABLE', 'Invitation is unavailable for this account.');
    return { name: row.name, role: row.role, expiresAt: row.expires_at };
  }
  function accept(actor, body) {
    active(actor); exactKeys(body, ['token']);
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) fail(400, 'INVITE_INVALID', 'Invalid invitation.');
    return transaction(db, () => {
      const row = get('SELECT * FROM team_invites WHERE token_hash=?', digest(body.token));
      const user = get('SELECT email FROM users WHERE id=?', actor.user.id);
      if (!row || row.email.toLowerCase() !== user.email.toLowerCase()) fail(404, 'INVITE_UNAVAILABLE', 'Invitation is unavailable for this account.');
      if (row.status === 'accepted' && row.accepted_by === actor.user.id && get('SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?',actor.user.id,row.tenant_id)) return { tenantId: row.tenant_id };
      if (row.status !== 'pending' || row.expires_at <= now()) fail(409, 'INVITE_UNAVAILABLE', 'This invitation has expired or been revoked.');
      if (get('SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?',actor.user.id,row.tenant_id)) fail(409, 'ALREADY_MEMBER', 'Membership already exists.');
      run('INSERT INTO memberships VALUES (?,?,?)', actor.user.id, row.tenant_id, row.role);
      run("UPDATE team_invites SET status='accepted',accepted_by=? WHERE id=?", actor.user.id, row.id);
      audit(actor, row.tenant_id, 'invitation.accepted', row.id);
      return { tenantId: row.tenant_id };
    });
  }
  function remove(actor, id, body) {
    exactKeys(body, ['memberId', 'inviteId']);
    if (!!body.memberId === !!body.inviteId) fail(400, 'INVALID_INPUT', 'Choose one member or invitation.');
    return transaction(db, () => {
      member(actor, id, true);
      if (body.memberId) {
        const row = get('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', id, body.memberId);
        if (!row || row.role === 'owner') fail(409, 'MEMBER_PROTECTED', 'The owner cannot be removed here.');
        run('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', id, body.memberId);
        audit(actor, id, 'member.removed', body.memberId);
      } else {
        const row = get('SELECT status FROM team_invites WHERE id=? AND tenant_id=?', body.inviteId, id);
        if (!row || row.status !== 'pending') fail(409, 'INVITE_UNAVAILABLE', 'Only pending invitations can be revoked.');
        run("UPDATE team_invites SET status='revoked' WHERE id=?", body.inviteId);
        audit(actor, id, 'invitation.revoked', body.inviteId);
      }
      return { ok: true };
    });
  }
  return { changeTeamRole: changeRole, teamHistory: history, previewTeamInvite: preview, createTeam, team, inviteTeamMember: invite, acceptTeamInvite: accept, removeTeamAccess: remove };
}
module.exports = { createTeams };
