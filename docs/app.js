// ── Mode detection ─────────────────────────────────────────────────────────────
// On GitHub Pages (not localhost) → read static JSON files, no API server needed
const IS_STATIC = !['localhost', '127.0.0.1'].includes(window.location.hostname);

const api = {
  jobs:     () => IS_STATIC ? fetch('data/jobs.json')     : fetch('/api/jobs'),
  pipeline: () => IS_STATIC ? fetch('data/pipeline.json') : fetch('/api/pipeline'),
  stats:    () => IS_STATIC ? null : fetch('/api/stats'),
  pdf:      (id, path) => IS_STATIC ? path : `/api/jobs/${id}/pdf`,
  cover:    (id, path) => IS_STATIC ? fetch(path)                    : fetch(`/api/jobs/${id}/cover`).then(r => r.json()).then(d => ({ text: d.content })),
  report:   (id, path) => IS_STATIC ? fetch(path)                    : fetch(`/api/jobs/${id}/report`).then(r => r.json()).then(d => ({ text: d.content })),
  dlCV:     (id, path) => IS_STATIC ? path : `/api/jobs/${id}/download-cv`,
  dlCover:  (id, path) => IS_STATIC ? path : `/api/jobs/${id}/download-cover`,
};

// ── State ─────────────────────────────────────────────────────────────────────
let allJobs = [];
let pipelineJobs = [];
let selectedJob = null;
let selectedPipelineIdx = null;
let currentView = 'reviewed';
let currentTab  = 'cv';

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (IS_STATIC) {
    // Show hint in scan button on GitHub Pages
    const btn = document.getElementById('btn-scan');
    btn.title = 'Run locally: npm run scan, then push to GitHub';
  }
  refreshAll();
});

async function refreshAll() {
  await Promise.all([loadStats(), loadJobs(), loadPipeline()]);
}

// ── Scan ──────────────────────────────────────────────────────────────────────
async function runScan() {
  if (IS_STATIC) {
    showToast('Run locally: npm run scan → then push to GitHub', 'info');
    return;
  }
  const btn = document.getElementById('btn-scan');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning…';
  showToast('Job scan started — this may take 30–60 seconds', 'info');
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Scan complete: ${data.new_jobs ?? 0} new jobs found`, 'success');
      await refreshAll();
    } else {
      showToast('Scan failed: ' + (data.error || 'unknown error'), 'error');
    }
  } catch {
    showToast('Scan request failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Run Scan';
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function loadStats() {
  if (IS_STATIC) return; // stats computed after loadJobs
  try {
    const res = await api.stats();
    const data = await res.json();
    document.getElementById('stat-above7').textContent  = data.above7      ?? 0;
    document.getElementById('stat-total').textContent   = data.total       ?? 0;
    document.getElementById('stat-pipeline').textContent = data.pending_eval ?? 0;
    document.getElementById('stat-applied').textContent = data.applied     ?? 0;
  } catch { /* ignore on first load */ }
}

function updateStatsFromData() {
  document.getElementById('stat-above7').textContent   = allJobs.filter(j => j.score >= 7).length;
  document.getElementById('stat-total').textContent    = allJobs.length;
  document.getElementById('stat-pipeline').textContent = pipelineJobs.length;
  document.getElementById('stat-applied').textContent  = allJobs.filter(j => j.status === 'applied').length;
}

async function loadJobs() {
  try {
    const res = await api.jobs();
    const data = await res.json();
    allJobs = data;
    if (IS_STATIC) updateStatsFromData();
    if (currentView === 'reviewed') renderJobs();
  } catch (e) {
    showToast('Failed to load jobs', 'error');
  }
}

async function loadPipeline() {
  try {
    const res = await api.pipeline();
    pipelineJobs = await res.json();
    if (IS_STATIC) updateStatsFromData();
    if (currentView === 'pipeline') renderPipeline();
  } catch (e) {
    showToast('Failed to load pipeline', 'error');
  }
}

// ── Views ─────────────────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  document.getElementById('tab-reviewed').classList.toggle('active', view === 'reviewed');
  document.getElementById('tab-pipeline').classList.toggle('active', view === 'pipeline');
  document.getElementById('score-filter').style.display = view === 'reviewed' ? '' : 'none';
  clearReview();
  if (view === 'reviewed') renderJobs();
  else renderPipeline();
}

function filterJobs() {
  if (currentView === 'reviewed') renderJobs();
}

// ── Render scored jobs ────────────────────────────────────────────────────────
function renderJobs() {
  const search   = document.getElementById('search-input').value.toLowerCase();
  const region   = document.getElementById('region-filter').value;
  const minScore = parseFloat(document.getElementById('score-filter').value) || 0;

  let jobs = allJobs;
  if (minScore > 0) jobs = jobs.filter(j => j.score != null && j.score >= minScore);
  if (region)       jobs = jobs.filter(j => j.region && j.region.includes(region));
  if (search)       jobs = jobs.filter(j =>
    j.company.toLowerCase().includes(search) || j.role.toLowerCase().includes(search));

  document.getElementById('sidebar-count').textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

  const list = document.getElementById('job-list');
  if (jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <p>No evaluated jobs found.<br>Run the morning scan or <code>npm run scan</code><br>
        then evaluate with Claude Code.</p>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map(job => `
    <div class="job-card ${selectedJob?.id === job.id ? 'selected' : ''}" onclick="selectJob(${job.id})">
      <div class="job-card-top">
        <div class="job-card-company">${esc(job.company)}</div>
        ${scoreTag(job.score)}
      </div>
      <div class="job-card-role">${esc(job.role)}</div>
      <div class="job-card-meta">
        ${job.region ? `<span class="meta-tag region">${esc(job.region)}</span>` : ''}
        ${statusTag(job.status)}
        ${job.cv    ? `<span class="meta-tag has-cv">📄 CV</span>` : ''}
        ${job.cover ? `<span class="meta-tag has-cover">✉ Cover</span>` : ''}
        ${job.date  ? `<span class="meta-tag">${esc(job.date)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Render pipeline ───────────────────────────────────────────────────────────
function renderPipeline() {
  document.getElementById('sidebar-count').textContent = `${pipelineJobs.length} pending`;

  const list = document.getElementById('job-list');
  if (pipelineJobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📥</div>
        <p>Pipeline is empty.<br>Run <code>npm run scan</code> to discover new jobs.</p>
      </div>`;
    return;
  }

  list.innerHTML = pipelineJobs.map((job, idx) => `
    <div class="pipeline-card ${selectedPipelineIdx === idx ? 'selected' : ''}" onclick="selectPipelineJob(${idx})">
      <div class="pipeline-company">${esc(job.company || 'Unknown')}</div>
      <div class="pipeline-role">${esc(job.role || 'Role unknown')}</div>
      <div class="pipeline-meta">
        ${job.region ? `<span class="meta-tag region">${esc(job.region)}</span>` : ''}
        ${job.date   ? `<span class="meta-tag">${esc(job.date)}</span>` : ''}
      </div>
      ${job.url ? `<a class="pipeline-url" href="${esc(job.url)}" target="_blank" onclick="event.stopPropagation()">↗ ${esc(job.url)}</a>` : ''}
    </div>
  `).join('');
}

// ── Pipeline job selection ─────────────────────────────────────────────────────
function selectPipelineJob(idx) {
  selectedPipelineIdx = idx;
  selectedJob = null;
  const job = pipelineJobs[idx];
  if (!job) return;

  renderPipeline();
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('review-area').style.display = 'flex';
  document.getElementById('review-company').textContent = job.company || 'Unknown Company';
  document.getElementById('review-role').textContent    = job.role || 'Unknown Role';
  document.getElementById('review-badges').innerHTML = [
    `<span class="meta-tag status-pending">pipeline</span>`,
    job.region ? `<span class="meta-tag region">${esc(job.region)}</span>` : '',
    job.date   ? `<span class="meta-tag">${esc(job.date)}</span>`           : '',
  ].join('');

  const applyBtn = document.getElementById('btn-apply-link');
  if (job.url) {
    applyBtn.href = job.url;
    applyBtn.style.display = '';
  } else {
    applyBtn.style.display = 'none';
  }

  document.getElementById('btn-dl-cv').disabled    = true;
  document.getElementById('btn-dl-cover').disabled = true;

  document.getElementById('pdf-container').innerHTML = `
    <div class="pdf-placeholder">
      <div class="icon">📄</div>
      <p>No CV yet — this job hasn't been evaluated.<br>
      Score it with Claude Code, then <code>/pdf</code> to generate.</p>
    </div>`;

  document.getElementById('cover-text').textContent = 'No cover letter yet — evaluate this job first, then run /cover in Claude Code.';

  document.getElementById('report-md').innerHTML = `
    <h2 style="margin-bottom:12px">${esc(job.company || 'Unknown')} — ${esc(job.role || 'Unknown')}</h2>
    ${job.region ? `<p style="margin-bottom:6px"><strong>Region:</strong> ${esc(job.region)}</p>` : ''}
    ${job.date   ? `<p style="margin-bottom:6px"><strong>Found:</strong> ${esc(job.date)}</p>`    : ''}
    ${job.url    ? `<p style="margin-bottom:16px"><strong>Posting:</strong> <a href="${esc(job.url)}" target="_blank" style="color:var(--accent)">${esc(job.url)}</a></p>` : ''}
    <hr style="border-color:var(--border);margin-bottom:16px">
    <p style="color:var(--text-muted);margin-bottom:8px">To generate a tailored CV &amp; cover letter:</p>
    <ol style="padding-left:20px;line-height:1.9;color:var(--text-dim)">
      <li>Open Claude Code in the <code>career-ops</code> folder</li>
      <li>Run <code>/oferta</code> to score this job (needs score ≥ 7)</li>
      <li>Run <code>/pdf</code> to generate the tailored CV</li>
      <li>Push to GitHub — dashboard updates automatically</li>
    </ol>`;

  switchTab('report');
}

// ── Job selection & review panel ──────────────────────────────────────────────
async function selectJob(id) {
  selectedJob = allJobs.find(j => j.id === id);
  if (!selectedJob) return;

  renderJobs();
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('review-area').style.display = 'flex';
  document.getElementById('review-company').textContent = selectedJob.company;
  document.getElementById('review-role').textContent    = selectedJob.role;
  document.getElementById('review-badges').innerHTML = [
    scoreTag(selectedJob.score),
    selectedJob.region ? `<span class="meta-tag region">${esc(selectedJob.region)}</span>` : '',
    statusTag(selectedJob.status),
  ].join('');

  document.getElementById('btn-dl-cv').disabled    = !selectedJob.cv;
  document.getElementById('btn-dl-cover').disabled = !selectedJob.cover;

  switchTab('cv');
  await loadReviewContent();
}

async function loadReviewContent() {
  if (!selectedJob) return;

  // ── CV tab ──
  const pdfContainer = document.getElementById('pdf-container');
  if (selectedJob.cv) {
    const src = api.pdf(selectedJob.id, selectedJob.cv);
    pdfContainer.innerHTML = `<iframe src="${src}" title="CV Preview"></iframe>`;
  } else {
    pdfContainer.innerHTML = `
      <div class="pdf-placeholder">
        <div class="icon">📄</div>
        <p>No CV generated yet.<br>Run <code>/pdf</code> in Claude Code.</p>
      </div>`;
  }

  // ── Cover letter tab ──
  const coverEl = document.getElementById('cover-text');
  if (selectedJob.cover) {
    try {
      const result = await api.cover(selectedJob.id, selectedJob.cover);
      const text = IS_STATIC ? await result.text() : result.text;
      coverEl.textContent = text || 'Cover letter is empty.';
    } catch { coverEl.textContent = 'Failed to load cover letter.'; }
  } else {
    coverEl.textContent = 'No cover letter generated yet.';
  }

  // ── Report tab ──
  const reportEl = document.getElementById('report-md');
  if (selectedJob.report) {
    try {
      const result = await api.report(selectedJob.id, selectedJob.report);
      const text = IS_STATIC ? await result.text() : result.text;
      reportEl.innerHTML = markdownToHtml(text || '');
    } catch { reportEl.innerHTML = 'Failed to load evaluation report.'; }
  } else {
    reportEl.innerHTML = 'No evaluation report yet.';
  }
}

function clearReview() {
  selectedJob = null;
  selectedPipelineIdx = null;
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('review-area').style.display = 'none';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.review-tab').forEach((el, i) => {
    el.classList.toggle('active', ['cv', 'cover', 'report'][i] === tab);
  });
  ['cv', 'cover', 'report'].forEach(t => {
    document.getElementById(`pane-${t}`).classList.toggle('active', t === tab);
  });
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function downloadCV() {
  if (!selectedJob?.cv) return;
  window.open(api.dlCV(selectedJob.id, selectedJob.cv), '_blank');
  showToast('Downloading CV…', 'success');
}

function downloadCover() {
  if (!selectedJob?.cover) return;
  window.open(api.dlCover(selectedJob.id, selectedJob.cover), '_blank');
  showToast('Downloading cover letter…', 'success');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreTag(score) {
  if (score == null || score === '') return `<span class="score-badge score-none">?</span>`;
  const n = parseFloat(score);
  const cls = n >= 8 ? 'score-high' : n >= 6 ? 'score-mid' : 'score-low';
  return `<span class="score-badge ${cls}">${n.toFixed(1)}</span>`;
}

function statusTag(status) {
  if (!status) return '';
  const map = { applied: 'status-applied', interviewing: 'status-interviewing' };
  return `<span class="meta-tag ${map[status] || 'status-pending'}">${esc(status.replace(/_/g, ' '))}</span>`;
}

function markdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g,    '<code>$1</code>')
    .replace(/^- (.+)$/gm,    '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[huptl])(.+)$/gm, line => line ? `<p>${line}</p>` : '')
    .replace(/<p><\/p>/g, '');
}

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}
