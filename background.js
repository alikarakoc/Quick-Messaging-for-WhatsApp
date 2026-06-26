const WA_BASE = 'https://web.whatsapp.com/';
const WA_SEND = 'https://web.whatsapp.com/send?phone=';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'qmwa-send',
    title: chrome.i18n.getMessage('contextMenuTitle'),
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'qmwa-send') return;

  const number = normalizeNumber(info.selectionText?.trim() || '');
  if (!number) return;

  const url = `${WA_SEND}${encodeURIComponent(number)}&app_absent=0`;

  try {
    const tabs     = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(WA_BASE));
    if (existing) {
      await chrome.tabs.update(existing.id, { url, active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
  } catch (err) {
    console.error('[Quick Messaging] Context menu send failed:', err);
  }
});

function normalizeNumber(raw) {
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // 0090... or 00... international prefix → E.164
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  return digits;
}
