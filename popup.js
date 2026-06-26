const WA_BASE = 'https://web.whatsapp.com/';
const WA_SEND = 'https://web.whatsapp.com/send?phone=';
const RECENT_MAX = 15;

let iti             = null;   // intlTelInput instance
let validatedNumber = '';
let pendingImage    = null;   // { dataUrl, type }

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const msg = t(el.dataset.i18nPh);
    if (msg) el.placeholder = msg;
  });
  // RTL support (Arabic etc.)
  if (chrome.i18n.getMessage('@@bidi_dir') === 'rtl') {
    document.documentElement.setAttribute('dir', 'rtl');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw selected phone number string before passing to intl-tel-input.
 * - Strips surrounding whitespace and common formatting chars
 * - Converts 00-prefix to E.164 + prefix
 */
function normalizeContextNumber(raw) {
  const trimmed = raw.trim();
  // Already in E.164 — pass as-is
  if (trimmed.startsWith('+')) return trimmed;
  // Keep only digits
  const digits = trimmed.replace(/\D/g, '');
  // 00XXXX → +XXXX (international prefix without +)
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  // Otherwise return cleaned digits (iti will apply current country context)
  return digits;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getTemplates() {
  const { qmwa_templates = [] } = await chrome.storage.local.get('qmwa_templates');
  return qmwa_templates;
}

async function setTemplates(templates) {
  await chrome.storage.local.set({ qmwa_templates: templates });
}

async function getRecent() {
  const { qmwa_recent = [] } = await chrome.storage.local.get('qmwa_recent');
  return qmwa_recent;
}

async function pushRecent(number, label) {
  const recent = await getRecent();
  const deduped = recent.filter(r => r.number !== number);
  deduped.unshift({ number, label: label.trim(), sentAt: Date.now() });
  await chrome.storage.local.set({ qmwa_recent: deduped.slice(0, RECENT_MAX) });
}

// ---------------------------------------------------------------------------
// Recent numbers strip
// ---------------------------------------------------------------------------

async function loadRecent() {
  const recent = await getRecent();
  if (recent.length === 0) return;

  const chips = document.getElementById('recentChips');
  chips.innerHTML = '';

  recent.forEach(entry => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-chip';
    btn.textContent = entry.label || formatShortNumber(entry.number);
    btn.title       = [entry.label, entry.number].filter(Boolean).join('\n');
    btn.addEventListener('click', () => fillFromRecent(entry));
    chips.appendChild(btn);
  });

  document.getElementById('recentStrip').classList.remove('hidden');
}

function formatShortNumber(number) {
  return number.length > 9 ? `…${number.slice(-7)}` : number;
}

function fillFromRecent(entry) {
  iti?.setNumber(entry.number);
  document.getElementById('eLabel').value = entry.label || '';
  document.getElementById('ePhoneNumber').dispatchEvent(new Event('input'));
}

// ---------------------------------------------------------------------------
// Templates (dropdown-based)
// ---------------------------------------------------------------------------

async function renderTemplateList() {
  const templates = await getTemplates();
  const list = document.getElementById('templateList');
  list.innerHTML = '';

  if (templates.length === 0) {
    list.innerHTML = `<p class="template-empty">${t('noTemplates')}</p>`;
    return;
  }

  templates.forEach(t => {
    const item = document.createElement('div');
    item.className = 'template-item';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'template-item-name';
    nameBtn.textContent = t.name;
    nameBtn.addEventListener('click', () => {
      document.getElementById('eMessage').value = t.text;
      closeTemplateDropdown();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'template-item-del';
    delBtn.title = 'Delete template';
    delBtn.innerHTML = '×';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const all = await getTemplates();
      await setTemplates(all.filter(x => x.id !== t.id));
      await renderTemplateList();
    });

    item.appendChild(nameBtn);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

function openTemplateDropdown() {
  document.getElementById('templateDropdown').classList.remove('hidden');
}

function closeTemplateDropdown() {
  document.getElementById('templateDropdown').classList.add('hidden');
  document.getElementById('saveTemplateForm').classList.add('hidden');
  document.getElementById('eTemplateName').value = '';
}

function initTemplateEvents() {
  const triggerBtn   = document.getElementById('btnTemplates');
  const dropdown     = document.getElementById('templateDropdown');
  const saveBtn      = document.getElementById('btnSaveTemplate');
  const saveForm     = document.getElementById('saveTemplateForm');
  const nameInput    = document.getElementById('eTemplateName');
  const confirmBtn   = document.getElementById('btnConfirmSave');
  const cancelBtn    = document.getElementById('btnCancelSave');
  const messageArea  = document.getElementById('eMessage');

  // Toggle dropdown
  triggerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      closeTemplateDropdown();
    } else {
      renderTemplateList();
      openTemplateDropdown();
    }
  });

  // Click outside → close
  document.addEventListener('click', e => {
    if (!dropdown.classList.contains('hidden') &&
        !dropdown.contains(e.target) &&
        e.target !== triggerBtn) {
      closeTemplateDropdown();
    }
  });

  // Save button → reveal inline name form
  saveBtn.addEventListener('click', () => {
    if (!messageArea.value.trim()) return;
    saveForm.classList.remove('hidden');
    nameInput.focus();
  });

  // Confirm save
  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    const templates = await getTemplates();
    templates.push({ id: String(Date.now()), name, text: messageArea.value.trim() });
    await setTemplates(templates);
    await renderTemplateList();

    saveForm.classList.add('hidden');
    nameInput.value = '';
  });

  // Cancel save
  cancelBtn.addEventListener('click', () => {
    saveForm.classList.add('hidden');
    nameInput.value = '';
  });

  // Enter / Escape in name field
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });
}

// ---------------------------------------------------------------------------
// Message section toggle
// ---------------------------------------------------------------------------

function initMessageToggle() {
  const btn        = document.getElementById('btnToggleMessage');
  const label      = document.getElementById('expandLabel');
  const divMessage = document.getElementById('divMessage');
  let expanded     = false;

  btn.addEventListener('click', () => {
    expanded = !expanded;
    if (expanded) {
      divMessage.classList.remove('hidden');
      label.textContent = t('removeMessage');
      btn.classList.add('expand-btn--active');
    } else {
      divMessage.classList.add('hidden');
      label.textContent = t('addMessage');
      btn.classList.remove('expand-btn--active');
      document.getElementById('eMessage').value = '';
      document.getElementById('cbAutoSend').checked = false;
      closeTemplateDropdown();
      clearPendingImage();
    }
  });
}

// ---------------------------------------------------------------------------
// Image paste
// ---------------------------------------------------------------------------

function showImagePreview(dataUrl) {
  document.getElementById('imagePlaceholder').classList.add('hidden');
  document.getElementById('previewImg').src = dataUrl;
  document.getElementById('imagePreview').classList.remove('hidden');
}

function clearPendingImage() {
  pendingImage = null;
  document.getElementById('imagePlaceholder').classList.remove('hidden');
  document.getElementById('imagePreview').classList.add('hidden');
  document.getElementById('previewImg').src = '';
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

async function handleSend() {
  if (!validatedNumber) return;

  const message  = document.getElementById('eMessage').value;
  const label    = document.getElementById('eLabel').value.trim();
  const autoSend = document.getElementById('cbAutoSend').checked;
  let url;

  if (pendingImage) {
    const captionParam = message ? `&caption=${encodeURIComponent(message)}` : '';
    url = `${WA_SEND}${encodeURIComponent(validatedNumber)}&app_absent=0&has_image=1${autoSend ? '&auto_send=1' : ''}${captionParam}`;
  } else {
    url = `${WA_SEND}${encodeURIComponent(validatedNumber)}&text=${encodeURIComponent(message)}&app_absent=0${autoSend ? '&auto_send=1' : ''}`;
  }

  try {
    const tabs     = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(WA_BASE));
    if (existing) {
      await chrome.tabs.update(existing.id, { url, active: true });
      // Focus the window that contains the WA tab (may be a different window)
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
    await pushRecent(validatedNumber, label);
  } catch (err) {
    console.error('[Quick Messaging] Failed to open WhatsApp tab:', err);
  }

  window.close();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const phoneInput = document.getElementById('ePhoneNumber');
  const validMsg   = document.getElementById('valid-msg');
  const errorMsg   = document.getElementById('error-msg');
  const sendBtn    = document.getElementById('btnSend');

  applyI18n();
  await Promise.all([loadRecent(), renderTemplateList()]);

  // intlTelInput
  iti = window.intlTelInput(phoneInput, {
    initialCountry:   'auto',
    separateDialCode: true,
    autoPlaceholder:  'polite',
    nationalMode:     true,
    numberType:       'MOBILE',
    utilsScript:      chrome.runtime.getURL('/scripts/utils.js'),
    geoIpLookup(success) {
      const cached   = localStorage.getItem('qmwa_country');
      const cachedAt = Number(localStorage.getItem('qmwa_country_ts') || 0);
      if (cached && Date.now() - cachedAt < 7 * 24 * 3600 * 1000) {
        success(cached);
        return;
      }
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(data => {
          const c = data?.country || 'TR';
          localStorage.setItem('qmwa_country', c);
          localStorage.setItem('qmwa_country_ts', String(Date.now()));
          success(c);
        })
        .catch(() => success('TR'));
    },
  });

  // Phone validation
  function showValid()    { validMsg.classList.remove('hidden'); errorMsg.classList.add('hidden'); errorMsg.textContent = ''; }
  function showError(msg) { errorMsg.textContent = msg; errorMsg.classList.remove('hidden'); validMsg.classList.add('hidden'); }
  function clearHints()   { validMsg.classList.add('hidden'); errorMsg.classList.add('hidden'); errorMsg.textContent = ''; }

  phoneInput.addEventListener('input', () => {
    clearHints();
    if (!phoneInput.value.trim()) { sendBtn.disabled = true; validatedNumber = ''; return; }
    if (iti.isValidNumber()) {
      validatedNumber = iti.getNumber();
      sendBtn.disabled = false;
      showValid();
    } else {
      validatedNumber = '';
      sendBtn.disabled = true;
      showError(t('invalidNumber'));
    }
  });

  phoneInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !sendBtn.disabled) { e.preventDefault(); sendBtn.click(); }
  });

  // Character counter
  const charCount   = document.getElementById('charCount');
  const messageArea = document.getElementById('eMessage');
  messageArea.addEventListener('input', () => {
    const len = messageArea.value.length;
    charCount.textContent = len.toLocaleString();
    charCount.classList.toggle('char-count--warn', len > 4096);
  });

  // Drag & drop image
  const imageZone = document.getElementById('imageZone');
  imageZone.addEventListener('dragover', e => {
    e.preventDefault();
    imageZone.classList.add('image-zone--drag');
  });
  imageZone.addEventListener('dragleave', () => {
    imageZone.classList.remove('image-zone--drag');
  });
  imageZone.addEventListener('drop', e => {
    e.preventDefault();
    imageZone.classList.remove('image-zone--drag');
    if (document.getElementById('divMessage').classList.contains('hidden')) return;
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = { dataUrl: reader.result, type: file.type };
      showImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  });

  // Message section toggle
  initMessageToggle();

  // Image paste
  document.addEventListener('paste', e => {
    if (document.getElementById('divMessage').classList.contains('hidden')) return;
    const imageItem = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = { dataUrl: reader.result, type: file.type };
      showImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('clearImage').addEventListener('click', clearPendingImage);

  // Templates
  initTemplateEvents();

  // Send
  sendBtn.addEventListener('click', handleSend);
});
