'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('./database.cjs');
const { fail, digest, token, hashPassword, verifyPassword, text, passwordInput, emailInput, exactKeys, equal } = require('./security.cjs');
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;

function createStore(db, now = Date.now) {
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function authLimit(ip, email) {
    const time = now();
    transaction(db, () => {
      run('DELETE FROM auth_limits WHERE reset_at<=?', time);
      for (const [value, max] of [[`ip:${ip}`, 20], [`email:${email}`, 8]]) {
        const key = digest(value);
        const limit = get('SELECT * FROM auth_limits WHERE key=?', key);
        if (limit && limit.attempts >= max) fail(429, 'AUTH_LIMIT', 'Too many attempts. Try again in 15 minutes.');
      }
      for (const value of [`ip:${ip}`, `email:${email}`]) {
        run('INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1', digest(value), time + 15*60*1000);
      }
    });
  }
  function session(userId, previousToken) {
    const raw = token(), csrf = token(), time = now();
    if (previousToken) run('DELETE FROM sessions WHERE token_hash=?', digest(previousToken));
    run('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?', time, time-IDLE_MS);
    run('INSERT INTO sessions VALUES (?,?,?,?,?,?)', digest(raw), userId, csrf, time, time+ABSOLUTE_MS, time);
    return raw;
  }
  function principal(raw) {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) fail(401, 'SIGN_IN_REQUIRED', 'Please sign in to continue.');
    const time = now();
    const row = get('SELECT s.*,u.email,u.name,u.email_verified,u.preferred_workspace FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', digest(raw));
    if (!row || row.expires_at <= time || row.last_seen_at <= time-IDLE_MS) {
      if (row) run('DELETE FROM sessions WHERE token_hash=?', row.token_hash);
      fail(401, 'SIGN_IN_REQUIRED', 'Your session has ended. Please sign in again.');
    }
    run('UPDATE sessions SET last_seen_at=? WHERE token_hash=?', time, row.token_hash);
    return { user: { id:row.user_id, name:row.name, email:row.email, emailVerified:!!row.email_verified, workspace:row.preferred_workspace }, csrf:row.csrf, tokenHash:row.token_hash,
      memberships:all('SELECT t.id,t.name,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.created_at,t.id', row.user_id) };
  }
  function csrf(actor, supplied) {
    if (!equal(actor.csrf, supplied)) fail(403, 'CSRF_FAILED', 'Refresh the page before trying again.');
  }
  async function register(body, ip, previousToken) {
    exactKeys(body, ['name','email','password','workspace']);
    const name = text(body.name, 'Name', 1, 80), email = emailInput(body.email), password = passwordInput(body.password);
    if (!['buyer','builder'].includes(body.workspace)) fail(400, 'INVALID_WORKSPACE', 'Choose a workspace.');
    authLimit(ip,email);
    const passwordHash = await hashPassword(password);
    return transaction(db, () => {
      if (get('SELECT id FROM users WHERE email=?', email)) fail(409, 'ACCOUNT_UNAVAILABLE', 'Unable to create an account with these details. Try signing in.');
      const userId = randomUUID(), tenantId = randomUUID(), time=now();
      run('INSERT INTO users(id,email,name,password_hash,preferred_workspace,created_at) VALUES (?,?,?,?,?,?)',userId,email,name,passwordHash,body.workspace,time);
      run('INSERT INTO tenants VALUES (?,?,?)',tenantId,`${name}’s workspace`,time);
      run('INSERT INTO memberships VALUES (?,?,?)',userId,tenantId,'owner');
      return session(userId, previousToken);
    });
  }
  async function login(body, ip, previousToken) {
    exactKeys(body,['email','password']);
    const email = emailInput(body.email);
    if (typeof body.password !== 'string' || Buffer.byteLength(body.password)>1024) fail(400,'INVALID_INPUT','Enter your email and password.');
    authLimit(ip,email);
    const user = get('SELECT * FROM users WHERE email=?', email);
    const valid = await verifyPassword(body.password, user?.password_hash);
    if (!user || !valid) fail(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
    return transaction(db, () => session(user.id, previousToken));
  }
  function tenant(actor, id, writable=false) {
    const membership=actor.memberships.find(m => m.id===id);
    if (!membership) fail(404,'NOT_FOUND','Task or workspace not found.');
    if (writable && !['owner','employee'].includes(membership.role)) fail(403,'FORBIDDEN','Your role cannot change tasks.');
    return membership;
  }
  function task(actor,id,writable=false) {
    const row=get('SELECT * FROM tasks WHERE id=?',id);
    if (!row) fail(404,'NOT_FOUND','Task or workspace not found.');
    const membership=tenant(actor,row.tenant_id,writable);
    // Personal-only first slice: corporate task visibility needs an explicit policy.
    if (row.created_by!==actor.user.id && membership.role!=='owner') fail(404,'NOT_FOUND','Task or workspace not found.');
    return row;
  }
  function view(row) {
    return { id:row.id,tenantId:row.tenant_id,title:row.title,brief:row.brief,status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at };
  }
  function detail(actor,id) {
    const row=task(actor,id);
    return { task:view(row), messages:all('SELECT m.id,m.body,m.created_at AS createdAt,u.name AS authorName FROM messages m JOIN users u ON u.id=m.author_id WHERE m.task_id=? ORDER BY m.created_at,m.rowid',id),
      events:all('SELECT sequence,type,version,created_at AS createdAt FROM events WHERE task_id=? ORDER BY sequence',id) };
  }
  function event(id,actor,type,version) { run('INSERT INTO events(task_id,actor_id,type,version,created_at) VALUES (?,?,?,?,?)',id,actor.user.id,type,version,now()); }
  function command(actor,key,fingerprint,operation) {
    if (typeof key!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail(400,'IDEMPOTENCY_REQUIRED','A valid Idempotency-Key is required.');
    return transaction(db, () => {
      const prior=get('SELECT * FROM idempotency WHERE user_id=? AND key=?',actor.user.id,key);
      if (prior) {
        if (prior.fingerprint!==fingerprint) fail(409,'IDEMPOTENCY_CONFLICT','This request key was already used for different content.');
        // Recheck current access even for a successful replay.
        const response=JSON.parse(prior.response);
        task(actor,response.taskId,true);
        return response;
      }
      const response=operation();
      run('INSERT INTO idempotency VALUES (?,?,?,?,?)',actor.user.id,key,fingerprint,JSON.stringify(response),now());
      return response;
    });
  }
  function createTask(actor,body,key) {
    exactKeys(body,['tenantId','title','brief']);
    tenant(actor,body.tenantId,true);
    const title=text(body.title,'Title',1,120),brief=text(body.brief,'Brief',1,10000);
    return command(actor,key,digest(JSON.stringify(['create',body])),() => {
      const id=randomUUID(),time=now();
      run('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',id,body.tenantId,actor.user.id,title,brief,'draft',1,time,time);
      run('INSERT INTO messages VALUES (?,?,?,?,?)',randomUUID(),id,actor.user.id,brief,time);
      event(id,actor,'task.created',1);
      return {taskId:id,version:1};
    });
  }
  function mutateTask(actor,id,action,body,key) {
    const allowed = action==='edit'?['expectedVersion','title','brief']:action==='messages'?['expectedVersion','body']:['expectedVersion'];
    exactKeys(body,allowed);
    if (!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1) fail(400,'VERSION_REQUIRED','The current task version is required.');
    task(actor,id,true);
    return command(actor,key,digest(JSON.stringify([id,action,body])),() => {
      const row=task(actor,id,true);
      if(row.version!==body.expectedVersion) fail(409,'VERSION_CONFLICT','This task changed in another session. Reload it before saving.');
      if(row.status==='cancelled') fail(409,'TASK_CLOSED','Cancelled tasks cannot be changed.');
      const version=row.version+1,time=now();
      let type;
      if(action==='edit') {
        if(row.status!=='draft') fail(409,'INVALID_TRANSITION','Only drafts can be edited. Add context as a message after posting.');
        run('UPDATE tasks SET title=?,brief=?,version=?,updated_at=? WHERE id=?',text(body.title,'Title',1,120),text(body.brief,'Brief',1,10000),version,time,id);
        type='task.edited';
      } else if(action==='messages') {
        run('INSERT INTO messages VALUES (?,?,?,?,?)',randomUUID(),id,actor.user.id,text(body.body,'Message',1,10000),time);
        run('UPDATE tasks SET version=?,updated_at=? WHERE id=?',version,time,id);
        type='message.added';
      } else if(action==='post'||action==='cancel') {
        if(action==='post'&&row.status!=='draft') fail(409,'INVALID_TRANSITION','Only a draft can be posted.');
        run('UPDATE tasks SET status=?,version=?,updated_at=? WHERE id=?',action==='post'?'posted':'cancelled',version,time,id);
        type=action==='post'?'task.posted':'task.cancelled';
      } else fail(404,'NOT_FOUND','Action not found.');
      event(id,actor,type,version);
      return {taskId:id,version};
    });
  }
  return {register,login,principal,csrf,createTask,mutateTask,detail,
    list(actor,tenantId) { tenant(actor,tenantId); return all('SELECT * FROM tasks WHERE tenant_id=? AND (created_by=? OR ?=1) ORDER BY updated_at DESC,id',tenantId,actor.user.id,actor.memberships.find(m=>m.id===tenantId).role==='owner'?1:0).map(view); },
    logout(actor) { run('DELETE FROM sessions WHERE token_hash=?',actor.tokenHash); },
    workspace(actor,body) { exactKeys(body,['workspace']); if(!['buyer','builder'].includes(body.workspace)) fail(400,'INVALID_WORKSPACE','Choose a workspace.'); run('UPDATE users SET preferred_workspace=? WHERE id=?',body.workspace,actor.user.id); }
  };
}
module.exports={createStore};
