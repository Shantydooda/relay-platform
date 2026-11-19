'use strict';

// Agent categories: fields with tasks under each, in the pattern of Hugging
// Face's task list (approved by the founder, 19 Nov 2026). Builders pick a task
// for each capability; buyers filter by field or task. Seed category first
// (docs/Seed-Category.md). A category is a declaration, never evidence: it says
// nothing about whether an agent passed a Relay test.
//
// Keywords map older free-text categories onto the list, so agents listed
// before this taxonomy still show up in the right place.

const FIELDS = Object.freeze([
  { id: 'data-research', label: 'Data & research', seed: true, tasks: [
    ['lead-lists', 'Lead lists & prospecting', 'lead,leads,prospect,prospecting,outbound list,decision maker,contact list,sdr'],
    ['market-research', 'Company & market research', 'research,market,competitor,competitive,due diligence,company profile,desk research,intelligence'],
    ['data-enrichment', 'Data enrichment', 'enrich,enrichment,firmographic,email verification,verify email,append'],
    ['data-cleanup', 'Data cleanup & deduplication', 'clean,cleanup,dedupe,deduplicate,duplicate,normalize,normalise,csv,tidy,standardize'],
    ['web-extraction', 'Web data extraction', 'scrape,scraping,crawl,extract from web,web data,links,link inventory'],
  ] },
  { id: 'erp-finance', label: 'ERP & finance operations', tasks: [
    ['erp-migration', 'ERP data migration', 'erp,migration,netsuite,sap,s/4hana,dynamics,cutover,load file,import file'],
    ['master-data', 'Master-data cleanup', 'master data,vendor master,customer master,item master,mdm'],
    ['reconciliation', 'Reconciliation (AR/AP/bank)', 'reconcile,reconciliation,bank rec,accounts receivable,accounts payable,ar,ap,ledger'],
    ['invoice-processing', 'Invoice & document processing', 'invoice,invoices,receipt,purchase order,bill,accounts payable automation'],
    ['close-reporting', 'Close & reporting support', 'month end,close,financial report,trial balance,variance,fp&a,accounting report'],
  ] },
  { id: 'sales-marketing', label: 'Sales & marketing', tasks: [
    ['outreach', 'Outreach', 'outreach,cold email,sequence,campaign email,follow up'],
    ['crm-hygiene', 'CRM hygiene', 'crm,hubspot,salesforce,attio,pipedrive,pipeline cleanup'],
    ['content-copy', 'Content & copy', 'copy,copywriting,content,blog,article,newsletter,landing page copy'],
    ['seo', 'SEO', 'seo,search engine,keywords,backlinks'],
    ['campaign-analysis', 'Campaign analysis', 'ads,advertising,campaign analysis,attribution,marketing analytics'],
  ] },
  { id: 'software', label: 'Software & engineering', tasks: [
    ['code-review', 'Code review', 'code review,review pull request,pr review'],
    ['bug-fixes', 'Bug fixes & maintenance', 'bug,fix,maintenance,patch,refactor'],
    ['tests-qa', 'Tests & QA', 'test,tests,qa,quality assurance,test coverage'],
    ['migrations-upgrades', 'Migrations & upgrades', 'upgrade,framework migration,dependency,version bump,port'],
    ['documentation', 'Documentation', 'documentation,docs,readme,api reference'],
    ['integrations', 'Integrations & data pipelines', 'integration,pipeline,etl,api integration,sync,webhook'],
  ] },
  { id: 'support', label: 'Customer support', tasks: [
    ['ticket-triage', 'Ticket triage', 'ticket,triage,support ticket,help desk,helpdesk'],
    ['knowledge-base', 'Knowledge base', 'knowledge base,faq,help center,help article'],
    ['reply-drafting', 'Reply drafting', 'reply,customer reply,support reply,response drafting'],
  ] },
  { id: 'operations', label: 'Operations & documents', tasks: [
    ['document-extraction', 'Document extraction (PDF → data)', 'pdf,document extraction,ocr,parse document,forms'],
    ['spreadsheets', 'Spreadsheets & reporting', 'spreadsheet,excel,google sheets,report,dashboard'],
    ['translation', 'Translation', 'translate,translation,localize,localization'],
    ['admin', 'Admin & scheduling', 'admin,scheduling,calendar,data entry,inbox'],
  ] },
  { id: 'design-media', label: 'Design & media', tasks: [
    ['presentations', 'Presentations', 'presentation,slides,deck,pitch deck,powerpoint'],
    ['images', 'Images & graphics', 'image,graphic,logo,illustration,banner,design'],
    ['video', 'Video', 'video,edit video,clip,subtitles,captions'],
  ] },
].map(field => Object.freeze({ ...field, tasks: Object.freeze(field.tasks.map(([id, label, words]) => Object.freeze({ id, label, field: field.id, keywords: words.split(',') }))) })));

const OTHER = Object.freeze({ id: 'other', label: 'Other', field: 'other' });
const TASKS = new Map(FIELDS.flatMap(f => f.tasks).map(t => [t.id, t]));

function taskById(id) { return id === 'other' ? OTHER : TASKS.get(id) || null; }
function fieldById(id) { return FIELDS.find(f => f.id === id) || null; }

// Best-matching task for free text, or null. Whole-word matches only, so "ap"
// doesn't match "apple"; longer phrases count for more.
function classify(text) {
  const haystack = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9&/+ ]+/g, ' ')} `;
  let best = null, score = 0;
  for (const task of TASKS.values()) {
    const s = task.keywords.reduce((n, word) => n + (haystack.includes(` ${word} `) ? word.split(' ').length + 1 : 0), 0);
    if (s > score) { best = task.id; score = s; }
  }
  return best;
}

// A capability's task: the builder's choice, or the best match for older text.
function categoryOf(capability) {
  if (capability?.categoryId && (capability.categoryId === 'other' || TASKS.has(capability.categoryId))) return capability.categoryId;
  return classify(`${capability?.category || ''} ${capability?.task || ''}`) || 'other';
}

// The list as sent to browsers.
function taxonomy() {
  return FIELDS.map(f => ({ id: f.id, label: f.label, seed: !!f.seed, tasks: f.tasks.map(({ id, label }) => ({ id, label })) }));
}

module.exports = { FIELDS, OTHER, taskById, fieldById, classify, categoryOf, taxonomy };
