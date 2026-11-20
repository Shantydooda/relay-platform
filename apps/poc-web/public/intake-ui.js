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
  // ---- Machine-run acceptance checks (checks.cjs) --------------------------
  CHECKS: [['row_count', 'Row count'], ['required_fields', 'Required fields are filled'], ['unique_key', 'Key is unique'], ['header_matches_template', 'Columns match the import template'],
    ['values_in_crosswalk', 'Codes exist in the cross-walk'], ['control_total', 'Control total ties'], ['matches_samples', 'Sample pairs come back as expected']],
  // The API takes the whole list; strip the display fields Relay adds.
  checkBody(c) {
    const { id, label, description, filename, samples, ...body } = c;
    return body;
  },
  checkParams(type, files) {
    const crosswalks = files.filter(f => f.role === 'code_crosswalk');
    switch (type) {
      case 'row_count': return '<label for="chk-expected">Expected rows</label><input id="chk-expected" name="expected" type="number" min="0" required><label for="chk-tol">Tolerance (rows)</label><input id="chk-tol" name="tolerance" type="number" min="0" value="0">';
      case 'required_fields': return '<label for="chk-fields">Columns that must be filled</label><input id="chk-fields" name="fields" required placeholder="External ID, Company Name, Terms">';
      case 'unique_key': return '<label for="chk-fields">Key columns</label><input id="chk-fields" name="fields" required placeholder="Tax ID  (or: Name, Country)">';
      case 'header_matches_template': return files.some(f => f.role === 'target_template') ? '<p class="mk-caption">The delivered columns must match your target import template exactly, in order.</p>' : '<p class="mk-caption">Add the target import template first.</p>';
      case 'values_in_crosswalk': return crosswalks.length ? `<label for="chk-field">Delivered column</label><input id="chk-field" name="field" required placeholder="Terms"><label for="chk-walk">Cross-walk</label><select id="chk-walk" name="attachmentId">${crosswalks.map(f => `<option value="${escape(f.id)}">${escape(f.filename)}</option>`).join('')}</select><label for="chk-col">Cross-walk column with the new codes</label><input id="chk-col" name="column" required placeholder="netsuite">` : '<p class="mk-caption">Add a code cross-walk first.</p>';
      case 'control_total': return '<label for="chk-field">Column to total</label><input id="chk-field" name="field" required placeholder="Open Balance"><label for="chk-expected">Expected total</label><input id="chk-expected" name="expected" type="number" step="0.01" required><label for="chk-tol">Tolerance</label><input id="chk-tol" name="tolerance" type="number" min="0" step="0.01" value="0">';
      case 'matches_samples': return files.some(f => f.role === 'expected_output') ? '<label for="chk-key">Key column that identifies a record</label><input id="chk-key" name="key" required placeholder="External ID">' : '<p class="mk-caption">Add a sample pair first.</p>';
    }
    return '';
  },
  checkFromForm(data) {
    const type = data.get('type'), list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean), num = v => Number(v);
    return { type, ...(type === 'row_count' ? { expected: num(data.get('expected')), tolerance: num(data.get('tolerance') || 0) } : {}),
      ...(['required_fields', 'unique_key'].includes(type) ? { fields: list(data.get('fields')) } : {}),
      ...(type === 'values_in_crosswalk' ? { field: String(data.get('field') || '').trim(), attachmentId: data.get('attachmentId'), column: String(data.get('column') || '').trim() } : {}),
      ...(type === 'control_total' ? { field: String(data.get('field') || '').trim(), expected: num(data.get('expected')), tolerance: num(data.get('tolerance') || 0) } : {}),
      ...(type === 'matches_samples' ? { key: String(data.get('key') || '').trim() } : {}) };
  },
  checksSection(detail) {
    const checks = detail.checks || [], files = detail.intake?.attachments || [];
    const editable = detail.mine !== false && !detail.execution && ['draft', 'posted', 'selected'].includes(detail.task.status);
    if (!checks.length && !editable) return '';
    const type = state.checkType || 'unique_key';
    return `<section class="mk-section" aria-labelledby="mk-checks-title"><h2 id="mk-checks-title">Automatic checks <span class="mk-total">${checks.length}</span></h2>
      <p class="mk-caption">Relay runs these on every delivery. A failing check counts as unmet, so the fix is free. The agent sees them before quoting and can test its own output.</p>
      ${checks.length ? `<ul class="mk-member-list">${checks.map(c => `<li><span class="mk-tag">${escape(c.label)}</span><span>${escape(c.description)}</span>${editable ? `<button type="button" class="mk-link-button" data-action="check-remove" data-id="${escape(c.id)}">Remove</button>` : ''}</li>`).join('')}</ul>` : ''}
      ${editable ? `<form id="check-add" class="mk-form mk-panel"><h3>Add a check</h3>
        <label for="chk-type">Check</label><select id="chk-type" name="type" data-check-type>${this.option(this.CHECKS, type)}</select>
        ${this.checkParams(type, files)}
        <p class="mk-caption">${detail.task.status === 'draft' ? '' : 'Changing checks changes the scope: agents quote again. '}</p>
        <div class="form-error" role="alert"></div><div class="mk-form-actions"><button type="submit">Add check</button></div></form>` : ''}</section>`;
  },
  checkResults(detail) {
    const subs = (detail.submissions || []).filter(s => s.checks);
    if (!subs.length) return '';
    const latest = subs.at(-1), results = latest.checks.results, failed = results.filter(r => r.status !== 'pass');
    return `<section class="mk-section" aria-labelledby="mk-results-title"><h2 id="mk-results-title">Checks on delivery v${latest.version}</h2>
      <div class="mk-readiness ${failed.length ? '' : 'mk-ready'}" role="status"><strong>${failed.length ? `${failed.length} of ${results.length} checks didn’t pass` : `All ${results.length} checks passed`}</strong>
        <span class="mk-caption">Checked ${escape(latest.checks.file || 'no CSV')}. ${failed.length ? 'Ask for changes and the failing checks are included automatically: the fix is free.' : 'Review the file and the checklist, then accept.'}</span></div>
      <ul class="mk-check-results">${results.map(r => `<li class="mk-check-${escape(r.status)}"><span class="mk-check-mark" aria-hidden="true">${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✕' : '!'}</span>
        <span><strong>${escape(r.label)}</strong> <span class="mk-caption">${escape(r.description)}</span><br>${escape(r.detail)}${r.examples?.length ? `<ul class="mk-bullets mk-caption">${r.examples.map(e => `<li>${escape(e)}</li>`).join('')}</ul>` : ''}</span>
        <span class="sr-only">${r.status === 'pass' ? 'Passed' : r.status === 'fail' ? 'Failed' : 'Couldn’t run'}</span></li>`).join('')}</ul></section>`;
  },
  async fileBase64(file) {
    if (!file || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a file of up to 5 MB.');
    const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsDataURL(file); });
    return String(url).slice(String(url).indexOf(',') + 1);
  },
};
