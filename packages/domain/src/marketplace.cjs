'use strict';
/* Server-side policy primitives. No browser storage, network, database or payment SDK. */
const {createHash}=require('node:crypto');
function minor(value,name='amount'){if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`${name} must be a nonnegative safe integer`);return value}
function quoteBreakdown(payoutMinor,feeBps){minor(payoutMinor);if(!Number.isInteger(feeBps)||feeBps<0||feeBps>=10000)throw new TypeError('Invalid fee basis points');const d=BigInt(10000-feeBps),n=BigInt(payoutMinor)*10000n;const total=(n+d/2n)/d;if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Amount too large');return {payoutMinor,totalMinor:Number(total),feeMinor:Number(total)-payoutMinor,feeBps}}
function binding(task,offer){
 const values=[task.workspaceId,task.id,task.scopeVersion,task.scopeHash,offer.id,offer.revision,offer.operatorId,offer.currency,offer.totalMinor,offer.payoutMinor,offer.feeMinor,offer.deliveryMinutes,offer.startWithinMinutes,offer.includedRevisions,offer.termsVersion,offer.capabilityRevision,offer.expiresAt];
 if(values.some(v=>v===undefined||v===null||v===''))throw new TypeError('Incomplete agreement binding');
 minor(offer.totalMinor);minor(offer.payoutMinor);minor(offer.feeMinor);if(offer.totalMinor===0)throw new TypeError('Paid funding requires a positive quote');if(offer.totalMinor!==offer.payoutMinor+offer.feeMinor)throw new TypeError('Quote does not reconcile');
 return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
const deny=code=>({allowed:false,code}),allow=()=>({allowed:true,code:'OK'});
function buyerRights(actor,task){return actor&&actor.workspaceId===task.workspaceId&&(actor.role==='admin'||actor.id===task.requesterId&&actor.role==='buyer')}
function evaluateFunding({actor,task,offer,approval,approvalRequired=false,availableBudgetMinor,now}){
 if(!buyerRights(actor,task))return deny('FORBIDDEN');
 if(task.status!=='quoted'||task.paymentStatus!=='unfunded')return deny('STATE_CONFLICT');
 if(!Number.isFinite(now)||!Number.isFinite(offer.expiresAt)||now>=offer.expiresAt||offer.state!=='open')return deny('OFFER_UNAVAILABLE');
 if(offer.id!==task.selectedOfferId||offer.scopeVersion!==task.scopeVersion||offer.workspaceId!==task.workspaceId||offer.taskId!==task.id)return deny('STALE_OFFER');
 let key;try{key=binding(task,offer)}catch{return deny('INVALID_AGREEMENT')}
 if(availableBudgetMinor!==undefined&&(!Number.isSafeInteger(availableBudgetMinor)||availableBudgetMinor<offer.totalMinor))return deny('BUDGET_EXCEEDED');
 if(approvalRequired&&(!approval||approval.status!=='approved'||approval.binding!==key||approval.workspaceId!==task.workspaceId||approval.taskId!==task.id||approval.deciderId===task.requesterId||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=now))return deny('APPROVAL_REQUIRED');
 return allow();
}
function evaluateAcceptance({actor,task,submission}){
 if(!buyerRights(actor,task))return deny('FORBIDDEN');
 if(task.status!=='buyer_review'||task.disputeOpen)return deny('STATE_CONFLICT');
 if(!submission||submission.id!==task.currentSubmissionId||submission.scopeVersion!==task.scopeVersion||submission.assignmentId!==task.assignmentId||submission.workspaceId!==task.workspaceId)return deny('STALE_SUBMISSION');
 if(submission.scanStatus!=='clean'||submission.checkStatus!=='passed'||!submission.manifestHash)return deny('SUBMISSION_NOT_READY');
 return allow();
}
function evaluatePayout({task,payment,payout}){
 if(task.status!=='accepted'||task.disputeOpen)return deny('ACCEPTANCE_REQUIRED');
 if(payment.workspaceId!==task.workspaceId||payment.taskId!==task.id||payment.status!=='succeeded'||payment.reconciliationStatus!=='reconciled'||payment.disputeOpen||payment.refundStatus!=='none'||!Number.isSafeInteger(payment.availableForPayoutMinor)||payment.availableForPayoutMinor<payout.amountMinor)return deny('PAYMENT_NOT_FINAL');
 if(payout.taskId!==task.id||payout.operatorId!==task.operatorId||payout.status!=='held'||!payout.providerEligible)return deny('PAYOUT_NOT_READY');
 if(!Number.isSafeInteger(payout.amountMinor)||payout.amountMinor<0||payout.amountMinor!==task.agreedPayoutMinor||payout.currency!==payment.currency)return deny('PAYOUT_MISMATCH');
 return allow();
}
module.exports=Object.freeze({quoteBreakdown,binding,evaluateFunding,evaluateAcceptance,evaluatePayout});
