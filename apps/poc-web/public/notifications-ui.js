'use strict';
const RelayNotifications = {
  view() {
    if (!state.features?.notifications || !state.account) return '';
    const feed = state.notifications || { items: [], unread: 0 };
    return `<details class="notification-menu" ${state.notificationsOpen ? 'open' : ''}><summary aria-label="Notifications, ${feed.unread} unread"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-label">Notifications</span>${feed.unread ? `<b class="notification-count">${feed.unread}</b>` : ''}</summary><section class="notification-panel" aria-label="Recent notifications"><header><div><h2>Notifications</h2><small>Latest 100 updates · all your workspaces</small></div><button data-action="notification-close" aria-label="Close notifications">×</button></header><div class="notification-toolbar"><button data-action="notification-refresh">Refresh</button><button data-action="notification-read-all" ${feed.unread ? '' : 'disabled'}>Mark all read</button></div>${state.notificationError ? `<p role="alert">${escape(state.notificationError)}</p>` : ''}<div class="notification-list">${feed.items.length ? feed.items.map((item) => `<article class="notification-item ${item.read ? '' : 'unread'}"><button data-action="notification-open" data-id="${escape(item.id)}"><strong>${escape(item.title)}</strong><span>${escape(item.taskTitle)}</span><small>${escape(date(item.createdAt))} · ${item.side === 'builder' ? 'Builder' : 'Buyer'}${item.read ? '' : ' · Unread'}</small></button>${!item.read ? `<button class="notification-read" data-action="notification-read" data-id="${escape(item.id)}" aria-label="Mark ${escape(item.title)} as read">✓</button>` : ''}</article>`).join('') : state.notificationError ? '<div class="notification-empty"><p>Use Refresh to try loading your updates again.</p></div>' : '<div class="notification-empty"><h3>You’re all caught up.</h3><p>Offers, permissions, approvals and delivery updates will appear here.</p></div>'}</div></section></details>`;
  },
  async load(force = false) {
    if (!state.features?.notifications || !state.account) return;
    const userId = state.account.user.id;
    if (state.notificationUserId !== userId) state.notifications = null;
    if (
      !force &&
      state.notificationUserId === userId &&
      Date.now() - (state.notificationsAt || 0) < 10000
    )
      return;
    const feed = await api('/api/notifications');
    if (state.account?.user.id !== userId) return;
    state.notifications = feed;
    state.notificationUserId = userId;
    state.notificationsAt = Date.now();
    state.notificationError = '';
  },
  async click(button) {
    const action = button.dataset.action;
    if (action === 'notification-close') {
      state.notificationsOpen = false;
      render();
      root.querySelector('.notification-menu summary')?.focus();
      return;
    }
    if (action === 'notification-refresh') {
      await this.load(true);
      render();
      return;
    }
    const feed = state.notifications || { items: [] };
    const item = feed.items.find((item) => item.id === button.dataset.id);
    const ids =
      action === 'notification-read-all'
        ? [
            ...root.querySelectorAll(
              '.notification-item.unread [data-action="notification-open"]',
            ),
          ].map((button) => button.dataset.id)
        : item
          ? [item.id]
          : [];
    if (!ids.length) return;
    await api('/api/notifications/read', { method: 'POST', body: { ids } });
    await this.load(true);
    if (action === 'notification-open' && item) {
      state.notificationsOpen = false;
      state.recoveryOpen = false;
      state.editing = false;
      state.reviewChatRequest = false;
      if (state.account.user.workspace !== item.side)
        await api('/api/me/workspace', {
          method: 'PATCH',
          body: { workspace: item.side },
        });
      state.tenantId = item.tenantId;
      state.setupAgentId = null;
      state.addingAgent = false;
      state.reviewOffer = null;
      if (item.side === 'builder') {
        state.builderTab = 'work';
        await refresh(null);
        location.hash = '';
      } else if (item.destination === 'business') {
        state.buyerTab = 'business';
        await refresh(null);
        location.hash = 'business';
      } else {
        await refresh(item.taskId);
        state.buyerTab = 'tasks';
        location.hash = `task=${item.taskId}`;
      }
    }
    render();
    if (action === 'notification-open' && item?.side === 'builder') {
      const target = [
        ...root.querySelectorAll('[data-notification-task]'),
      ].find((node) => node.dataset.notificationTask === item.taskId);
      if (target) {
        target.tabIndex = -1;
        target.focus();
        target.scrollIntoView({ block: 'center' });
      }
    }
  },
};
