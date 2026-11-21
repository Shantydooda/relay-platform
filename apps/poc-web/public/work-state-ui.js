'use strict';

// Words for the server's work state (packages/domain/src/work-state.cjs).
// The server decides the phase, whose move it is and why; this file only turns
// those codes into copy, once, for the buyer and for the builder.
const RelayWorkState = {
  LABELS: {
    buyer: {
      BRIEF_DRAFT: 'Draft',
      AWAITING_OFFERS: 'Getting offers',
      OFFERS_READY: 'Offers ready',
      READY_TO_START: 'Ready to start',
      APPROVAL_PENDING: 'Waiting for approval',
      APPROVAL_NEEDED: 'Approval needed',
      SCHEDULE_ACTIVE: 'Schedule enabled',
      REQUEST_CLOSED: 'Closed',
      AGENT_STARTING: 'Agent getting ready',
      WORKING: 'In progress',
      AGENT_RECONNECTING: 'Agent reconnecting',
      REVISION_QUEUED: 'Changes requested',
      REVISING: 'Agent making changes',
      PAUSED_BY_BUYER: 'Paused',
      PERMISSION_NEEDED: 'Permission needed',
      FILES_CHECKING: 'Checking delivery',
      FILE_BLOCKED: 'File blocked',
      DELIVERY_READY: 'Delivery ready',
      ACCEPTED: 'Delivery accepted',
      AUTO_ACCEPTED: 'Accepted automatically',
      ENDED_UNMET: 'Ended · checklist not met',
      DEADLINE_PASSED: 'Ended · deadline passed',
      AGENT_DID_NOT_START: 'Ended · agent didn’t start',
      RETRIES_EXHAUSTED: 'Ended · agent kept disconnecting',
      AGENT_REPORTED_FAILURE: 'Ended · agent couldn’t finish',
      CANCELLED: 'Cancelled',
      REPLACED_BY_CHANGE: 'Replaced by a change',
      FAILED: 'Ended · the work failed',
    },
    builder: {
      BRIEF_DRAFT: 'Draft',
      AWAITING_OFFERS: 'Open for offers',
      OFFERS_READY: 'Buyer comparing offers',
      READY_TO_START: 'Selected · buyer has not started it',
      APPROVAL_PENDING: 'Selected · waiting for company approval',
      APPROVAL_NEEDED: 'Selected · buyer needs approval',
      SCHEDULE_ACTIVE: 'Scheduled',
      REQUEST_CLOSED: 'Closed',
      AGENT_STARTING: 'Ready to claim',
      WORKING: 'In progress',
      AGENT_RECONNECTING: 'Lease lapsed · reconnect to resume',
      REVISION_QUEUED: 'Changes requested · claim to revise',
      REVISING: 'Revising',
      PAUSED_BY_BUYER: 'Paused by the buyer',
      PERMISSION_NEEDED: 'Waiting for buyer permission',
      FILES_CHECKING: 'Delivered · files being scanned',
      FILE_BLOCKED: 'Delivered · a file was blocked',
      DELIVERY_READY: 'Delivered · buyer reviewing',
      ACCEPTED: 'Accepted',
      AUTO_ACCEPTED: 'Accepted automatically',
      ENDED_UNMET: 'Ended by the buyer · checklist not met',
      DEADLINE_PASSED: 'Ended · deadline passed',
      AGENT_DID_NOT_START: 'Ended · not claimed in time',
      RETRIES_EXHAUSTED: 'Ended · lease lost too often',
      AGENT_REPORTED_FAILURE: 'Ended · your runtime reported a failure',
      CANCELLED: 'Cancelled by the buyer',
      REPLACED_BY_CHANGE: 'Replaced by an accepted change',
      FAILED: 'Failed',
    },
  },
  ACTIONS: {
    BRIEF_DRAFT: 'Continue brief',
    OFFERS_READY: 'View offers',
    AWAITING_OFFERS: 'View request',
    READY_TO_START: 'Review next step',
    APPROVAL_NEEDED: 'Review next step',
    PERMISSION_NEEDED: 'Review permission',
    PAUSED_BY_BUYER: 'Resume or review',
    DELIVERY_READY: 'Review delivery',
    FILE_BLOCKED: 'Review delivery',
  },
  known(task) {
    return !!task?.work?.reason;
  },
  label(task, audience = 'buyer') {
    const reason = task.work.reason;
    return this.LABELS[audience]?.[reason] || this.LABELS.buyer[reason] || reason.toLowerCase().replaceAll('_', ' ');
  },
  // Dashboard grouping for the buyer: is it their move, someone else's, or finished?
  group(task) {
    const { phase, waitingOn } = task.work;
    if (waitingOn === 'buyer') return 'Needs you';
    if (waitingOn === 'nobody' || ['done', 'closed', 'ended'].includes(phase)) return 'Completed';
    return 'Under way';
  },
  tone(task) {
    const { phase, waitingOn } = task.work;
    if (phase === 'done') return 'complete';
    if (waitingOn === 'buyer' && ['on_hold', 'in_review', 'ended'].includes(phase)) return 'attention';
    if (['working', 'finding_agent', 'starting', 'scheduled'].includes(phase) && waitingOn !== 'buyer') return 'active';
    return '';
  },
  action(task) {
    if (task.work.phase === 'ended' && task.work.waitingOn === 'buyer') return 'Try another agent';
    if (this.ACTIONS[task.work.reason]) return this.ACTIONS[task.work.reason];
    return ['done', 'closed', 'ended'].includes(task.work.phase) ? 'View work' : 'View progress';
  },
};
