'use strict';

// ERP data requests on "Post a request" and the readiness checklist on the
// request page (services/application/src/intake.cjs). Offers open only when the
// intake is complete; every file added is part of the agreed scope.
const RelayIntake = {
  TARGETS: [['netsuite', 'Oracle NetSuite'], ['sap-s4hana', 'SAP S/4HANA'], ['dynamics-365', 'Microsoft Dynamics 365'], ['other', 'Another ERP']],
  OBJECTS: [['vendor', 'Vendor master'], ['customer', 'Customer master'], ['item', 'Item master'], ['chart_of_accounts', 'Chart of accounts'], ['bom', 'Bills of materials'],
    ['open_ar', 'Open receivables'], ['open_ap', 'Open payables'], ['opening_balances', 'Opening balances']],
  ROLES: [['source_extract', 'Source extract', 'The records as they are today, exported from the old system.'],
    ['target_template', 'Target import template', 'A blank import file exported from your own ERP, in its field order.'],
    ['field_mapping', 'Field mapping', 'Which source field goes to which target field, and how it’s transformed.'],
    ['code_crosswalk', 'Code cross-walk', 'Your old codes matched to the new ERP’s IDs: payment terms, tax codes, units, currencies.'],
    ['rules', 'Data rules', 'Duplicate keys, required fields and anything people “just know”.'],
    ['reconciliation_baseline', 'Reconciliation baseline', 'Counts and totals the result must tie to: AR/AP ageing, trial balance.'],
    ['sample_input', 'Sample input', 'A few real records as they are now.'],
    ['expected_output', 'Expected output', 'The same records exactly as they should come back.']],
  CASES: [['typical', 'Typical record'], ['edge', 'Edge case'], ['unchanged', 'Should not change']],
  option(list, current) { return list.map(([v, l]) => `<option value="${escape(v)}" ${current === v ? 'selected' : ''}>${escape(l)}</option>`).join(''); },

  // ---- Post a request ------------------------------------------------------
  postFields() {
    const erp = state.postKind === 'erp', d = state.postDraft?.intake || {};
    return `<fieldset class="mk-fieldset mk-kind"><legend>Kind of request</legend>
        <label class="mk-check"><input type="radio" name="kind" value="general" data-post-kind ${erp ? '' : 'checked'}> General</label>
        <label class="mk-check"><input type="radio" name="kind" value="erp" data-post-kind ${erp ? 'checked' : ''}> ERP data (migration or master-data cleanup)</label></fieldset>
      ${erp ? `<div class="mk-form-row">
        <span><label for="erp-target">Target ERP</label><select id="erp-target" name="targetErp">${this.option(this.TARGETS, d.targetErp)}</select></span>
        <span><label for="erp-object">Data</label><select id="erp-object" name="objectType">${this.option(this.OBJECTS, d.objectType)}</select></span>
        <span><label for="erp-source">Source system</label><input id="erp-source" name="sourceSystem" maxlength="120" required value="${escape(d.sourceSystem || '')}" placeholder="e.g. Sage 100"></span></div>
      <div class="mk-form-row">
        <span><label for="erp-count">Record count</label><input id="erp-count" name="recordCount" type="number" min="1" max="10000000" value="${escape(d.recordCount || '')}" placeholder="e.g. 4210"></span>
        <span><label for="erp-asof">As of</label><input id="erp-asof" name="asOfDate" type="date" value="${escape(d.asOfDate || '')}"></span>
        <span></span></div>
      <label class="mk-check"><input type="checkbox" name="dependenciesConfirmed" ${d.dependenciesConfirmed ? 'checked' : ''}> The setup this data depends on (subsidiaries, currencies, terms, tax codes) already exists in the target ERP</label>
      <p class="mk-caption">You’re the data owner who signs off the load. After posting you’ll add the extract, template, mapping and at least three sample pairs; offers open once those are in.</p>` : ''}`;
  },
  intakeFromForm(data, account) {
    return { kind: 'erp-data', targetErp: data.get('targetErp'), objectType: data.get('objectType'), sourceSystem: String(data.get('sourceSystem') || '').trim(),
      recordCount: data.get('recordCount') ? Number(data.get('recordCount')) : null, asOfDate: data.get('asOfDate') || null,
      dataOwnerId: account.user.id, dependenciesConfirmed: !!data.get('dependenciesConfirmed') };
  },

  // ---- Request page --------------------------------------------------------
  section(detail) {
    const intake = detail.intake;
    if (!intake) return '';
    const r = intake.readiness, files = intake.attachments, own = detail.mine !== false;
    const editable = own && !detail.execution && ['draft', 'posted', 'selected'].includes(detail.task.status);
    const label = role => this.ROLES.find(([v]) => v === role)?.[1] || role;
    const pairs = files.filter(f => f.role === 'sample_input').map(input => ({ input, output: files.find(f => f.role === 'expected_output' && f.pairId === input.pairId) }));
    const single = files.filter(f => !['sample_input', 'expected_output'].includes(f.role));
    const remove = f => editable ? `<button type="button" class="mk-link-button" data-action="attachment-remove" data-id="${escape(f.id)}">Remove</button>` : '';
    const size = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const open = pairs.filter(p => !p.output);
    return `<section class="mk-section" aria-labelledby="mk-intake-title"><h2 id="mk-intake-title">ERP data request</h2>
      <dl class="mk-facts"><dt>Target</dt><dd>${escape(intake.targetLabel)}</dd><dt>Data</dt><dd>${escape(intake.objectLabel)}</dd><dt>Source</dt><dd>${escape(intake.sourceSystem)}</dd>
        <dt>Records</dt><dd>${intake.recordCount ? escape(Number(intake.recordCount).toLocaleString()) : '—'}${intake.asOfDate ? ` as of ${escape(intake.asOfDate)}` : ''}</dd>
        <dt>Data owner</dt><dd>${escape(intake.dataOwnerName || '—')}</dd><dt>Dependencies</dt><dd>${intake.dependenciesConfirmed ? 'Confirmed in the target ERP' : 'Not confirmed'}</dd></dl>
      <div class="mk-readiness ${r.complete ? 'mk-ready' : ''}" role="status"><strong>${r.complete ? 'Ready for offers' : 'Before agents can quote'}</strong>
        ${r.missing.length ? `<ul class="mk-bullets">${r.missing.map(m => `<li>${escape(m)}</li>`).join('')}</ul>` : ''}
        ${r.recommended.length ? `<p class="mk-caption">Would help: ${escape(r.recommended.join(' · '))}</p>` : ''}
        ${detail.task.status === 'draft' && own ? `<button type="button" class="mk-primary" data-action="request-open" ${r.complete ? '' : 'disabled'}>Open for offers</button>` : ''}</div>
      <h3>Files</h3>
      ${single.length ? `<ul class="mk-member-list">${single.map(f => `<li><span class="mk-tag">${escape(label(f.role))}</span><span>${escape(f.filename)} <span class="mk-caption">${size(f.size)}</span></span>${remove(f)}</li>`).join('')}</ul>` : '<p class="mk-caption">No files yet.</p>'}
      <h3>Sample pairs <span class="mk-total">${r.pairs}</span></h3>
      ${pairs.length ? `<ul class="mk-member-list">${pairs.map(p => `<li><span class="mk-tag">${escape(this.CASES.find(([v]) => v === p.input.caseKind)?.[1] || 'Sample')}</span><span>${escape(p.input.filename)} → ${p.output ? escape(p.output.filename) : '<em>expected output missing</em>'}</span>${remove(p.input)}</li>`).join('')}</ul>` : '<p class="mk-caption">At least three: real records as they are now, and exactly how they should come back. Include an edge case and one that should not change.</p>'}
      ${editable ? `<form id="attachment-add" class="mk-form mk-panel"><h3>Add a file</h3>
        <label for="attach-role">What is it?</label><select id="attach-role" name="role" data-attach-role>${this.ROLES.map(([v, l]) => `<option value="${v}" ${state.attachRole === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <p class="mk-caption">${escape(this.ROLES.find(([v]) => v === (state.attachRole || 'source_extract'))?.[2] || '')}</p>
        ${state.attachRole === 'sample_input' ? `<label for="attach-case">Case</label><select id="attach-case" name="caseKind">${this.option(this.CASES, 'typical')}</select>` : ''}
        ${state.attachRole === 'expected_output' ? (open.length ? `<label for="attach-pair">For sample input</label><select id="attach-pair" name="pairId">${open.map(p => `<option value="${escape(p.input.pairId)}">${escape(p.input.filename)}</option>`).join('')}</select>` : '<p class="mk-caption">Add a sample input first.</p>') : ''}
        <label for="attach-file">File <span class="mk-optional">CSV, XLSX, JSON, TXT, Markdown or PDF · up to 5 MB</span></label><input id="attach-file" name="file" type="file" accept=".csv,.xlsx,.json,.txt,.md,.pdf" required>
        <p class="mk-caption">Files go to the agent only after you start the work. Mask bank account and tax ID columns unless the work needs them.${detail.task.status !== 'draft' ? ' Adding a file changes the scope: agents quote again.' : ''}</p>
        <div class="form-error" role="alert"></div><div class="mk-form-actions"><button type="submit">Add file</button></div></form>` : ''}</section>`;
  },
  async fileBase64(file) {
    if (!file || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a file of up to 5 MB.');
    const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsDataURL(file); });
    return String(url).slice(String(url).indexOf(',') + 1);
  },
};
