'use strict';
const { randomUUID }=require('node:crypto');
const { transaction }=require('./database.cjs');
const { fail,text,exactKeys,digest }=require('./security.cjs');
function marketplace(db,now=Date.now){
 const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const missing=()=>fail(404,'NOT_FOUND','Work or agent not found.');
 function integer(value,label,max){if(!Number.isSafeInteger(value)||value<1||value>max)fail(400,'INVALID_INPUT',`${label} is outside the supported range.`);return value;}
 function uuid(value){if(typeof value!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).test(value))fail(400,'INVALID_INPUT','A valid record ID is required.');return value;}
 function owned(actor,id){uuid(id);const a=get('SELECT * FROM agents WHERE id=? AND owner_id=?',id,actor.user.id);if(!a)missing();return a;}
 function buyer(actor,id){const t=get('SELECT * FROM tasks WHERE id=?',id);if(!t||!actor.memberships.some(m=>m.id===t.tenant_id&&m.role==='owner'))missing();return t;}
 function receipt(actor,key,content,operation){
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key))fail(400,'IDEMPOTENCY_REQUIRED','A valid Idempotency-Key is required.');
  const fingerprint=digest(JSON.stringify(content));
  return transaction(db,()=>{const prior=get('SELECT * FROM marketplace_receipts WHERE user_id=? AND key=?',actor.user.id,key);
   if(prior){if(prior.fingerprint!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT','This request key was already used for different content.');return JSON.parse(prior.response);}
   const result=operation();run('INSERT INTO marketplace_receipts VALUES (?,?,?,?)',actor.user.id,key,fingerprint,JSON.stringify(result));return result;
  });
 }
 function agentView(a){
  const capabilities=all('SELECT id,category,task,qualification FROM capabilities WHERE agent_id=? ORDER BY rowid',a.id);
  const rules=get('SELECT automatic_requested AS automaticRequested,minimum_payout AS minimumPayout,concurrency,version FROM agent_rules WHERE agent_id=?',a.id);
  return {...a,connection:'not_connected',capabilities,rules:{...rules,automaticRequested:!!rules.automaticRequested,automaticEnabled:false},readiness:{profile:!!a.purpose&&(a.kind!=='specialist'||!!a.domain),connection:false,capability:false,operator:false,payout:false,canQuoteCommercially:false,canReceivePaidWork:false}};
 }
 function agents(actor){return all('SELECT id,name,kind,integration,purpose,domain,setup_stage AS setupStage,created_at AS createdAt FROM agents WHERE owner_id=? ORDER BY created_at,id',actor.user.id).map(agentView);}
 function addAgent(actor,body,key){
  exactKeys(body,['name','kind','integration','capabilities','purpose','domain']);const name=text(body.name,'Agent name',1,80);
  if(!['general','specialist'].includes(body.kind)||!['api','sdk','mcp'].includes(body.integration))fail(400,'INVALID_INPUT','Choose an agent type and connection method.');
  const purpose=body.purpose===undefined?'':text(body.purpose,'Purpose',1,1000),domain=body.domain?text(body.domain,'Domain',1,150):'';
  if(body.purpose!==undefined&&body.kind==='specialist'&&!domain)fail(400,'INVALID_INPUT','Describe the specialist domain.');
  if(!Array.isArray(body.capabilities)||body.capabilities.length<1||body.capabilities.length>50)fail(400,'INVALID_INPUT','Add 1–50 capabilities per request.');
  const caps=body.capabilities.map(c=>{exactKeys(c,['category','task']);return {category:text(c.category,'Category',1,100),task:text(c.task,'Specific task',1,1000)};});
  return receipt(actor,key,['agent',body],()=>{const id=randomUUID();run('INSERT INTO agents(id,owner_id,name,kind,integration,purpose,domain,setup_stage,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,actor.user.id,name,body.kind,body.integration,purpose,domain,2,now());
   for(const c of caps)run('INSERT INTO capabilities(id,agent_id,category,task) VALUES (?,?,?,?)',randomUUID(),id,c.category,c.task);
   run('INSERT INTO agent_rules(agent_id) VALUES (?)',id);
   return {agentId:id};});
 }
 function configure(actor,id,body,key){
  owned(actor,id);exactKeys(body,['integration','automaticRequested','minimumPayout','concurrency','expectedVersion','setupStage','name','purpose','domain','kind']);
  if(!['api','sdk','mcp'].includes(body.integration)||typeof body.automaticRequested!=='boolean')fail(400,'INVALID_INPUT','Choose a connection method and automatic bidding preference.');
  integer(body.minimumPayout,'Minimum payout',10000000);integer(body.concurrency,'Concurrent tasks',100);integer(body.expectedVersion,'Settings version',Number.MAX_SAFE_INTEGER);integer(body.setupStage,'Setup stage',3);
  const profile=body.name!==undefined||body.purpose!==undefined||body.domain!==undefined||body.kind!==undefined;
  if(profile){text(body.name,'Agent name',1,80);text(body.purpose,'Purpose',1,1000);if(!['general','specialist'].includes(body.kind))fail(400,'INVALID_INPUT','Choose an agent type.');if(body.kind==='specialist')text(body.domain,'Domain',1,150);else if(body.domain)text(body.domain,'Domain',1,150);}
  return receipt(actor,key,['configure',id,body],()=>{const rules=get('SELECT version FROM agent_rules WHERE agent_id=?',id);if(rules.version!==body.expectedVersion)fail(409,'VERSION_CONFLICT','Agent settings changed. Refresh before saving.');
   run('UPDATE agents SET integration=?,setup_stage=? WHERE id=?',body.integration,body.setupStage,id);
   if(profile)run('UPDATE agents SET name=?,purpose=?,domain=?,kind=? WHERE id=?',body.name.trim(),body.purpose.trim(),(body.domain||'').trim(),body.kind,id);
   run('UPDATE agent_rules SET automatic_requested=?,minimum_payout=?,concurrency=?,version=version+1 WHERE agent_id=?',body.automaticRequested?1:0,body.minimumPayout,body.concurrency,id);
   return {agentId:id,version:rules.version+1,automaticEnabled:false};});
 }
 function publicTask(t){return {id:t.id,title:t.title,brief:t.brief,version:t.version,scopeVersion:t.scope_version,updatedAt:t.updated_at};}
 function opportunities(actor){return all("SELECT t.* FROM tasks t WHERE t.status='posted' AND NOT EXISTS(SELECT 1 FROM assignments a WHERE a.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM offer_selections s JOIN offers o ON o.id=s.offer_id WHERE s.task_id=t.id AND o.expires_at>?) AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=t.tenant_id AND m.user_id=?) ORDER BY t.updated_at DESC,t.id",now(),actor.user.id).map(t=>({...publicTask(t),context:all('SELECT body FROM messages WHERE task_id=? ORDER BY created_at,rowid',t.id).slice(1),myOffers:all('SELECT o.id,o.agent_id AS agentId,o.task_version AS taskVersion,o.scope_version AS scopeVersion,o.expires_at AS expiresAt FROM offers o JOIN agents a ON a.id=o.agent_id WHERE o.task_id=? AND a.owner_id=?',t.id,actor.user.id)}));}
 function quote(actor,id,body,key){
  exactKeys(body,['agentId','capabilityId','expectedVersion','amountMinor','deliveryMinutes','proposal']);owned(actor,body.agentId);
  uuid(body.capabilityId);integer(body.expectedVersion,'Task version',Number.MAX_SAFE_INTEGER);integer(body.amountMinor,'Amount',10000000);integer(body.deliveryMinutes,'Delivery estimate',525600);
  const proposal=text(body.proposal,'Offer details',1,3000);
  const cap=get('SELECT * FROM capabilities WHERE id=? AND agent_id=?',body.capabilityId,body.agentId);if(!cap)missing();
  return receipt(actor,key,['quote',id,body],()=>{
   const t=get('SELECT * FROM tasks WHERE id=?',id);
   if(!t||t.status!=='posted'||actor.memberships.some(m=>m.id===t.tenant_id))missing();
   if(get('SELECT 1 FROM assignments WHERE task_id=?',id))fail(409,'TASK_ASSIGNED','This task already has an accepted offer.');
   if(get('SELECT 1 FROM offer_selections s JOIN offers o ON o.id=s.offer_id WHERE s.task_id=? AND o.expires_at>?',id,now()))fail(409,'TASK_SELECTED','The buyer has selected an offer.');
   if(t.version!==body.expectedVersion)fail(409,'VERSION_CONFLICT','The task changed. Review the latest brief before quoting.');
   if(get('SELECT 1 FROM offers WHERE task_id=? AND agent_id=? AND scope_version=? AND expires_at>?',id,body.agentId,t.scope_version,now()))fail(409,'OFFER_EXISTS','This agent has already quoted on this version of the task.');
   const offerId=randomUUID(),time=now();run('INSERT INTO offers VALUES (?,?,?,?,?,?,?,?,?,?,?)',offerId,id,body.agentId,cap.id,t.version,body.amountMinor,body.deliveryMinutes,proposal,time,time+86400000,t.scope_version);
   run('INSERT INTO events(task_id,actor_id,type,version,created_at) VALUES (?,?,?,?,?)',id,actor.user.id,'offer.received',t.version,time);
   return {offerId,taskId:id};
  });
 }
 function offers(actor,id){buyer(actor,id);return all(`SELECT o.id,o.task_version AS taskVersion,o.scope_version AS scopeVersion,o.amount_minor AS amountMinor,o.delivery_minutes AS deliveryMinutes,o.proposal,o.expires_at AS expiresAt,
  a.name AS agentName,a.kind AS agentType,u.name AS operatorName,c.category,c.task AS capability,c.qualification,
  EXISTS(SELECT 1 FROM assignments x WHERE x.offer_id=o.id) OR EXISTS(SELECT 1 FROM offer_selections s WHERE s.offer_id=o.id AND o.expires_at>?) AS selected
  FROM offers o JOIN agents a ON a.id=o.agent_id JOIN users u ON u.id=a.owner_id JOIN capabilities c ON c.id=o.capability_id WHERE o.task_id=? ORDER BY o.created_at,o.id`,now(),id).map(o=>({...o,currency:'USD',selected:!!o.selected}));}
 function accept(actor,id,body,key){
  exactKeys(body,['offerId','expectedVersion']);uuid(body.offerId);buyer(actor,id);integer(body.expectedVersion,'Task version',Number.MAX_SAFE_INTEGER);
  return receipt(actor,key,['accept',id,body],()=>{const t=buyer(actor,id),o=get('SELECT * FROM offers WHERE id=? AND task_id=?',body.offerId,id);
   if(!o)missing();
   if(get('SELECT 1 FROM assignments WHERE task_id=?',id))fail(409,'TASK_ASSIGNED','An offer has already been accepted.');
   if(t.status!=='posted'||t.version!==body.expectedVersion)fail(409,'VERSION_CONFLICT','The conversation changed. Refresh before selecting an offer.');
   if(o.scope_version!==t.scope_version)fail(409,'VERSION_CONFLICT','The scope changed. Request an updated offer before selecting.');
   if(o.expires_at<=now())fail(409,'OFFER_EXPIRED','This offer expired. Request a new offer.');
   run('INSERT INTO offer_selections VALUES (?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET offer_id=excluded.offer_id,selected_by=excluded.selected_by,selected_at=excluded.selected_at',id,o.id,actor.user.id,now());
   run('UPDATE tasks SET version=version+1,updated_at=? WHERE id=?',now(),id);
   run('INSERT INTO events(task_id,actor_id,type,version,created_at) VALUES (?,?,?,?,?)',id,actor.user.id,'offer.selected',t.version+1,now());
   return {taskId:id,offerId:o.id,version:t.version+1,status:'selected',executionAuthorized:false};
  });
 }
 function work(actor){const pending=all(`SELECT t.id,t.title,t.brief,t.version,s.selected_at AS acceptedAt,o.amount_minor AS amountMinor,o.delivery_minutes AS deliveryMinutes,o.proposal,a.name AS agentName,o.id AS offerId FROM offer_selections s JOIN tasks t ON t.id=s.task_id JOIN offers o ON o.id=s.offer_id JOIN agents a ON a.id=o.agent_id WHERE a.owner_id=? AND o.expires_at>? AND NOT EXISTS(SELECT 1 FROM assignments x WHERE x.task_id=t.id)`,actor.user.id,now()).map(w=>({...w,status:'selected',currency:'USD',messages:all('SELECT m.body,m.created_at AS createdAt,u.name AS authorName FROM messages m JOIN users u ON u.id=m.author_id WHERE m.task_id=? ORDER BY m.created_at,m.rowid',w.id)}));return [...pending,...all(`SELECT t.id,t.title,t.brief,t.version,x.accepted_at AS acceptedAt,o.amount_minor AS amountMinor,o.delivery_minutes AS deliveryMinutes,o.proposal,a.name AS agentName,o.id AS offerId
 FROM assignments x JOIN tasks t ON t.id=x.task_id JOIN offers o ON o.id=x.offer_id JOIN agents a ON a.id=o.agent_id WHERE a.owner_id=? ORDER BY x.accepted_at DESC`,actor.user.id).map(w=>({...w,status:'assigned',currency:'USD',messages:all('SELECT m.body,m.created_at AS createdAt,u.name AS authorName FROM messages m JOIN users u ON u.id=m.author_id WHERE m.task_id=? ORDER BY m.created_at,m.rowid',w.id)}))];}
 function quotes(actor){return all(`SELECT o.id,o.task_id AS taskId,t.title,a.name AS agentName,o.amount_minor AS amountMinor,o.delivery_minutes AS deliveryMinutes,
 CASE WHEN x.offer_id=o.id THEN 'accepted' WHEN x.task_id IS NOT NULL THEN 'not_selected' WHEN t.status='cancelled' THEN 'closed' WHEN o.scope_version<>t.scope_version THEN 'needs_update' WHEN o.expires_at<=? THEN 'expired' WHEN EXISTS(SELECT 1 FROM offer_selections s WHERE s.offer_id=o.id) THEN 'selected' ELSE 'pending' END AS status
 FROM offers o JOIN tasks t ON t.id=o.task_id JOIN agents a ON a.id=o.agent_id LEFT JOIN assignments x ON x.task_id=t.id WHERE a.owner_id=? ORDER BY o.created_at DESC,o.id`,now(),actor.user.id);}
 return {agents,addAgent,opportunities,quote,offers,accept,work,quotes,configure};
}
module.exports={marketplace};
