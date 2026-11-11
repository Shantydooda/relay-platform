'use strict';

const IDENTITY_METHODS = ['principal', 'register', 'login', 'csrf', 'logout', 'workspace', 'verify', 'reset', 'emailAction'];
const APPLICATION_METHODS = ['createOrchestration', 'approveHandover', 'completeOrchestration', 'recoverOrchestration', 'cancelScoping', 'reconcileScoping', 'supplierMessage', 'proposeChange', 'reviewChange', 'operationsBacklog', 'notifications', 'readNotifications', 'attioDeliveries', 'attioStatus', 'controlAttio', 'prepareAttio', 'sendAttio', 'driveStatus', 'beginDrive', 'completeDrive', 'drivePicker', 'importDriveFile', 'disconnectDrive', 'attachTaskContext', 'requestToolPermission', 'declineToolPermission', 'downloadAppOutput', 'workspaceApps', 'saveToolSource', 'installApp', 'controlApp', 'controlAppHost', 'reviewAppRun', 'grantTaskTool', 'revokeToolGrant', 'readAgentTool', 'reconcileApps', 'createSchedule', 'listSchedules', 'updateSchedule', 'reconcileSchedules', 'executionQueue', 'retryExecution', 'companyBudget', 'configureBudget', 'requestApproval', 'decideApproval', 'paymentRecovery', 'retryPaymentRecovery', 'receivePaymentEvent', 'reconcilePayments', 'paymentStatus', 'spendingHistory', 'onboardOperator', 'refreshOperator', 'sandboxPayment', 'reconcilePayment', 'taskPayment', 'checkoutLink', 'startQualification', 'qualificationJobs', 'submitQualification', 'assist', 'confirmScope', 'waitForScoping', 'createTask', 'mutateTask', 'detail', 'list', 'marketplace', 'features',
  'issueCredential', 'issueSupplierCredential', 'supplierEvents', 'supplierAssignment', 'supplierOpportunities', 'supplierAssignments', 'cancelExecution', 'reconcileExecutions', 'revokeCredential', 'runtimePrincipal', 'heartbeat', 'addInput',
  'authorizeLocal', 'assignments', 'claim', 'progress', 'submit', 'failExecution', 'reviewDelivery', 'download', 'previewFile', 'scanFile', 'reconcileFileScans'];

function composeIdentity(identity, application) {
  for (const method of IDENTITY_METHODS) {
    if (Object.hasOwn(application, method)) throw new TypeError(`Application cannot override identity method: ${method}`);
  }
  const store = { ...identity };
  for (const method of APPLICATION_METHODS) {
    if (application[method] !== undefined) store[method] = application[method];
  }
  return store;
}
module.exports = { composeIdentity };
