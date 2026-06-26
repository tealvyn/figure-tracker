// js/main.js
import { state, appState, loadState, persist, toEur } from './state.js';
import * as UI from './ui.js';
import * as API from './api.js';
import { getOrders } from './ui.js';

const debounce = (fn, delay = 120) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

// Выкидываем все функции в глобальную область, чтобы HTML не сломался
Object.assign(window, UI);
Object.assign(window, API);
window.state = state;
window.appState = appState;

// Глобальная навигация и кнопки в шапке
function bindStaticControls() {
  document.getElementById('mainTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.nav-tab')?.dataset.tab;
    if (!tab) return;
    UI.switchTab(tab);
  });

  document.getElementById('addItemBtn')?.addEventListener('click', () => {
    UI.clearForm();
    UI.openForm();
  });

  document.getElementById('importBtn')?.addEventListener('click', () => {
    document.getElementById('importFile')?.click();
  });

  document.getElementById('exportBtn')?.addEventListener('click', UI.exportData);
  document.getElementById('backupBtn')?.addEventListener('click', () => API.backupToDrive(false));

  document.getElementById('filterToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    UI.toggleFilters();
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (e.target.closest('#filterToggle') || e.target.closest('#sidebarFilterBody')) return;
    UI.closeFilters();
  });
}



document.addEventListener('DOMContentLoaded', () => {
  loadState();
  bindStaticControls();
  UI.bindItemDraftAutosave();
  API.fetchRates();
  UI.render();
  UI.checkReleaseReminders();
  UI.initParticles();

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => UI.syncMobileCollectionView());
  });
  
  setInterval(() => {
    UI.checkReleaseReminders();
    UI.updateBanner(true);
  }, 10000);
});

// Навешиваем слушатели
document.getElementById('wishSearch')?.addEventListener('input', UI.renderWishlist);
document.getElementById('wishPriorityFilter')?.addEventListener('change', UI.renderWishlist);
document.getElementById('shelfSearch')?.addEventListener('input', UI.renderShelf);
document.getElementById('shelfSort')?.addEventListener('change', UI.renderShelf);

document.getElementById('fOrder')?.addEventListener('input', function () {
  const val = this.value.trim();
  const found = getOrders().find(o => o.orderNumber === val);
  if (found) {
    document.getElementById('fOrderName').value = found.orderName;
    document.getElementById('fStore').value = found.store || '';
    document.getElementById('fRegion').value = found.items[0]?.region || 'Япония';
  }
});

document.getElementById('importFile')?.addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.items)) throw new Error();
      if (!confirm(`Импортировать ${parsed.items.length} записей? Текущие данные будут заменены.`)) return;
      UI.createLocalBackup('before-import', true);
      Object.assign(state, parsed); appState.selectedOrder = null; persist(); UI.render();
      state.ratesAt ? UI.showRatesBadge() : API.fetchRates(); UI.toast('Импорт успешен');
    } catch { alert('Неверный формат файла'); }
  };
  reader.readAsText(file); e.target.value = '';
});

document.getElementById('fTags')?.addEventListener('input', UI.renderTagSuggestions);
document.getElementById('sortSelect')?.addEventListener('change', () => { UI.render(); UI.closeFilters(); });
document.getElementById('filterStore')?.addEventListener('change', () => { UI.render(); UI.closeFilters(); });
document.getElementById('filterRegion')?.addEventListener('change', () => { UI.render(); UI.closeFilters(); });

document.getElementById('searchInput')?.addEventListener('input', debounce(() => {
  appState.selectedOrder = null;
  UI.render();
  UI.updateSuggestions();
}, 120));

document.getElementById('searchInput')?.addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('searchSuggestions')?.classList.remove('visible'); }, 150);
});

document.getElementById('statusFilters')?.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  const val = chip.dataset.filter;
  appState.filterStatus = val === '' ? null : val;
  UI.render();
  UI.closeFilters();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { UI.closeForm(); UI.closeFilters(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); UI.clearForm(); UI.openForm(); }
});

document.getElementById('gallerySearch')?.addEventListener('input', UI.renderGallery);
document.getElementById('gallerySort')?.addEventListener('change', UI.renderGallery);
document.getElementById('galleryMaker')?.addEventListener('change', UI.renderGallery);

// Обработчик загрузки фото (Telegram/Drive)
document.getElementById('fImgFile')?.addEventListener('change', async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const imgInput = document.getElementById('fImg');
  const originalValue = imgInput.value;
  const originalPlaceholder = imgInput.placeholder;
  const SCRIPT_URL = state.settings?.scriptUrl;
  const tgBotToken = state.settings?.tgBotToken;
  const tgChatId = state.settings?.tgChatId;

  if (!SCRIPT_URL && (!tgBotToken || !tgChatId)) {
    alert('❌ Сначала укажите настройки Telegram или ссылку на Google Script в Настройках!');
    e.target.value = ''; return;
  }

  if (tgBotToken && tgChatId) {
    imgInput.value = '⏳ Отправка фото в Telegram...'; imgInput.disabled = true;
    try {
      const formData = new FormData(); formData.append('chat_id', tgChatId); formData.append('photo', file);
      const sendRes = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendPhoto`, { method: 'POST', body: formData });
      const sendData = await sendRes.json();
      if (!sendData.ok) throw new Error(sendData.description || 'Не удалось отправить фото');
      const fileId = sendData.result.photo[sendData.result.photo.length - 1].file_id;
      const pathRes = await fetch(`https://api.telegram.org/bot${tgBotToken}/getFile?file_id=${fileId}`);
      const pathData = await pathRes.json();
      if (!pathData.ok) throw new Error(pathData.description || 'Не удалось получить путь к файлу');
      const filePath = pathData.result.file_path; const finalImgUrl = `https://api.telegram.org/file/bot${tgBotToken}/${filePath}`;
      const existingLinks = originalValue.trim();
      imgInput.value = existingLinks ? (existingLinks.endsWith(',') ? `${existingLinks} ${finalImgUrl}` : `${existingLinks}, ${finalImgUrl}`) : finalImgUrl;
      UI.toast('📸 Фото добавлено в Telegram!');
    } catch (error) {
      console.error(error); imgInput.value = originalValue; alert('❌ Ошибка загрузки в Telegram: ' + error.message);
    } finally { imgInput.placeholder = originalPlaceholder; imgInput.disabled = false; e.target.value = ''; }
  } else {
    imgInput.value = '⏳ Добавление фото на Google Диск...'; imgInput.disabled = true;
    const reader = new FileReader();
    reader.onload = async function (event) {
      const base64Data = event.target.result; const base64Content = base64Data.split(',')[1];
      const payload = { action: 'uploadImage', filename: file.name, mimeType: file.type, base64: base64Content };
      try {
        const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.ok && result.url) {
          const existingLinks = originalValue.trim();
          imgInput.value = existingLinks ? (existingLinks.endsWith(',') ? `${existingLinks} ${result.url}` : `${existingLinks}, ${result.url}`) : result.url;
          UI.toast('📸 Фото добавлено в галерею!');
        } else { imgInput.value = originalValue; alert('Ошибка Google Диска: ' + (result.error || 'Не удалось получить ссылку')); }
      } catch (err) { imgInput.value = originalValue; alert('Ошибка сети: ' + err.message); } finally { imgInput.placeholder = originalPlaceholder; imgInput.disabled = false; e.target.value = ''; }
    };
    reader.readAsDataURL(file);
  }
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

