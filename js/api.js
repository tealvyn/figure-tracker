// js/api.js
import { state, persist, appState } from './state.js';
import * as UI from './ui.js';

export async function fetchRates(force = false) {
  const badge = document.getElementById('ratesBadge');
  const age = Date.now() - (state.ratesAt || 0);
  if (!force && age < 4 * 3600 * 1000 && state.rates.JPY) { UI.showRatesBadge(); return; }
  
  if (badge) {
    badge.className = 'rates-badge loading'; 
    badge.textContent = 'Обновляю...';
  }
  
  try {
    const [usdRes, jpyRes] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'),
      fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json')
    ]);
    const usdData = await usdRes.json();
    const jpyData = await jpyRes.json();
    state.rates = { EUR: 1, USD: +(usdData.usd.eur).toFixed(6), JPY: +(jpyData.jpy.eur).toFixed(6) };
    state.ratesAt = Date.now(); 
    persist(); 
    UI.showRatesBadge(); 
    UI.toast('Курсы обновлены'); 
    UI.updateEurPreview();
  } catch { 
    if (badge) {
      badge.className = 'rates-badge stale';
      badge.textContent = 'Ошибка курсов — нажми для повтора'; 
    }
  }
}

export async function backupToDrive(silent = false) {
  const SCRIPT_URL = state.settings?.scriptUrl;
  if (!SCRIPT_URL) {
    if (!silent) UI.toast('❌ Сначала укажите ссылку на Google Script в Настройках!');
    return;
  }

  const badge = document.getElementById('backupBtn');
  const btn2 = document.getElementById('backupBtnSettings');
  const autoBackupBar = document.getElementById('autoBackupBar');

  if (!silent) {
    [badge, btn2].forEach(b => {
      if (b) { b.textContent = '⏳ Сохраняю...'; b.disabled = true; }
    });
  }

  try {
    const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(state) });
    const data = await res.json();

    if (!silent) {
      [badge, btn2].forEach(b => {
        if (b) b.textContent = data.ok ? '✅ Сохранено!' : '❌ Ошибка';
      });
      setTimeout(() => {
        if (badge) { badge.textContent = 'Google Drive'; badge.disabled = false; }
        if (btn2) { btn2.textContent = '☁️ Сохранить'; btn2.disabled = false; }
      }, 2000);
      UI.toast(data.ok ? '✅ Сохранено в Google Drive: ' + data.filename : '❌ Ошибка: ' + data.error);
    }

    if (silent && data.ok && autoBackupBar) {
      const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
      autoBackupBar.innerHTML = `<span style="color:var(--green)">●</span> Автосохранено в ${time}`;
    }
  } catch (err) {
    if (!silent) {
      [badge, btn2].forEach(b => {
        if (b) { b.textContent = '❌ Ошибка'; b.disabled = false; }
      });
      UI.toast('❌ Не удалось подключиться к Google Drive');
    }
    if (silent && autoBackupBar) {
      autoBackupBar.innerHTML = '<span style="color:var(--red)">●</span> Нет соединения с Google Drive';
    }
  }
}

export async function loadFromDrive() {
  const SCRIPT_URL = state.settings?.scriptUrl;
  if (!SCRIPT_URL) {
    UI.toast('❌ Сначала укажите ссылку на Google Script в Настройках!');
    return;
  }
  const btn = document.getElementById('loadDriveBtn');
  if (btn) { btn.textContent = '⏳ Загрузка...'; btn.disabled = true; }
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    if (!data.ok) { UI.toast('❌ ' + (data.error || 'Ошибка Drive')); return; }

    const driveCount = data.state?.items?.length || 0;
    const localCount = state.items?.length || 0;

    if (!confirm(`☁️ На Drive: ${driveCount} фигурок\n💾 Локально: ${localCount} фигурок\n\nЗагрузить с Drive?`)) return;
    
    Object.assign(state, data.state);
    appState.selectedOrder = null;
    persist();
    UI.render();
    UI.toast(`☁️ Загружено с Drive: ${driveCount} фигурок`);
  } catch {
    UI.toast('❌ Не удалось подключиться к Drive');
  } finally {
    if (btn) { btn.textContent = '☁️ Загрузить с Drive'; btn.disabled = false; }
  }
}