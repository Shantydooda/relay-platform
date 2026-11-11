'use strict';
const { createHmac, timingSafeEqual, createHash } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const TYPES = new Set(['account.updated', 'checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'refund.created', 'refund.updated', 'refund.failed', 'payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled']);

function createWebhookVerifier({ secret, now = Date.now }) {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9_]{16,}$/.test(secret)) throw new Error('A webhook signing secret is required.');
  return (bytes, signature) => {
    if (!Buffer.isBuffer(bytes) || bytes.length > 262144) fail(413, 'BODY_TOO_LARGE', 'Webhook exceeds the size limit.');
    if (typeof signature !== 'string' || signature.length > 4096) fail(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    const parts = signature.split(',').map(p => p.trim().split('='));
    const timestamps = parts.filter(([key]) => key === 't');
    const signatures = parts.filter(([key,value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value || ''));
    if (timestamps.length !== 1 || !/^\d{10,12}$/.test(timestamps[0][1]) || !signatures.length) fail(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    const timestamp = timestamps[0][1];
    if (Math.abs(now() / 1000 - Number(timestamp)) > 300) fail(400, 'STALE_SIGNATURE', 'Webhook signature is outside the accepted time window.');
    const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(bytes).digest();
    if (!signatures.some(([,value]) => timingSafeEqual(digest, Buffer.from(value, 'hex')))) fail(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    let event;
    try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail(400, 'INVALID_EVENT', 'Webhook must be valid JSON.'); }
    const validId = value => typeof value === 'string' && /^[a-z]+_[A-Za-z0-9_]{1,180}$/.test(value);
    if (event?.object !== 'event' || !validId(event.id) || !event.id.startsWith('evt_') || typeof event.type !== 'string' || event.type.length > 100) fail(400, 'INVALID_EVENT', 'Invalid event envelope.');
    if (event.livemode !== false || event.data?.object?.livemode === true) fail(400, 'LIVE_MODE_FORBIDDEN', 'Only sandbox events are accepted.');
    if (event.account !== undefined && (!validId(event.account) || !event.account.startsWith('acct_'))) fail(400, 'INVALID_EVENT', 'Invalid connected account.');
    const supported = TYPES.has(event.type), objectId = event.data?.object?.id;
    if (supported && !validId(objectId)) fail(400, 'INVALID_EVENT', 'Missing provider object reference.');
    // Store only routing metadata, never raw events, identity details or bank data.
    const value = { id: event.id, type: event.type, account: event.account || null, objectId: supported ? objectId : null, supported };
    return { ...value, fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
  };
}
module.exports = { createWebhookVerifier };
