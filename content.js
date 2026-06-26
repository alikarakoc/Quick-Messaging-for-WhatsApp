/**
 * content.js — WhatsApp Web content script
 * Runs only on https://web.whatsapp.com/* (manifest.json)
 */

const params   = new URLSearchParams(window.location.search);
const hasImage = params.get('has_image') === '1';
const autoSend = params.get('auto_send') === '1';

if (!params.has('phone')) {
  // Not a send URL — do nothing
} else if (hasImage) {
  handleImageFlow();
} else if (autoSend) {
  handleTextAutoSend();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitFor(fn, timeout = 15000) {
  return new Promise(resolve => {
    const start = Date.now();
    const id = setInterval(() => {
      const result = fn();
      if (result || Date.now() - start >= timeout) {
        clearInterval(id);
        resolve(result || null);
      }
    }, 200); // poll every 200ms for faster detection
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getMainChatInput() {
  return (
    document.querySelector('div[data-tab="10"][contenteditable="true"]') ||
    document.querySelector('footer div[contenteditable="true"]')         ||
    document.querySelector('div[contenteditable="true"].copyable-text')
  );
}

/** Send button for the regular chat (text-only flow). */
function getSendButton() {
  return (
    document.querySelector('span[data-icon="send"]')?.closest('button') ||
    document.querySelector('button[data-tab="11"]')                      ||
    document.querySelector('[aria-label="Send"]')                        ||
    document.querySelector('[aria-label="Gönder"]')                      ||
    document.querySelector('button.epia9gcq')
  );
}

/**
 * Send button for the image preview modal.
 * Walk UP from the caption field — button[data-tab="11"] is the mic button
 * in the preview context, so we avoid global queries.
 */
function getImagePreviewSendButton(captionField) {
  let el = captionField?.parentElement;
  for (let depth = 0; depth < 12; depth++) {
    if (!el || el === document.body) break;
    const btn =
      el.querySelector('span[data-icon="send"]')?.closest('button') ||
      el.querySelector('[aria-label="Send"]')                        ||
      el.querySelector('[aria-label="Gönder"]');
    if (btn) return btn;
    el = el.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flow 1: Text-only auto-send
// ---------------------------------------------------------------------------

async function handleTextAutoSend() {
  const msgBox = await waitFor(() => {
    const el = getMainChatInput();
    return (el && el.textContent.trim().length > 0) ? el : null;
  });
  if (!msgBox) return;

  const sendBtn = getSendButton();
  if (!sendBtn) return;

  await sleep(200);
  sendBtn.click();
}

// ---------------------------------------------------------------------------
// Flow 2: Image (+ optional caption) — uses real clipboard via execCommand
// ---------------------------------------------------------------------------

async function handleImageFlow() {
  const caption = params.get('caption') ?? '';

  // 1. Wait for the chat input and focus it
  const chatInput = await waitFor(getMainChatInput);
  if (!chatInput) return;

  chatInput.focus();
  await sleep(100);

  // 2. Paste image from real clipboard (user's Cmd+V image is still in clipboard)
  document.execCommand('paste');

  if (!autoSend) return;

  // 3. Wait for the image preview caption field to appear — no fixed sleep,
  //    we react the moment WhatsApp auto-focuses it.
  const captionField = await waitFor(() => {
    const active = document.activeElement;
    if (active?.isContentEditable && active !== chatInput) return active;
    const all = [...document.querySelectorAll('[contenteditable="true"]')];
    return all.find(el => el !== chatInput) ?? null;
  }, 10000);

  if (!captionField) return;

  // 4. Type caption
  if (caption) {
    captionField.focus();
    await sleep(100);
    document.execCommand('insertText', false, caption);
    await sleep(300);
  }

  // 5. Send — scope button search to caption field's container to avoid
  //    accidentally clicking the mic button (data-tab="11" in preview context).
  const previewSend = getImagePreviewSendButton(captionField);
  if (previewSend) {
    previewSend.click();
  } else {
    // Fallback: Enter key (WhatsApp sends image on Enter in caption field)
    captionField.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    }));
  }
}
