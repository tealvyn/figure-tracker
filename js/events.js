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
  UI.bindHistoryBackHandling();

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

  const globalSearchInput = document.getElementById('globalSearchInput');
  globalSearchInput?.addEventListener('input', debounce(e => {
    UI.setGlobalSearch(e.target.value);
  }, 150));
  globalSearchInput?.addEventListener('focus', UI.renderGlobalSearchResults);
  globalSearchInput?.addEventListener('keydown', UI.handleGlobalSearchKeydown);

  document.getElementById('globalSearchResults')?.addEventListener('click', e => {
    const result = e.target.closest('.global-search-result');
    if (!result) return;
    UI.openGlobalSearchResult(result.dataset.resultIndex || 0);
  });

  document.addEventListener('click', e => {
    if (e.target.closest('.global-search')) return;
    UI.hideGlobalSearchResults();
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (e.target.closest('#filterToggle') || e.target.closest('#sidebarFilterBody')) return;
    UI.closeFilters();
  });

  document.getElementById('wishPriorityFilter')?.addEventListener('change', () => UI.scheduleRender('wishlist', UI.renderWishlist));
  document.getElementById('shelfSort')?.addEventListener('change', () => UI.scheduleRender('shelf', UI.renderShelf));

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
  document.getElementById('wTags')?.addEventListener('input', UI.renderTagSuggestions);
  document.getElementById('sortSelect')?.addEventListener('change', () => { UI.scheduleRender('main', UI.render); UI.closeFilters(); });
  document.getElementById('filterStore')?.addEventListener('change', () => { UI.scheduleRender('main', UI.render); UI.closeFilters(); });
  document.getElementById('filterRegion')?.addEventListener('change', () => { UI.scheduleRender('main', UI.render); UI.closeFilters(); });

  document.getElementById('statusFilters')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const val = chip.dataset.filter;
    appState.filterStatus = val === '' ? null : val;
    UI.scheduleRender('main', UI.render);
    UI.closeFilters();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      UI.closeLightbox();
      UI.closeModal();
      UI.closeForm();
      UI.closeWishForm();
      UI.closeFilters();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); UI.clearForm(); UI.openForm(); }
  });

  document.getElementById('gallerySort')?.addEventListener('change', () => { UI.resetGalleryPagination(); UI.scheduleRender('gallery', UI.renderGallery); });
  document.getElementById('galleryMaker')?.addEventListener('change', () => { UI.resetGalleryPagination(); UI.scheduleRender('gallery', UI.renderGallery); });
  document.getElementById('galleryShowHidden')?.addEventListener('change', e => { UI.resetGalleryPagination(); UI.setGalleryShowHidden(e.target.checked); });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => UI.syncMobileCollectionView());
  });
}
