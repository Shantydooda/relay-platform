'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');

// No configurable API host or live credentials: this adapter can only talk to
// Stripe with a sandbox key. Never include provider errors or keys in UI logs.
function createStripeSandbox({ secretKey, origin, apiVersion = '2025-02-24.acacia', fetchImpl = fetch }) {
  if (typeof secretKey !== 'string' || !/^sk_test_[A-Za-z0-9]+$/.test(secretKey)) throw new Error('A Stripe sandbox secret key is required; live keys are forbidden.');
  const local = new URL(origin);
  if (local.origin !== origin || local.protocol !== 'http:' || local.hostname !== '127.0.0.1') throw new Error('Sandbox redirects must use localhost.');
  async function request(path, fields, key, account) {
    if (!/^\/[a-z0-9_/?=&\[\]-]+$/i.test(path)) throw new Error('Invalid provider path');
    const response = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method: fields ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': apiVersion,
        ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key } : {}),
        ...(account ? { 'Stripe-Account': account } : {}) },
      ...(fields ? { body: new URLSearchParams(fields).toString() } : {})
    });
    if (!response.ok) fail(502, 'SANDBOX_PROVIDER_ERROR', 'Stripe sandbox could not confirm this operation. Retry the same operation; do not create a replacement.');
    const value = await response.json();
    if (value.livemode === true) fail(502, 'LIVE_MODE_FORBIDDEN', 'Live-mode provider data is forbidden.');
    return value;
  }
  function sandbox(value) {
    if (value.livemode !== false) fail(502, 'SANDBOX_REQUIRED', 'Expected an explicitly sandbox provider object.');
    return value;
  }
  function providerUrl(value, host) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) fail(502, 'PROVIDER_URL_INVALID', 'Provider returned an unexpected redirect.');
    return url.href;
  }
  const id = value => {
    if (!/^[a-z]+_[A-Za-z0-9_]+$/.test(value || '')) fail(502, 'PROVIDER_ID_INVALID', 'Invalid sandbox object reference.');
    return value;
  };
  return {
    kind: 'stripe-sandbox',
    async createOperator(operation) {
      const account = await request('/accounts', { type: 'express', country: operation.country,
        'capabilities[transfers][requested]': 'true', 'settings[payouts][schedule][interval]': 'manual',
        'metadata[relay_operator]': operation.ownerId }, operation.id);
      return { accountId: id(account.id) };
    },
    async onboarding(accountId, key) {
      const link = await request('/account_links', { account: id(accountId), type: 'account_onboarding',
        return_url: `${origin}/#operator-return`, refresh_url: `${origin}/#operator-return` }, key);
      return { url: providerUrl(link.url, 'connect.stripe.com') };
    },
    async operator(accountId) {
      const a = await request(`/accounts/${id(accountId)}`);
      // Accounts v1 does not have a livemode field. All requests use sk_test_.
      const requirements = a.requirements || {};
      return { accountId: id(a.id), ready: a.details_submitted === true && a.payouts_enabled === true
        && a.capabilities?.transfers === 'active' && !requirements.disabled_reason
        && (requirements.currently_due || []).length === 0 && (requirements.pending_verification || []).length === 0,
        payoutsEnabled: a.payouts_enabled === true, manualPayouts: a.settings?.payouts?.schedule?.interval === 'manual',
        requirements: (requirements.currently_due || []).slice(0, 50), pending: (requirements.pending_verification || []).length > 0 };
    },
    async checkout(operation) {
      const s = sandbox(await request('/checkout/sessions', { mode: 'payment', 'payment_method_types[0]': 'card',
        'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(operation.amountMinor),
        'line_items[0][price_data][product_data][name]': 'Relay sandbox task funding', 'line_items[0][quantity]': '1',
        client_reference_id: operation.id, 'metadata[relay_operation]': operation.id,
        'payment_intent_data[transfer_group]': operation.id,
        success_url: `${origin}/#task=${operation.taskId}`, cancel_url: `${origin}/#task=${operation.taskId}`,
        expires_at: String(Math.floor(operation.createdAt / 1000) + 3600) }, operation.id));
      return { sessionId: id(s.id), url: providerUrl(s.url, 'checkout.stripe.com') };
    },
    async funding(payment) {
      const s = sandbox(await request(`/checkout/sessions/${id(payment.sessionId)}?expand[]=payment_intent`));
      const intent = s.payment_intent;
      if (s.amount_total !== payment.amountMinor || s.currency !== 'usd' || s.client_reference_id !== payment.operationId) fail(502, 'FUNDING_MISMATCH', 'Sandbox funding does not match the agreed amount.');
      if (s.payment_status !== 'paid') return { status: s.status === 'expired' ? 'expired' : 'awaiting_payment' };
      sandbox(intent);
      if (intent.status !== 'succeeded' || intent.amount_received !== payment.amountMinor || intent.currency !== 'usd' || typeof intent.latest_charge !== 'string') fail(502, 'FUNDING_MISMATCH', 'Sandbox payment is not fully confirmed.');
      return { status: 'funded', intentId: id(intent.id), chargeId: id(intent.latest_charge) };
    },
    async refund(operation) {
      const r = await request('/refunds', { payment_intent: id(operation.intentId), amount: String(operation.amountMinor), 'metadata[relay_operation]': operation.id }, operation.id);
      if (r.amount !== operation.amountMinor || r.currency !== 'usd' || r.payment_intent !== operation.intentId) fail(502, 'REFUND_MISMATCH', 'Refund does not match funding.');
      return { refundId: id(r.id), status: r.status };
    },
    async refundStatus(payment) {
      // Refund objects have no livemode attribute; the test credential and matched intent bind them.
      const r = await request(`/refunds/${id(payment.refundId)}`);
      if (r.amount !== payment.amountMinor || r.currency !== 'usd' || r.payment_intent !== payment.intentId) fail(502, 'REFUND_MISMATCH', 'Refund does not match funding.');
      return { status: r.status };
    },
    async transfer(operation) {
      const t = sandbox(await request('/transfers', { amount: String(operation.amountMinor), currency: 'usd',
        destination: id(operation.accountId), source_transaction: id(operation.chargeId), 'metadata[relay_operation]': operation.id }, operation.id));
      if (t.amount !== operation.amountMinor || t.currency !== 'usd' || t.destination !== operation.accountId || t.source_transaction !== operation.chargeId) fail(502, 'TRANSFER_MISMATCH', 'Transfer does not match the settlement.');
      return { transferId: id(t.id) };
    },
    async payout(operation) {
      const p = sandbox(await request('/payouts', { amount: String(operation.amountMinor), currency: 'usd', 'metadata[relay_operation]': operation.id }, operation.id, id(operation.accountId)));
      if (p.amount !== operation.amountMinor || p.currency !== 'usd') fail(502, 'PAYOUT_MISMATCH', 'Payout does not match the settlement.');
      return { payoutId: id(p.id), status: p.status };
    },
    async payoutStatus(payment) {
      const p = sandbox(await request(`/payouts/${id(payment.payoutId)}`, null, null, id(payment.accountId)));
      if (p.amount !== payment.amountMinor || p.currency !== 'usd') fail(502, 'PAYOUT_MISMATCH', 'Payout does not match the settlement.');
      return { status: p.status };
    }
  };
}
module.exports = { createStripeSandbox };
