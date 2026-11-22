'use strict';

// Build → Relay tests (docs/Build-Order.md, step 8). Builders propose a test as
// data; Relay staff approve or reject it before any agent can take it. Staff see
// their review queue on the same page. Expected outputs are shown only to the
// test's author and to staff.
const RelayTests = {
  STATUS: { in_review: 'Waiting for Relay review', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', retired: 'Retired' },

  page() {
    const data = state.relayTests;
    if (!data) return '<div class="mk-empty"><p>Relay tests aren’t available here yet.</p></div>';
    return (data.canReview ? this.queue() : '') + this.available(data.approved) + this.mine(data.mine) + this.form();
  },

  cases: n => `${n} case${n === 1 ? '' : 's'}`,

  available(tests) {
    const row = t => `<tr><td><strong>${escape(t.title)}</strong> <span class="mk-caption">· ${escape(this.cases(t.caseCount || 1))}</span><br><span class="mk-caption">${escape(t.limitation)}</span></td><td>${escape(t.category)}</td><td>${escape(t.authorName)}</td></tr>`;
    const table = (list, empty) => list.length
      ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th scope="col">Test</th><th scope="col">Category</th><th scope="col">Written by</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`
      : `<p class="mk-empty-note">${empty}</p>`;
    const relay = tests.filter(t => t.builtIn), builders = tests.filter(t => !t.builtIn);
    return RelayBuild.section('Relay’s tests', relay.length, '', `<p class="mk-caption">Written by Relay for B2B data and research work. Each has several cases, and an agent passes only if it gets every case right in both rounds. CSV clean-up and offline link extraction are here too, on every capability’s Relay tests tab.</p>${table(relay, 'Only CSV clean-up and offline link extraction so far.')}`)
      + RelayBuild.section('Tests other builders wrote', builders.length, '', `<p class="mk-caption">Approved by Relay staff. Your agent can take one from its Relay tests tab when a capability is in the test’s category.</p>${table(builders, 'None approved yet.')}`);
  },

  mine(tests) {
    if (!tests.length) return '';
    return RelayBuild.section('Your proposals', tests.length, '', `<ul class="mk-threads">${tests.map(t => `<li class="mk-thread mk-test-card"><div class="mk-thread-body"><p><strong>${escape(t.title)}</strong> <span class="mk-status">${escape(this.STATUS[t.status] || t.status)}</span></p>
      <p class="mk-caption">${escape(t.category)} · proposed ${escape(RelayBuild.ago(t.createdAt))}</p>
      ${t.reason ? `<p>${t.status === 'retired' ? 'Retired' : 'Reason'}: ${escape(t.reason)}</p>` : ''}
      ${t.status === 'approved' ? '<p class="mk-caption">Agents can take it now. When your own agent passes it, its card says you wrote the test.</p>' : ''}
      ${t.status === 'retired' ? '<p class="mk-caption">No new runs. Passes already earned stay until they expire.</p>' : ''}
      ${this.details(t)}
      <div class="mk-form-actions">${t.status === 'in_review' ? `<button type="button" data-action="withdraw-relay-test" data-id="${escape(t.id)}" data-version="${t.version}">Withdraw</button>` : ''}${['rejected', 'withdrawn', 'retired'].includes(t.status) ? `<button type="button" data-action="copy-relay-test" data-id="${escape(t.id)}">Edit as a new proposal</button>` : ''}</div></div></li>`).join('')}</ul>`);
  },

  // The full test, for its author and for staff.
  details(t) {
    const cases = t.cases || [];
    const one = (c, i) => `${cases.length > 1 ? `<h4>Case ${i + 1}</h4>` : ''}
      <p><strong>Input</strong></p><pre>${escape(c.input)}</pre>
      <p><strong>Expected output</strong></p><pre>${escape(c.expected)}</pre>
      <p><strong>Change request:</strong> ${escape(c.revision)}</p>
      <p><strong>Expected output after the change</strong></p><pre>${escape(c.revisionExpected)}</pre>`;
    return `<details class="quiet-details"><summary>The test · ${escape(this.cases(cases.length))}</summary>
      <p><strong>Instructions for the agent</strong></p><p>${escape(t.brief)}</p>
      ${cases.map(one).join('')}
      <p class="mk-caption">Compared: ${escape((state.relayTests?.comparisons || {})[t.comparison] || t.comparison)}${cases.length > 1 ? '. Every case has to match' : ''}. What it doesn’t check: ${escape(t.limitation)}</p></details>`;
  },

  // One case's fields. Case 1 is required; cases 2 to 5 are optional and folded.
  caseFields(i, draft = {}) {
    const n = i + 1, req = i === 0 ? 'required' : '';
    const area = (name, label, hint = '') => `<label for="rt-${name}-${i}">${label}</label><textarea id="rt-${name}-${i}" name="${name}-${i}" rows="4" maxlength="8192" ${req}>${escape(draft[name] || '')}</textarea>${hint ? `<p class="mk-caption">${hint}</p>` : ''}`;
    const fields = `${area('input', 'Test input', i === 0 ? 'Synthetic data only, never real customer data. Include <code>{{nonce}}</code> somewhere: Relay replaces it with a new value on every run, so an old answer can’t be reused.' : 'Include <code>{{nonce}}</code> here too. Each case gets its own value.')}
      ${area('expected', 'Expected output', i === 0 ? 'Include <code>{{nonce}}</code> where it should appear in the answer. Agents never see this.' : '')}
      <label for="rt-revision-${i}">Change request</label><input id="rt-revision-${i}" name="revision-${i}" maxlength="300" ${i === 0 ? 'minlength="5" required' : ''} value="${escape(draft.revision || '')}" placeholder="e.g. Sort the vendors alphabetically.">
      ${area('revisionExpected', 'Expected output after the change', i === 0 ? 'Must differ from the first expected output.' : '')}`;
    return i === 0 ? `<fieldset class="mk-test-case"><legend>Case 1</legend>${fields}</fieldset>`
      : `<details class="mk-test-case" ${draft.input ? 'open' : ''}><summary>Case ${n} <span class="mk-optional">optional</span></summary>${fields}</details>`;
  },

  form() {
    const draft = (state.relayTests?.mine || []).find(t => t.id === state.relayTestDraft) || {};
    const fields = state.taxonomy || [], comparisons = state.relayTests?.comparisons || {};
    const max = state.relayTests?.maxCases || 5, cases = draft.cases || [];
    const area = (name, label, rows, max, hint = '') => `<label for="rt-${name}">${label}</label><textarea id="rt-${name}" name="${name}" rows="${rows}" maxlength="${max}" required>${escape(draft[name] || '')}</textarea>${hint ? `<p class="mk-caption">${hint}</p>` : ''}`;
    return RelayBuild.section('Propose a test', null, '', `<form id="relay-test-propose" class="mk-form mk-panel">
      <p class="mk-caption">Write a small job that shows an agent can do one kind of work. Relay sends it to the agent, then sends a change request, and compares both answers with what you expect. Add up to ${max} cases with different data: an agent passes only if it gets every case right. Relay staff check every proposal before agents can take it. Your own agents can take it too, and their card will say you wrote it.</p>
      <label for="rt-title">Name</label><input id="rt-title" name="title" minlength="3" maxlength="80" required value="${escape(draft.title || '')}" placeholder="e.g. Vendor name standardisation">
      <label for="rt-category">Category it tests</label><select id="rt-category" name="categoryId" required><option value="" disabled ${draft.categoryId ? '' : 'selected'}>Choose a category</option>${fields.map(f => `<optgroup label="${escape(f.label)}">${f.tasks.map(t => `<option value="${escape(t.id)}" ${draft.categoryId === t.id ? 'selected' : ''}>${escape(t.label)}</option>`).join('')}</optgroup>`).join('')}</select>
      <p class="mk-caption">A pass only counts for capabilities in this category.</p>
      ${area('brief', 'Instructions for the agent', 3, 1000, 'The same instructions go with every case.')}
      ${Array.from({ length: max }, (_, i) => this.caseFields(i, cases[i])).join('')}
      <label for="rt-comparison">How Relay compares</label><select id="rt-comparison" name="comparison">${Object.entries(comparisons).map(([id, label]) => `<option value="${escape(id)}" ${(draft.comparison || 'lines') === id ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select>
      ${area('limitation', 'What this test doesn’t check', 2, 400, 'Shown on every agent card that passes it, so buyers don’t read more into a pass than it proves.')}
      <div class="form-error" role="alert"></div>
      <div class="mk-form-actions"><button class="mk-primary" type="submit">Send for review</button>${draft.id ? '<button type="button" data-action="copy-relay-test" data-id="">Clear</button>' : ''}</div></form>`);
  },

  // Relay staff only.
  queue() {
    const q = state.relayTestQueue || { waiting: [], approved: [] };
    const checklist = '<ul class="mk-caption"><li>Does it test the category it names, not something easier?</li><li>Is the expected output right, and would a careless agent fail?</li><li>Is the data synthetic, with no real people or companies?</li><li>Is “what it doesn’t check” honest?</li><li>Its author can take it: would you still approve it?</li></ul>';
    const decide = (t, choices) => `<form class="mk-form relay-test-review" data-id="${escape(t.id)}" data-version="${t.version}">
      <label for="rv-${escape(t.id)}">Reason for the builder <span class="mk-optional">needed to reject or retire</span></label><textarea id="rv-${escape(t.id)}" name="reason" rows="2" maxlength="500"></textarea>
      <div class="form-error" role="alert"></div><div class="mk-form-actions">${choices.map(([d, label]) => `<button type="submit" name="decision" value="${d}" ${d === 'approve' ? 'class="mk-primary"' : ''}>${label}</button>`).join('')}</div></form>`;
    // Relay's own tests change with a release, so staff can read them here but not retire them.
    const item = (t, choices) => `<li class="mk-thread mk-test-card"><div class="mk-thread-body"><p><strong>${escape(t.title)}</strong> <span class="mk-status">${escape(this.STATUS[t.status])}</span></p><p class="mk-caption">${escape(t.category)} · by ${escape(t.authorName)}${t.builtIn ? ' · ships with Relay' : ` · ${escape(RelayBuild.ago(t.createdAt))}`}</p>${this.details(t)}${t.builtIn ? '' : decide(t, choices)}</div></li>`;
    return RelayBuild.section('Waiting for your review', q.waiting.length, '', `<p class="mk-caption">You see this because you’re Relay staff. Before approving, check:</p>${checklist}${q.waiting.length ? `<ul class="mk-threads">${q.waiting.map(t => item(t, [['approve', 'Approve'], ['reject', 'Reject']])).join('')}</ul>` : '<p class="mk-empty-note">Nothing waiting.</p>'}`)
      + (q.approved.length ? RelayBuild.section('Approved tests', q.approved.length, '', `<p class="mk-caption">Retire a test that turns out to be flawed. Agents can’t start it again; passes already earned stay until they expire.</p><ul class="mk-threads">${q.approved.map(t => item(t, [['retire', 'Retire']])).join('')}</ul>`) : '');
  },

  async load() {
    state.relayTests = await api('/api/relay-tests').catch(() => null);
    state.relayTestQueue = state.relayTests?.canReview ? await api('/api/relay-tests/review').catch(() => null) : null;
  },
  // Case 1 always goes; a later case goes when any of its fields is filled in.
  body(data) {
    const body = Object.fromEntries(['title', 'categoryId', 'brief', 'limitation', 'comparison'].map(k => [k, String(data.get(k) || '')]));
    const fields = ['input', 'expected', 'revision', 'revisionExpected'];
    body.cases = Array.from({ length: state.relayTests?.maxCases || 5 }, (_, i) => Object.fromEntries(fields.map(k => [k, String(data.get(`${k}-${i}`) || '')])))
      .filter((c, i) => i === 0 || fields.some(k => c[k].trim()));
    return body;
  },
  propose(data) { return command('/api/relay-tests', 'POST', this.body(data)); },
};
