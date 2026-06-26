const WA_BASE = 'https://web.whatsapp.com/';
const WA_SEND = 'https://web.whatsapp.com/send?phone=';

let validatedNumber = '';
let pendingImage = null; // { dataUrl: string, type: string }

document.addEventListener('DOMContentLoaded', () => {
  const phoneInput = document.getElementById('ePhoneNumber');
  const validMsg   = document.getElementById('valid-msg');
  const errorMsg   = document.getElementById('error-msg');
  const sendBtn    = document.getElementById('btnSend');

  // --- Phone input ---
  const iti = window.intlTelInput(phoneInput, {
    initialCountry:   'auto',
    separateDialCode: true,
    autoPlaceholder:  'polite',
    nationalMode:     true,
    numberType:       'MOBILE',
    utilsScript:      chrome.runtime.getURL('/scripts/utils.js'),
    geoIpLookup(success) {
      // Check localStorage cache first (valid for 7 days) — avoids a network
      // round-trip on every popup open.
      const cached = localStorage.getItem('qmwa_country');
      const cachedAt = Number(localStorage.getItem('qmwa_country_ts') || 0);
      if (cached && Date.now() - cachedAt < 7 * 24 * 3600 * 1000) {
        success(cached);
        return;
      }
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(data => {
          const country = data?.country || 'TR';
          localStorage.setItem('qmwa_country', country);
          localStorage.setItem('qmwa_country_ts', String(Date.now()));
          success(country);
        })
        .catch(() => success('TR'));
    },
  });

  function showValid()      { validMsg.classList.remove('hidden'); errorMsg.classList.add('hidden'); errorMsg.textContent = ''; }
  function showError(msg)   { errorMsg.textContent = msg; errorMsg.classList.remove('hidden'); validMsg.classList.add('hidden'); }
  function clearHints()     { validMsg.classList.add('hidden'); errorMsg.classList.add('hidden'); errorMsg.textContent = ''; }

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
      showError('Invalid phone number.');
    }
  });

  phoneInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !sendBtn.disabled) { e.preventDefault(); sendBtn.click(); }
  });

  // --- Message section toggle ---
  document.getElementById('cbMessageStatus').addEventListener('change', e => {
    const div = document.getElementById('divMessage');
    if (e.target.checked) {
      div.classList.remove('hidden');
    } else {
      div.classList.add('hidden');
      document.getElementById('eMessage').value = '';
      clearPendingImage();
    }
  });

  // --- Image paste ---
  document.addEventListener('paste', (e) => {
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

  // --- Send ---
  sendBtn.addEventListener('click', handleSend);
});

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

async function handleSend() {
  if (!validatedNumber) return;

  const message  = document.getElementById('eMessage').value;
  const autoSend = document.getElementById('cbAutoSend').checked;
  let url;

  if (pendingImage) {
    // The image is still in the user's clipboard (from their Cmd+V).
    // Pass the caption via URL — WhatsApp ignores unknown params.
    const captionParam = message ? `&caption=${encodeURIComponent(message)}` : '';
    url = `${WA_SEND}${encodeURIComponent(validatedNumber)}&app_absent=0&has_image=1${autoSend ? '&auto_send=1' : ''}${captionParam}`;
  } else {
    url = `${WA_SEND}${encodeURIComponent(validatedNumber)}&text=${encodeURIComponent(message)}&app_absent=0${autoSend ? '&auto_send=1' : ''}`;
  }

  try {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(WA_BASE));
    if (existing) {
      await chrome.tabs.update(existing.id, { url, active: true });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
  } catch (err) {
    console.error('[Quick Messaging] Failed to open WhatsApp tab:', err);
  }

  window.close();
}
