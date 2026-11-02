'use strict';
const statusNode = document.querySelector('#drive-status');
const pickButton = document.querySelector('#pick');
document.querySelector('#source-mode').addEventListener('change', (event) => {
  document.querySelector('#live-consent-field').hidden =
    event.target.value !== 'live';
});
const params = new URLSearchParams(location.search);
const callback = {
  state: params.get('state'),
  code: params.get('code'),
  error: params.get('error'),
};
// Remove authorization codes immediately; never persist them or log provider errors.
history.replaceState(null, '', location.pathname);
let account, tenantId;
async function post(action, body) {
  const response = await fetch(`/api/drive/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': account.csrf,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || 'Drive request failed.');
  return result;
}
function loadPicker() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () =>
      gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Google Picker could not load.')),
        timeout: 10000,
        ontimeout: () => reject(new Error('Google Picker timed out.')),
      });
    script.onerror = () => reject(new Error('Google Picker could not load.'));
    document.head.append(script);
  });
}
async function initialize() {
  tenantId = sessionStorage.getItem('relay-drive-tenant');
  const response = await fetch('/api/me');
  if (!response.ok)
    throw new Error(
      'Log in to Relay again, then restart the Drive connection.',
    );
  account = await response.json();
  if (
    !tenantId ||
    !account.memberships.some(
      (member) => member.id === tenantId && member.role === 'owner',
    )
  )
    throw new Error('Return to your workspace to connect Drive.');
  if (callback.error)
    throw new Error('Connection cancelled. No new access was saved.');
  if (callback.code)
    await post('complete', {
      tenantId,
      state: callback.state,
      code: callback.code,
    });
  const state = await fetch(
    `/api/drive/status?tenantId=${encodeURIComponent(tenantId)}`,
  ).then((response) => response.json());
  if (!state.connected)
    throw new Error(
      'Drive is not connected. Return to Connected tools to start.',
    );
  statusNode.textContent = 'Drive connected. Choose the file you want to use.';
  await loadPicker();
  pickButton.hidden = false;
}
pickButton.addEventListener('click', async () => {
  pickButton.disabled = true;
  try {
    const mode = document.querySelector('#source-mode').value;
    const consent = document.querySelector('#live-consent').checked;
    if (mode === 'live' && !consent)
      throw new Error('Confirm repeat reads before linking a live source.');
    const config = await post('picker', { tenantId });
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(false)
      .setMimeTypes(
        'application/vnd.google-apps.document,text/plain,text/csv,application/json',
      );
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.projectNumber)
      .setOrigin(config.origin)
      .setCallback(async (data) => {
        if (data.action !== google.picker.Action.PICKED) return;
        pickButton.disabled = true;
        statusNode.textContent = 'Importing your selected file…';
        try {
          await post('import', {
            tenantId,
            fileId: data.docs[0].id,
            mode,
            ...(mode === 'live'
              ? { consent: 'read-latest-selected-file' }
              : {}),
          });
          statusNode.textContent =
            mode === 'live'
              ? 'Live source linked. Choose it with @; authorized reads will check the latest file. Agents still need read permission.'
              : 'Snapshot saved. Choose it with @; agents still need read permission.';
        } catch (error) {
          statusNode.textContent = error.message;
        } finally {
          pickButton.disabled = false;
        }
      })
      .build();
    picker.setVisible(true);
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    pickButton.disabled = false;
  }
});
initialize().catch((error) => {
  statusNode.textContent = error.message;
});
