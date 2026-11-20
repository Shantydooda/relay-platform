'use strict';

// ERP readiness intake, typed attachments and sample input/expected output
// pairs (reports/ERP buyer readiness for agent projects.md, M1–M3).
//
// An ERP data request carries what migration methodologies expect from the
// buyer before work starts: the target ERP and object, the source system, a
// record count and as-of date, a named data owner, confirmation that dependent
// setup (subsidiaries, currencies, terms, tax codes) already exists, and typed
// files: source extract, target template, field mapping, code cross-walks,
// rules, a reconciliation baseline, and at least three sample pairs. The pairs
// improve the first delivery and become the acceptance test.
//
// Offers stay closed until the intake is complete. Every change to the intake
// or a file is a scope change: earlier offers and any approval need review.
// File contents reach the agent only after the buyer authorizes the work.

const { randomUUID, createHash } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');

const TARGETS = Object.freeze({ netsuite: 'Oracle NetSuite', 'sap-s4hana': 'SAP S/4HANA', 'dynamics-365': 'Microsoft Dynamics 365', other: 'Another ERP' });
const OBJECTS = Object.freeze({ vendor: 'Vendor master', customer: 'Customer master', item: 'Item master', chart_of_accounts: 'Chart of accounts', bom: 'Bills of materials',
  open_ar: 'Open receivables', open_ap: 'Open payables', opening_balances: 'Opening balances' });
const BALANCES = new Set(['open_ar', 'open_ap', 'opening_balances']);
const ROLES = Object.freeze({ source_extract: 'Source extract', target_template: 'Target import template', field_mapping: 'Field mapping', code_crosswalk: 'Code cross-walk',
  rules: 'Data rules', reconciliation_baseline: 'Reconciliation baseline', sample_input: 'Sample input', expected_output: 'Expected output' });
const CASES = Object.freeze({ typical: 'Typical record', edge: 'Edge case', unchanged: 'Should not change' });
const TYPES = /\.(csv|xlsx|json|txt|md|pdf)$/i;
const MAX_FILE = 5 * 1024 * 1024, MAX_TOTAL = 25 * 1024 * 1024, MAX_FILES = 30, MIN_PAIRS = 3, RECOMMENDED_PAIRS = 5;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fileName(value) {
  const name = text(value, 'File name', 1, 120).replace(/[\\/:*?"<>|\0]/g, '_');
  if (!TYPES.test(name)) fail(400, 'INVALID_FILE', 'Attach CSV, XLSX, JSON, TXT, Markdown or PDF files.');
  return name;
}
function decode(value) {
  // A flat character-class check: a grouped base64 pattern overflows the regex stack on multi-megabyte files.
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_FILE / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    fail(400, 'INVALID_FILE', 'Each file can be up to 5 MB.');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE) fail(400, 'INVALID_FILE', 'Each file can be up to 5 MB.');
  return bytes;
}

// What's missing before offers open, and what would help.
function readiness(task) {
  const intake = task.intake;
  if (!intake) return null;
  const files = task.attachments || [];
  const has = role => files.some(f => f.role === role);
  const pairs = files.filter(f => f.role === 'sample_input' && files.some(o => o.role === 'expected_output' && o.pairId === f.pairId));
  const missing = [], recommended = [];
  if (!intake.recordCount) missing.push('Record count');
  if (!intake.asOfDate) missing.push('As-of date');
  if (!intake.dataOwnerId) missing.push('Data owner');
  if (!intake.dependenciesConfirmed) missing.push('Confirm dependent setup exists in the target ERP');
  for (const role of ['source_extract', 'target_template', 'field_mapping']) if (!has(role)) missing.push(ROLES[role]);
  if (BALANCES.has(intake.objectType) && !has('reconciliation_baseline')) missing.push(ROLES.reconciliation_baseline);
  if (pairs.length < MIN_PAIRS) missing.push(`${MIN_PAIRS - pairs.length} more sample pair${MIN_PAIRS - pairs.length === 1 ? '' : 's'} (input with its expected output)`);
  if (!has('code_crosswalk') && intake.objectType !== 'chart_of_accounts') recommended.push(ROLES.code_crosswalk);
  if (!has('rules')) recommended.push(ROLES.rules);
  if (pairs.length < RECOMMENDED_PAIRS) recommended.push(`${RECOMMENDED_PAIRS} sample pairs work best`);
  if (!pairs.some(p => p.caseKind === 'edge')) recommended.push('A sample pair for an edge case');
  if (!pairs.some(p => p.caseKind === 'unchanged')) recommended.push('A sample pair that should not change (for example, a near-duplicate that must not merge)');
  return { complete: !missing.length, missing, recommended, pairs: pairs.length };
}

function attachmentView(f) {
  const { id, role, filename, size, sha256, pairId, caseKind, addedAt, scopeVersion } = f;
  return { id, role, roleLabel: ROLES[role], filename, size, sha256, pairId: pairId || null, caseKind: caseKind || null, addedAt, scopeVersion };
}
function intakeView(task) {
  if (!task.intake) return null;
  const { kind, targetErp, objectType, sourceSystem, recordCount, asOfDate, dataOwnerId, dataOwnerName, dependenciesConfirmed } = task.intake;
  return { kind, targetErp, targetLabel: TARGETS[targetErp], objectType, objectLabel: OBJECTS[objectType], sourceSystem, recordCount, asOfDate,
    dataOwnerId, dataOwnerName: dataOwnerName || null, dependenciesConfirmed: !!dependenciesConfirmed, readiness: readiness(task),
    attachments: (task.attachments || []).map(attachmentView) };
}

function createIntake(context) {
  const { command, now, taskFor, expected, touch, event, resolveActor } = context;
  const { saveTask } = require('./supplier-feed.cjs');

  // A draft has no offers yet, so filling in its intake refines version 1 in
  // place. Once posted, every change is a new scope version that offers and
  // approvals must match.
  function scopeChange(task, actorId, type) {
    const time = now();
    if (task.status === 'draft') { task.scopes = task.scopes.filter(s => s.version !== task.scopeVersion); }
    else task.scopeVersion++;
    task.scopes.push({ version: task.scopeVersion, title: task.title, brief: task.brief, acceptanceCriteria: task.acceptanceCriteria || [], createdAt: time,
      inputHash: task.input?.sha256 || null, intake: task.intake ? { ...task.intake } : null, attachments: (task.attachments || []).map(f => f.sha256) });
    task.selectedOfferId = null;
    touch(task, time);
    event(task, actorId, type, time);
  }
  function editable(task) {
    if (task.status === 'cancelled') fail(409, 'TASK_CLOSED', 'This request is closed.');
    if (task.assignment) fail(409, 'TASK_ASSIGNED', 'Authorized work keeps its agreed files. Propose a change instead.');
    require('./packages.cjs').assertNotPackage(task);
    require('./engagements.cjs').assertOpen(task);
    if (task.orchestrationPlan || task.orchestrationStep || task.scheduleId || task.recurringScheduleId) fail(409, 'SCOPE_FIXED', 'This request’s scope is managed elsewhere.');
    require('./payments.cjs').assertUnfunded(task);
  }

  async function setIntake(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'intake']);
    const i = body.intake;
    if (!i || typeof i !== 'object') fail(400, 'INVALID_INPUT', 'Describe the ERP data request.');
    exactKeys(i, ['kind', 'targetErp', 'objectType', 'sourceSystem', 'recordCount', 'asOfDate', 'dataOwnerId', 'dependenciesConfirmed']);
    if (i.kind !== 'erp-data') fail(400, 'INVALID_INPUT', 'Only ERP data requests have an intake today.');
    if (!TARGETS[i.targetErp]) fail(400, 'INVALID_INPUT', 'Choose the target ERP.');
    if (!OBJECTS[i.objectType]) fail(400, 'INVALID_INPUT', 'Choose what kind of data this is.');
    const sourceSystem = text(i.sourceSystem, 'Source system', 2, 120);
    if (i.recordCount !== undefined && i.recordCount !== null && (!Number.isSafeInteger(i.recordCount) || i.recordCount < 1 || i.recordCount > 10000000))
      fail(400, 'INVALID_INPUT', 'Record count must be between 1 and 10,000,000.');
    if (i.asOfDate !== undefined && i.asOfDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(i.asOfDate) || Number.isNaN(Date.parse(i.asOfDate + 'T00:00:00Z'))))
      fail(400, 'INVALID_INPUT', 'As-of date must be a date (YYYY-MM-DD).');
    if (i.dependenciesConfirmed !== undefined && typeof i.dependenciesConfirmed !== 'boolean') fail(400, 'INVALID_INPUT', 'Confirm with yes or no.');
    return command(actor.user.id, key, ['intake', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true); expected(task, body.expectedVersion); editable(task);
      let dataOwnerName = null;
      if (i.dataOwnerId) {
        // The data owner signs off loads; they must belong to the request's workspace.
        const owner = resolveActor ? await resolveActor(text(i.dataOwnerId, 'Data owner', 1, 64)) : null;
        if (!owner?.memberships?.some(m => m.id === task.tenantId)) fail(400, 'INVALID_INPUT', 'The data owner must be a member of this workspace.');
        dataOwnerName = owner.user.name;
      }
      task.intake = { kind: 'erp-data', targetErp: i.targetErp, objectType: i.objectType, sourceSystem, recordCount: i.recordCount || null, asOfDate: i.asOfDate || null,
        dataOwnerId: i.dataOwnerId || null, dataOwnerName, dependenciesConfirmed: !!i.dependenciesConfirmed };
      scopeChange(task, actor.user.id, 'intake.updated');
      await saveTask(repo, task);
      return { taskId, version: task.version, scopeVersion: task.scopeVersion, readiness: readiness(task) };
    });
  }

  async function addAttachment(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'role', 'filename', 'base64', 'pairId', 'caseKind']);
    if (!ROLES[body.role]) fail(400, 'INVALID_INPUT', 'Choose what this file is.');
    const filename = fileName(body.filename), bytes = decode(body.base64);
    if (body.role === 'sample_input' && body.caseKind !== undefined && !CASES[body.caseKind]) fail(400, 'INVALID_INPUT', 'Choose typical, edge case or should-not-change.');
    if (body.role !== 'sample_input' && body.caseKind !== undefined) fail(400, 'INVALID_INPUT', 'Only sample inputs have a case type.');
    if (body.role !== 'expected_output' && body.pairId !== undefined) fail(400, 'INVALID_INPUT', 'Only an expected output joins a pair.');
    return command(actor.user.id, key, ['attachment', taskId, { ...body, base64: sha(bytes) }], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true); expected(task, body.expectedVersion); editable(task);
      task.attachments ||= [];
      if (task.attachments.length >= MAX_FILES) fail(409, 'ATTACHMENT_LIMIT', `A request can carry up to ${MAX_FILES} files.`);
      if (task.attachments.reduce((n, f) => n + f.size, 0) + bytes.length > MAX_TOTAL) fail(409, 'ATTACHMENT_LIMIT', 'A request can carry up to 25 MB of files.');
      let pairId = null;
      if (body.role === 'sample_input') pairId = randomUUID();
      if (body.role === 'expected_output') {
        pairId = text(body.pairId, 'Sample pair', 36, 36);
        if (!task.attachments.some(f => f.role === 'sample_input' && f.pairId === pairId)) fail(400, 'INVALID_INPUT', 'Add the sample input first, then its expected output.');
        if (task.attachments.some(f => f.role === 'expected_output' && f.pairId === pairId)) fail(409, 'PAIR_COMPLETE', 'This sample already has an expected output. Remove it to replace it.');
      }
      await context.storageAdmission(repo, task.tenantId, bytes.length);
      const id = randomUUID(), digest = sha(bytes);
      await repo.save('artifact', { id, ownerId: actor.user.id, tenantId: task.tenantId, taskId, filename, sha256: digest, size: bytes.length, base64: bytes.toString('base64') });
      task.attachments.push({ id, role: body.role, filename, size: bytes.length, sha256: digest, artifactId: id, pairId, caseKind: body.role === 'sample_input' ? body.caseKind || 'typical' : null,
        addedAt: now(), addedBy: actor.user.id, scopeVersion: task.status === 'draft' ? task.scopeVersion : task.scopeVersion + 1 });
      scopeChange(task, actor.user.id, 'attachment.added');
      await saveTask(repo, task);
      return { taskId, version: task.version, attachmentId: id, pairId, readiness: readiness(task) };
    });
  }

  async function removeAttachment(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'attachmentId']);
    return command(actor.user.id, key, ['attachment-remove', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true); expected(task, body.expectedVersion); editable(task);
      const file = (task.attachments || []).find(f => f.id === body.attachmentId);
      if (!file) fail(404, 'NOT_FOUND', 'File not found.');
      // Removing a sample input removes its expected output too.
      task.attachments = task.attachments.filter(f => f.id !== file.id && !(file.role === 'sample_input' && f.pairId === file.pairId));
      scopeChange(task, actor.user.id, 'attachment.removed');
      await saveTask(repo, task);
      return { taskId, version: task.version, readiness: readiness(task) };
    });
  }

  // Machine-run acceptance checks (checks.cjs): part of the scope, like the checklist.
  async function setChecks(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'checks']);
    return command(actor.user.id, key, ['checks', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true); expected(task, body.expectedVersion); editable(task);
      task.checks = require('./checks.cjs').normalizeChecks(body.checks, task);
      scopeChange(task, actor.user.id, 'checks.updated');
      await saveTask(repo, task);
      return { taskId, version: task.version, scopeVersion: task.scopeVersion, checks: task.checks.map(require('./checks.cjs').checkView) };
    });
  }

  // Post is refused until the intake is complete.
  function assertReady(task) {
    const r = readiness(task);
    if (r && !r.complete) fail(409, 'INTAKE_INCOMPLETE', `Before agents can quote, add: ${r.missing.join('; ')}.`);
  }

  // What a builder sees before quoting: the intake and file metadata, no contents.
  function forBidders(task) {
    const view = intakeView(task);
    if (!view) return null;
    const { dataOwnerId, dataOwnerName, ...rest } = view;
    return { ...rest, attachments: view.attachments.map(({ id, role, roleLabel, filename, size, pairId, caseKind }) => ({ id, role, roleLabel, filename, size, pairId, caseKind })) };
  }

  // What the agent receives after authorization: the files themselves.
  async function forAgent(repo, task) {
    const out = [];
    for (const f of task.attachments || []) {
      const artifact = await repo.get('artifact', f.artifactId);
      if (!artifact || artifact.sha256 !== f.sha256) fail(409, 'FILE_UNAVAILABLE', 'A request file failed its integrity check.');
      out.push({ ...attachmentView(f), base64: artifact.base64 });
    }
    return out;
  }

  return { setIntake, setChecks, addAttachment, removeAttachment, assertReady, forBidders, forAgent };
}

module.exports = { createIntake, readiness, intakeView, TARGETS, OBJECTS, ROLES, CASES, MIN_PAIRS };
