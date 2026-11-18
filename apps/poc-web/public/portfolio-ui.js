'use strict';
const RelayPortfolio = {
  content(item) {
    return `<h3>${escape(item.title)}</h3><p>${escape(item.summary)}</p><details><summary>Sample output</summary><p class="offer-details">${escape(item.sample)}</p></details>`;
  },
  storefront(items = []) {
    if (!items.length) return '';
    return `<section aria-label="Portfolio examples"><h2>Examples of work</h2><p class="hint">Selected by the builder. Examples are separate from Relay capability assessments.</p>${items.map(item => `<article class="panel">${this.content(item)}<small>${item.kind === 'relay-task' ? 'Customer-approved excerpt from accepted Relay work' : 'Original example · rights declared by builder'}</small></article>`).join('')}</section>`;
  },
  action(item, action, label) {
    return `<button type="button" data-action="portfolio-decision" data-id="${escape(item.id)}" data-version="${item.version}" data-decision="${action}">${label}</button>`;
  },
  settings(agent) {
    const work = (state.work || []).filter(task => task.execution?.agentId === agent.id && task.execution.status === 'accepted');
    const examples = agent.portfolio || [];
    return `<section class="panel"><h2>Portfolio examples</h2><p>Share an original example or ask a customer to approve a redacted excerpt from accepted work. Task files and private context stay private.</p>
      ${examples.map(item => `<article class="panel">${this.content(item)}<p class="tag">${escape(item.status)}</p>${item.taskId ? `<button type="button" data-action="builder-task" data-id="${escape(item.taskId)}">View source task</button>` : ''}${['published', 'pending'].includes(item.status) ? this.action(item, 'withdraw', 'Remove from sharing') : ''}</article>`).join('')}
      ${examples.length >= 20 ? '<p>This agent has reached the 20-example history limit.</p>' : `<details><summary>Add a portfolio example</summary><form id="portfolio-add" data-id="${escape(agent.id)}" data-version="${agent.version}">
        <label>Source<select name="source"><option value="owned">Original example I own (not customer work)</option>${work.map(task => `<option value="${escape(task.id)}">Accepted Relay work: ${escape(task.title)}</option>`).join('')}</select></label>
        <p class="hint">If accepted work is not in this list, refresh your workspace. Customer work requires the current customer workspace owner’s approval before appearing on your profile.</p>
        <label>Example title<input name="title" maxlength="120" required></label>
        <label>What this demonstrates<textarea name="summary" maxlength="1200" required></textarea></label>
        <label>Redacted sample output<textarea name="sample" maxlength="6000" required></textarea></label>
        <label><input type="checkbox" name="consent" required> I removed confidential and personal data and have the rights to propose sharing this text. Original examples are my own work, not client work.</label>
        <p class="hint">These exact words will be shared with signed-in buyers when published. No files or links are published. To change approved text, remove it and submit a new example for fresh approval.</p>
        <div class="form-error" role="alert"></div><button type="submit">Add example / request permission</button>
      </form></details>`}</section>`;
  },
  requests(items = []) {
    if (!items.length) return '';
    return `<section class="panel" aria-label="Portfolio sharing"><h2>Permission to share this work</h2><p>Only the excerpt below can appear on the agent’s storefront. This does not share task files or grant access to your tools. You can revoke permission; copies already seen by others cannot be recalled.</p>
      ${items.map(item => `<article class="panel"><p>${escape(item.agentName)} · ${escape(item.status)}</p>${this.content(item)}${item.canDecide ? (item.status === 'pending' ? `<p>Do you have the authority and rights to share this exact excerpt with signed-in Relay buyers?</p><div class="inline-actions">${this.action(item, 'approve', 'Approve this exact excerpt')}${this.action(item, 'decline', 'Decline')}</div>` : item.status === 'published' ? this.action(item, 'revoke', 'Revoke sharing permission') : '') : '<p class="hint">A workspace owner must approve sharing.</p>'}</article>`).join('')}</section>`;
  },
};
