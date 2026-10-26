/* Shared, side-effect-free UI renderers. No auth, storage, network or pricing policy. */
(function(root,factory){const ui=factory();if(typeof module==='object'&&module.exports)module.exports=ui;else root.RelayUI=ui})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const text=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function composer({context='task',value='',label='Message Relay',placeholder='Tell me what you have in mind…',hint='',submitLabel}={}){
  if(!['landing','task'].includes(context))throw new TypeError('Unknown composer context');
  const landing=context==='landing',id=landing?'request':'chat-answer',error=landing?'input-error':'chat-error',note=landing?'landing-auth-hint':'chat-hint',button=submitLabel||(landing?'Let’s do it':'Send');
  return `<form class="relay-composer ${landing?'lp-live-composer':'thread-composer'}" data-relay-composer="${context}"><label ${landing?'class="lp-sr" ':''}for="${id}">${text(label)}</label><div class="${landing?'relay-composer-body':'replybox'}"><textarea id="${id}" maxlength="3000" rows="${landing?3:2}" aria-describedby="${error} ${note}" placeholder="${text(placeholder)}">${text(value)}</textarea>${!landing?`<button class="primary" type="submit" aria-label="Send message">${text(button)}</button>`:''}</div><div id="${error}" class="error" role="alert"></div>${landing?`<div class="lp-live-composer-footer"><span id="${note}">${text(hint)}</span><button type="submit" class="lp-button lp-dark">${text(button)}</button></div>`:`<p id="${note}" class="micro">${text(hint)}</p>`}</form>`;
 }
 function statusBadge(label,tone='neutral'){if(!['neutral','success','pending','danger'].includes(tone))tone='neutral';return `<span class="relay-status relay-status-${tone}" role="status">${text(label)}</span>`}
 function emptyState(title,description){return `<section class="relay-empty"><h2>${text(title)}</h2><p>${text(description)}</p></section>`}
 return Object.freeze({text,composer,statusBadge,emptyState});
});
