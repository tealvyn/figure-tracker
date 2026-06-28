// js/main.js
import { state, appState, loadState, persist } from './state.js';
import * as UI from './ui.js';
import * as API from './api.js';
import { applyI18n, initLanguageControls } from './i18n.js';
import { bindStaticControls } from './events.js';
import { bindImportFileInput } from './data-portability.js';
import { getImageUrl, uploadImage } from './media-storage.js';

// Keep inline handlers from index.html working.
Object.assign(window, UI);
Object.assign(window, API);
window.debugTampermonkeyImport = UI.debugTampermonkeyImport;
window.state = state;
window.appState = appState;

API.configureApiCallbacks({
  render: UI.render,
  showRatesBadge: UI.showRatesBadge,
  updateEurPreview: UI.updateEurPreview
});

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  UI.applyUiDensity();
  bindStaticControls();
  bindImportFileInput(document.getElementById('importFile'), {
    state,
    appState,
    persist,
    render: UI.render,
    createLocalBackup: UI.createLocalBackup,
    toast: UI.toast,
    refreshRates: () => { state.ratesAt ? UI.showRatesBadge() : API.fetchRates(); }
  });
  initLanguageControls();
  UI.bindItemDraftAutosave();
  API.fetchRates();
  UI.render();
  UI.checkReleaseReminders();
  UI.initParticles();

  setInterval(() => {
    UI.checkReleaseReminders();
    UI.updateBanner(true);
  }, 10000);
});

function appendImageUrl(existingValue, url) {
  const existingLinks = (existingValue || '').trim();
  if (!existingLinks) return url;
  return existingLinks.endsWith(',') ? `${existingLinks} ${url}` : `${existingLinks}, ${url}`;
}

// Media upload binding: network/storage logic lives in media-storage.js.
document.getElementById('fImgFile')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  const imgInput = document.getElementById('fImg');
  if (!imgInput) {
    event.target.value = '';
    return;
  }

  const originalValue = imgInput.value;
  const originalPlaceholder = imgInput.placeholder;

  try {
    imgInput.value = state.settings?.tgBotToken && state.settings?.tgChatId
      ? 'Отправка файла в Telegram...'
      : 'Добавление файла на Google Диск...';
    imgInput.disabled = true;

    const media = await uploadImage(file, state.settings, {
      onProgress(message) {
        imgInput.value = message;
      }
    });

    const finalImgUrl = getImageUrl(media);
    imgInput.value = appendImageUrl(originalValue, finalImgUrl);
    imgInput.dispatchEvent(new Event('input', { bubbles: true }));
    imgInput.dispatchEvent(new Event('change', { bubbles: true }));
    UI.toast(media.provider === 'telegram' ? 'Файл добавлен в Telegram!' : 'Файл добавлен в галерею!');
  } catch (error) {
    imgInput.value = originalValue;
    alert('Ошибка загрузки файла: ' + (error?.message || 'Не удалось загрузить файл'));
  } finally {
    imgInput.placeholder = originalPlaceholder;
    imgInput.disabled = false;
    event.target.value = '';
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

window.addEventListener('fct:language-change', () => {
  UI.render();
  UI.renderWishlist();
  UI.renderGallery();
  UI.renderShelf();
  applyI18n();
});
