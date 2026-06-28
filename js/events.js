// js/events.js
import { appState } from './state.js';
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

export function bindStaticControls() {
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

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => UI.syncMobileCollectionView());
  });
}