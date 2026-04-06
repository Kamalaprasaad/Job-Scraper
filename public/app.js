/**
 * Job Scraper Dashboard — Frontend Logic
 */

// ─── State ───────────────────────────────────────────────────
const state = {
  jobs: [],
  filteredJobs: [],
  filterSource: 'all',
  filterSearch: '',
  sortBy: 'newest',
  currentPage: 1,
  pageSize: 25,
  polling: null,
};

// ─── DOM References ──────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadCachedJobs();
  fetchDefaultQueries();
  bindEvents();
  refreshJobCounts();
});

// ─── Event Binding ───────────────────────────────────────────
function bindEvents() {
  // Settings
  $('#btn-settings').addEventListener('click', () => toggleModal('settings-modal'));
  $('#btn-close-settings').addEventListener('click', () => toggleModal('settings-modal'));
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-toggle-token').addEventListener('click', () => {
    const input = $('#apify-token');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Scraper buttons
  $('#btn-scrape-all').addEventListener('click', () => runScrape('all'));
  $$('.btn-source').forEach(btn => {
    btn.addEventListener('click', () => runScrape(btn.dataset.source));
  });

  // Filters
  $('#filter-search').addEventListener('input', debounce(applyFilters, 300));
  $$('[data-filter-source]').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('[data-filter-source]').forEach(c => c.classList.remove('chip-active'));
      chip.classList.add('chip-active');
      state.filterSource = chip.dataset.filterSource;
      state.currentPage = 1;
      applyFilters();
    });
  });
  $('#filter-sort').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    applyFilters();
  });

  // Export
  $('#btn-export-csv').addEventListener('click', () => exportData('csv'));
  $('#btn-export-json').addEventListener('click', () => exportData('json'));
  $('#btn-clear-jobs').addEventListener('click', clearJobs);

  // Queries toggle
  $('#btn-toggle-queries').addEventListener('click', () => {
    $('#queries-list').classList.toggle('hidden');
  });

  // Job modal
  $('#btn-close-job').addEventListener('click', () => toggleModal('job-modal'));

  // Close modals on overlay click
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
}

// ─── Settings ────────────────────────────────────────────────
function loadSettings() {
  const token = localStorage.getItem('apify_token') || '';
  const maxResults = localStorage.getItem('max_results') || '15';
  $('#apify-token').value = token;
  $('#max-results').value = maxResults;
}

function saveSettings() {
  const token = $('#apify-token').value.trim();
  const maxResults = $('#max-results').value;
  localStorage.setItem('apify_token', token);
  localStorage.setItem('max_results', maxResults);
  toggleModal('settings-modal');
  showToast('Settings saved!');
}

function getToken() {
  return localStorage.getItem('apify_token') || '';
}

function getMaxResults() {
  return parseInt(localStorage.getItem('max_results') || '15', 10);
}

// ─── Fetch Default Queries ───────────────────────────────────
async function fetchDefaultQueries() {
  try {
    const res = await fetch('/api/queries');
    const queries = await res.json();
    renderQueries(queries);
  } catch (err) {
    console.error('Failed to fetch queries:', err);
  }
}

function renderQueries(queries) {
  const container = $('#queries-list');
  container.innerHTML = queries.map(q => `
    <div class="query-tag">
      <strong>${q.query}</strong>
      <span class="loc">📍 ${q.location}</span>
    </div>
  `).join('');
}

// ─── Run Scrape ──────────────────────────────────────────────
async function runScrape(source) {
  const token = getToken();
  if (!token) {
    toggleModal('settings-modal');
    showToast('Please set your Apify API token first!', 'error');
    return;
  }

  // Disable buttons
  setScrapingState(true, source);

  const body = {
    token,
    maxResults: getMaxResults(),
  };

  const endpoint = source === 'all' ? '/api/scrape/all' : `/api/scrape/${source}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.error) {
      showToast(data.error, 'error');
      setScrapingState(false, source);
      return;
    }

    showToast(`Scraping started for ${source === 'all' ? 'all sources' : source}...`);

    // Start polling for status
    startPolling(source);
  } catch (err) {
    showToast(`Failed to start scrape: ${err.message}`, 'error');
    setScrapingState(false, source);
  }
}

function setScrapingState(running, source) {
  const allBtn = $('#btn-scrape-all');

  if (running) {
    allBtn.disabled = true;
    allBtn.classList.add('btn-loading');
    $$('.btn-source').forEach(btn => { btn.disabled = true; });

    if (source === 'all') {
      ['linkedin', 'indeed', 'dice'].forEach(s => updateSourceStatus(s, 'running'));
    } else {
      updateSourceStatus(source, 'running');
    }

    $('#progress-section').classList.remove('hidden');
  } else {
    allBtn.disabled = false;
    allBtn.classList.remove('btn-loading');
    $$('.btn-source').forEach(btn => { btn.disabled = false; });

    if (source === 'all') {
      ['linkedin', 'indeed', 'dice'].forEach(s => updateSourceStatus(s, 'ready'));
    } else {
      updateSourceStatus(source, 'ready');
    }
  }
}

function updateSourceStatus(source, status) {
  const el = $(`#${source}-status`);
  if (!el) return;
  el.className = `stat status-dot ${status === 'running' ? 'running' : ''}`;
  el.textContent = status === 'running' ? 'Scraping...' : 'Ready';
}

// ─── Polling ─────────────────────────────────────────────────
function startPolling(source) {
  if (state.polling) clearInterval(state.polling);

  state.polling = setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      const status = await res.json();

      // Update progress log
      renderProgressLog(status.progress);

      // Check if done
      if (!status.running) {
        clearInterval(state.polling);
        state.polling = null;
        setScrapingState(false, source);

        // Fetch updated jobs
        await fetchJobs();
        showToast('Scraping complete! ✅');
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 2000);
}

function renderProgressLog(entries) {
  const log = $('#progress-log');
  log.innerHTML = entries.map(e => {
    const time = new Date(e.time).toLocaleTimeString();
    const isSuccess = e.message.includes('✅') || e.message.includes('Found');
    const isError = e.message.includes('❌') || e.message.includes('Error');
    const cls = isSuccess ? 'success' : isError ? 'error' : '';
    return `<div class="log-entry"><span class="log-time">[${time}]</span><span class="log-msg ${cls}">${e.message}</span></div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

// ─── Fetch Jobs ──────────────────────────────────────────────
async function fetchJobs() {
  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    state.jobs = data.jobs || [];
    saveJobsToCache();
    applyFilters();
    refreshJobCounts();
  } catch (err) {
    console.error('Failed to fetch jobs:', err);
  }
}

function loadCachedJobs() {
  try {
    const cached = localStorage.getItem('cached_jobs');
    if (cached) {
      state.jobs = JSON.parse(cached);
      applyFilters();
      refreshJobCounts();
    }
  } catch (e) { /* ignore */ }
}

function saveJobsToCache() {
  try {
    localStorage.setItem('cached_jobs', JSON.stringify(state.jobs));
  } catch (e) { /* ignore quota errors */ }
}

// ─── Filters & Sort ──────────────────────────────────────────
function applyFilters() {
  const search = ($('#filter-search')?.value || '').toLowerCase();
  state.filterSearch = search;

  let filtered = [...state.jobs];

  // Source filter
  if (state.filterSource !== 'all') {
    filtered = filtered.filter(j => j.source === state.filterSource);
  }

  // Search filter
  if (search) {
    filtered = filtered.filter(j =>
      (j.title || '').toLowerCase().includes(search) ||
      (j.company || '').toLowerCase().includes(search) ||
      (j.location || '').toLowerCase().includes(search) ||
      (j.description || '').toLowerCase().includes(search)
    );
  }

  // Sort
  switch (state.sortBy) {
    case 'newest':
      filtered.sort((a, b) => new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0));
      break;
    case 'oldest':
      filtered.sort((a, b) => new Date(a.scrapedAt || 0) - new Date(b.scrapedAt || 0));
      break;
    case 'title':
      filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'company':
      filtered.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
      break;
  }

  state.filteredJobs = filtered;
  renderJobs();
}

// ─── Render Jobs ─────────────────────────────────────────────
function renderJobs() {
  const jobs = state.filteredJobs;
  const empty = $('#results-empty');
  const table = $('#results-table');
  const tbody = $('#results-body');
  const paginationEl = $('#results-pagination');

  if (jobs.length === 0) {
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    paginationEl.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  table.classList.remove('hidden');

  // Pagination
  const totalPages = Math.ceil(jobs.length / state.pageSize);
  state.currentPage = Math.min(state.currentPage, totalPages);
  const start = (state.currentPage - 1) * state.pageSize;
  const pageJobs = jobs.slice(start, start + state.pageSize);

  tbody.innerHTML = pageJobs.map((job, i) => {
    const sourceClass = job.source.toLowerCase();
    const salary = job.salary || '—';
    const posted = formatDate(job.postedDate);
    const idx = start + i;

    return `
      <tr data-index="${idx}">
        <td class="job-title-cell" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</td>
        <td class="job-company-cell" title="${escapeHtml(job.company)}">${escapeHtml(job.company)}</td>
        <td class="job-location-cell" title="${escapeHtml(job.location)}">${escapeHtml(job.location)}</td>
        <td><span class="source-badge ${sourceClass}">${job.source}</span></td>
        <td class="salary-cell">${escapeHtml(typeof salary === 'string' ? salary : JSON.stringify(salary))}</td>
        <td class="date-cell">${posted}</td>
        <td>
          <a href="${escapeHtml(job.applyUrl)}" target="_blank" class="btn-apply" onclick="event.stopPropagation()">
            Apply →
          </a>
        </td>
      </tr>
    `;
  }).join('');

  // Row click → detail
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.index);
      showJobDetail(state.filteredJobs[idx]);
    });
  });

  // Pagination
  if (totalPages > 1) {
    paginationEl.classList.remove('hidden');
    let pagesHtml = '';
    for (let p = 1; p <= totalPages; p++) {
      pagesHtml += `<button class="page-btn ${p === state.currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
    paginationEl.innerHTML = pagesHtml;
    paginationEl.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentPage = parseInt(btn.dataset.page);
        renderJobs();
      });
    });
  } else {
    paginationEl.classList.add('hidden');
  }
}

// ─── Job Detail Modal ────────────────────────────────────────
function showJobDetail(job) {
  $('#modal-job-title').textContent = job.title;
  $('#modal-job-company').textContent = `🏢 ${job.company}`;
  $('#modal-job-location').textContent = `📍 ${job.location}`;

  const sourceChip = $('#modal-job-source');
  sourceChip.textContent = job.source;
  sourceChip.className = `detail-chip source-chip ${job.source.toLowerCase()}`;

  $('#modal-job-salary').textContent = job.salary
    ? `💰 ${typeof job.salary === 'string' ? job.salary : JSON.stringify(job.salary)}`
    : '💰 Not specified';
  $('#modal-job-type').textContent = `📋 ${job.jobType || 'N/A'}`;

  const desc = job.description || 'No description available.';
  $('#modal-job-description').textContent = desc;

  const applyLink = $('#modal-apply-link');
  applyLink.href = job.applyUrl || '#';

  toggleModal('job-modal');
}

// ─── Job Counts ──────────────────────────────────────────────
function refreshJobCounts() {
  const total = state.jobs.length;
  const bySource = { LinkedIn: 0, Indeed: 0, Dice: 0 };
  state.jobs.forEach(j => { if (bySource.hasOwnProperty(j.source)) bySource[j.source]++; });

  $('#job-count-badge').textContent = `${total} Jobs`;
  if ($('#linkedin-count')) $('#linkedin-count').textContent = bySource.LinkedIn;
  if ($('#indeed-count')) $('#indeed-count').textContent = bySource.Indeed;
  if ($('#dice-count')) $('#dice-count').textContent = bySource.Dice;
}

// ─── Export ──────────────────────────────────────────────────
function exportData(format) {
  if (state.jobs.length === 0) {
    showToast('No jobs to export!', 'error');
    return;
  }

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(state.filteredJobs, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'jobs_export.json');
  } else if (format === 'csv') {
    const headers = ['Title', 'Company', 'Location', 'Salary', 'Job Type', 'Source', 'Apply URL', 'Posted Date', 'Search Query'];
    const rows = state.filteredJobs.map(j => [
      `"${(j.title || '').replace(/"/g, '""')}"`,
      `"${(j.company || '').replace(/"/g, '""')}"`,
      `"${(j.location || '').replace(/"/g, '""')}"`,
      `"${(typeof j.salary === 'string' ? j.salary : (j.salary ? JSON.stringify(j.salary) : 'N/A')).replace(/"/g, '""')}"`,
      `"${(j.jobType || 'N/A').replace(/"/g, '""')}"`,
      `"${j.source}"`,
      `"${j.applyUrl || ''}"`,
      `"${j.postedDate || 'N/A'}"`,
      `"${(j.searchQuery || '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'jobs_export.csv');
  }

  showToast(`Exported ${state.filteredJobs.length} jobs as ${format.toUpperCase()}`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Clear Jobs ──────────────────────────────────────────────
async function clearJobs() {
  if (!confirm('Clear all scraped jobs?')) return;
  try {
    await fetch('/api/jobs', { method: 'DELETE' });
    state.jobs = [];
    state.filteredJobs = [];
    localStorage.removeItem('cached_jobs');
    applyFilters();
    refreshJobCounts();
    showToast('All jobs cleared');
  } catch (err) {
    showToast('Failed to clear jobs', 'error');
  }
}

// ─── Modal Toggle ────────────────────────────────────────────
function toggleModal(id) {
  const modal = $(`#${id}`);
  modal.classList.toggle('hidden');
}

// ─── Toast Notification ──────────────────────────────────────
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 14px 24px;
    background: ${type === 'error' ? '#f43f5e' : type === 'success' ? '#10b981' : '#6366f1'};
    color: white;
    border-radius: 10px;
    font-family: 'Inter', sans-serif;
    font-size: 0.88rem;
    font-weight: 500;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    z-index: 9999;
    animation: toastIn 0.3s ease-out;
  `;

  const style = document.createElement('style');
  style.textContent = '@keyframes toastIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
  toast.appendChild(style);

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Utilities ───────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
