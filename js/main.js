// js/main.js
import { state, appState, loadState, persist } from './state.js';
import * as UI from './ui.js';
import * as API from './api.js';
import { applyI18n, initLanguageControls } from './i18n.js';
import { bindStaticControls } from './events.js';
import { bindImportFileInput } from './data-portability.js';
import { getImageUrl, uploadMediaBatch } from './media-storage.js';

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
  bindFigureMediaUpload();
  bindWishMediaUpload();
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
  UI.render();
  UI.initPreviewVideoControlsObserver();
  UI.checkReleaseReminders();
  UI.initParticles();
  updateBanner(true);
  requestAnimationFrame(() => {
    API.fetchRates?.().catch(error => console.warn('[startup fetchRates]', error));
  });
  setInterval(() => {
    UI.checkReleaseReminders();
    UI.updateBanner(true);
  }, 30000);
});

function appendImageUrl(existingValue, url) {
  const existingLinks = (existingValue || '').trim();
  if (!url) return existingLinks;
  if (!existingLinks) return url;
  return existingLinks.endsWith(',') ? `${existingLinks} ${url}` : `${existingLinks}, ${url}`;
}

// Media upload binding: network/storage logic lives in media-storage.js.
async function handleFigureMediaUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const imgInput = document.getElementById('fImg');
  if (!imgInput) {
    event.target.value = '';
    return;
  }

  const originalValue = imgInput.value;
  const originalPlaceholder = imgInput.placeholder;
  let currentValue = originalValue;
  let uploadedCount = 0;

  try {
    imgInput.value = state.settings?.tgBotToken && state.settings?.tgChatId
      ? 'Отправка файлов в Telegram...'
      : 'Добавление файлов на Google Диск...';
    imgInput.disabled = true;

    const mediaList = await uploadMediaBatch(files, state.settings, {
      onProgress(message) {
        imgInput.value = message;
      },
      onFileUploaded(media, index, total) {
        const finalImgUrl = getImageUrl(media);
        currentValue = appendImageUrl(currentValue, finalImgUrl);
        imgInput.value = currentValue;
        appState.pendingUploadedMedia = appState.pendingUploadedMedia || [];
        appState.pendingUploadedMedia.push(media);
        uploadedCount = index + 1;
        UI.toast(`${uploadedCount}/${total}: файл добавлен`);
      }
    });

    imgInput.value = currentValue;
    imgInput.dispatchEvent(new Event('input', { bubbles: true }));
    imgInput.dispatchEvent(new Event('change', { bubbles: true }));
    UI.toast(mediaList.length > 1 ? 'Файлы добавлены в галерею!' : 'Файл добавлен в галерею!');
  } catch (error) {
    imgInput.value = uploadedCount > 0 ? currentValue : originalValue;
    alert('Ошибка загрузки файла: ' + (error?.message || 'Не удалось загрузить файл'));
  } finally {
    imgInput.placeholder = originalPlaceholder;
    imgInput.disabled = false;
    event.target.value = '';
  }
}

async function handleWishMediaUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const imgInput = document.getElementById('wImg');
  if (!imgInput) {
    event.target.value = '';
    return;
  }

  const originalValue = imgInput.value;
  const originalPlaceholder = imgInput.placeholder;
  let currentValue = originalValue;
  let uploadedCount = 0;

  try {
    imgInput.value = state.settings?.tgBotToken && state.settings?.tgChatId
      ? 'Uploading wishlist media to Telegram...'
      : 'Uploading wishlist media...';
    imgInput.disabled = true;

    const mediaList = await uploadMediaBatch(files, state.settings, {
      onProgress(message) {
        imgInput.value = message;
      },
      onFileUploaded(media, index, total) {
        const finalUrl = getImageUrl(media);
        currentValue = appendImageUrl(currentValue, finalUrl);
        imgInput.value = currentValue;
        appState.pendingWishUploadedMedia = appState.pendingWishUploadedMedia || [];
        appState.pendingWishUploadedMedia.push(media);
        uploadedCount = index + 1;
        UI.toast(`${uploadedCount}/${total}: wishlist media added`);
      }
    });

    imgInput.value = currentValue;
    imgInput.dispatchEvent(new Event('input', { bubbles: true }));
    imgInput.dispatchEvent(new Event('change', { bubbles: true }));
    UI.toast(mediaList.length > 1 ? 'Wishlist media added' : 'Wishlist media added');
  } catch (error) {
    imgInput.value = uploadedCount > 0 ? currentValue : originalValue;
    alert('Wishlist media upload failed: ' + (error?.message || 'upload failed'));
  } finally {
    imgInput.placeholder = originalPlaceholder;
    imgInput.disabled = false;
    event.target.value = '';
  }
}

//import { refreshAllTelegramMedia } from './media-storage.js';

// async function refreshTelegramOnStartup() {
//   const token =
//     state?.settings?.telegramBotToken ||
//     state?.settings?.tgBotToken ||
//     state?.settings?.botToken ||
//     '';

//   if (!token) {
//     console.warn('[Telegram] token not found, media refresh skipped');
//     return;
//   }

//   const result = await refreshAllTelegramMedia(state, token);

//   if (result.refreshed > 0) {
//     console.log('[Telegram] media refreshed:', result);

//     if (typeof saveState === 'function') {
//       saveState();
//     }

//     if (typeof render === 'function') {
//       render();
//     }
//   }
// }

function bindFigureMediaUpload() {
  const input = document.getElementById('fImgFile');
  if (!input || input.dataset.mediaUploadBound === '1') return;
  input.dataset.mediaUploadBound = '1';
  input.multiple = true;
  input.addEventListener('change', handleFigureMediaUpload);
}

function bindWishMediaUpload() {
  const input = document.getElementById('wImgFile');
  if (!input || input.dataset.mediaUploadBound === '1') return;
  input.dataset.mediaUploadBound = '1';
  input.multiple = true;
  input.addEventListener('change', handleWishMediaUpload);
}

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
