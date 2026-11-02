'use strict';
function localMembershipTransport(endpoint, { fetchImpl = fetch } = {}) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/internal/access-updates' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new TypeError('Explicit loopback membership receiver required');
  return async (event, { signal } = {}) => {
    const response = await fetchImpl(url.href, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(8000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Event-Id': event.eventId,
        'X-Relay-Timestamp': event.timestamp,
        'X-Relay-Key-Id': event.keyId,
        'X-Relay-Signature': event.signature,
      },
      body: event.body,
    });
    if (!response.body) throw new Error('EMPTY_ACK');
    const reader = response.body.getReader(),
      chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 8192) throw new Error('ACK_LIMIT');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (response.status !== 200) {
      const error = new Error('ACCESS_DELIVERY_FAILED');
      if (
        [
          'ACCESS_EPOCH_REQUIRED',
          'ACCESS_REVISION_CONFLICT',
          'ACCESS_EVENT_CONFLICT',
        ].includes(result.error)
      )
        error.code = result.error;
      throw error;
    }
    return result;
  };
}
module.exports = { localMembershipTransport };
