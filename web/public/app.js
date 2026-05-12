// ── State ─────────────────────────────────────────────────────────────────────
let allJobs = [];
let pipelineJobs = [];
let selectedJob = null;
let currentView = 'reviewed';   // 'reviewed' | 'pipeline'
let currentTab = 'cv';          // 'cv' | 'cover' | 'report'

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  refreshAll();
});

async function refreshAll() {
  await Promise.all([loadStats(), loadJobs(), loadPipeline()]);
}

async function runScan() {
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
  } catch (e) {
    showToast('Scan request failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Run Scan';
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('stat-above7').textContent = data.above7 ?? 0;
    document.getElementById('stat-total').textContent = data.total ?? 0;
    document.getElementById('stat-pipeline').textContent = data.pending_eval ?? 0;
    document.getElementById('stat-applied').textContent = data.applied ?? 0;
  } catch { /* silently ignore on first load */ }
}

async function loadJobs() {
  try {
    const res = await fetch('/api/jobs');
    allJobs = await res.json();
    if (currentView === 'reviewed') renderJobs();
  } catch (e) {
    showToast('Failed to load jobs', 'error');
  }
}

async function loadPipeline() {
  try {
    const res = await fetch('/api/pipeline');
    pipelineJobs = await res.json();
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

  // Toggle filter bar visibility (not useful for pipeline)
  document.getElementById('score-filter').style.display = view === 'reviewed' ? '' : 'none';

  if (view === 'reviewed') {
    renderJobs();
  } else {
    renderPipeline();
    clearReview();
  }
}

function filterJobs() {
  if (currentView === 'reviewed') renderJobs();
}

// ── Render scored jobs ────────────────────────────────────────────────────────
function renderJobs() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const region = document.getElementById('region-filter').value;
  const minScore = parseFloat(document.getElementById('score-filter').value) || 0;

  let jobs = allJobs;
  if (minScore > 0) jobs = jobs.filter(j => j.score !== null && j.score >= minScore);
  if (region) jobs = jobs.filter(j => j.region && j.region.includes(region));
  if (search) jobs = jobs.filter(j =>
    j.company.toLowerCase().includes(search) ||
    j.role.toLowerCase().includes(search)
  );

  document.getElementById('sidebar-count').textContent =
    `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

  const list = document.getElementById('job-list');
  if (jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <p>No evaluated jobs found.<br>
        Run the morning scan or <code>/career-ops scan</code><br>
        then <code>/career-ops eval</code> to evaluate jobs.</p>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map(job => `
    <div class="job-card ${selectedJob?.id === job.id ? 'selected' : ''}"
         onclick="selectJob(${job.id})">
      <div class="job-card-top">
        <div class="job-card-company">${esc(job.company)}</div>
        ${scoreTag(job.score)}
      </div>
      <div class="job-card-role">${esc(job.role)}</div>
      <div class="job-card-meta">
        ${job.region ? `<span class="meta-tag region">${esc(job.region)}</span>` : ''}
        ${statusTag(job.status)}
        ${job.cv ? `<span class="meta-tag has-cv">📄 CV</span>` : ''}
        ${job.cover ? `<span class="meta-tag has-cover">✉ Cover</span>` : ''}
        ${job.date ? `<span class="meta-tag">${esc(job.date)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Render pipeline ───────────────────────────────────────────────────────────
function renderPipeline() {
  document.getElementById('sidebar-count').textContent =
    `${pipelineJobs.length} pending`;

  const list = document.getElementById('job-list');
  if (pipelineJobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📥</div>
        <p>Pipeline is empty.<br>
        Run <code>/career-ops scan</code> to discover new jobs.<br>
        New jobs appear here before evaluation.</p>
      </div>`;
    return;
  }

  list.innerHTML = pipelineJobs.map((job, i) => `
    <div class="pipeline-card">
      <div class="pipeline-company">${esc(job.company || 'Unknown')}</div>
      <div class="pipeline-role">${esc(job.role || 'Role unknown')}</div>
      <div class="pipeline-meta">
        ${job.region ? `<span class="meta-tag region">${esc(job.region)}</span>` : ''}
        ${job.date ? `<span class="meta-tag">${esc(job.date)}</span>` : ''}
      </div>
      ${job.url ? `<a class="pipeline-url" href="${esc(job.url)}" target="_blank">↗ ${esc(job.url)}</a>` : ''}
    </div>
  `).join('');
}

// ── Job selection & review panel ──────────────────────────────────────────────
async function selectJob(id) {
  selectedJob = allJobs.find(j => j.id === id);
  if (!selectedJob) return;

  // Re-render list to update selected state
  renderJobs();

  // Show review area
  document.getElementById('empty-state').style.display = 'none';
  const area = document.getElementById('review-area');
  area.style.display = 'flex';

  // Fill header
  document.getElementById('review-company').textContent = selectedJob.company;
  document.getElementById('review-role').textContent = selectedJob.role;

  // Badges
  document.getElementById('review-badges').innerHTML = [
    scoreTag(selectedJob.score),
    selectedJob.region ? `<span class="meta-tag region">${esc(selectedJob.region)}</span>` : '',
    statusTag(selectedJob.status),
  ].join('');

  // Action buttons
  document.getElementById('btn-dl-cv').disabled = !selectedJob.cv;
  document.getElementById('btn-dl-cover').disabled = !selectedJob.cover;

  // Reset to CV tab
  switchTab('cv');
  await loadReviewContent();
}

async function loadReviewContent() {
  if (!selectedJob) return;

  // CV tab
  const pdfContainer = document.getElementById('pdf-container');
  if (selectedJob.cv) {
    pdfContainer.innerHTML = `<iframe src="/api/jobs/${selectedJob.id}/pdf" title="CV Preview"></iframe>`;
  } else {
    pdfContainer.innerHTML = `
      <div class="pdf-placeholder">
        <div class="icon">📄</div>
        <p>No CV generated yet.<br>Run <code>/career-ops pdf</code> in Claude Code.</p>
      </div>`;
  }

  // Cover letter tab
  const coverEl = document.getElementById('cover-text');
  if (selectedJob.cover) {
    try {
      const res = await fetch(`/api/jobs/${selectedJob.id}/cover`);
      const data = await res.json();
      coverEl.textContent = data.content || 'Cover letter is empty.';
    } catch {
      coverEl.textContent = 'Failed to load cover letter.';
    }
  } else {
    coverEl.textContent = 'No cover letter generated yet.\n\nRun cover letter generation in Claude Code to create one.';
  }

  // Report tab
  const reportEl = document.getElementById('report-md');
  if (selectedJob.report) {
    try {
      const res = await fetch(`/api/jobs/${selectedJob.id}/report`);
      const data = await res.json();
      reportEl.innerHTML = markdownToHtml(data.content || '');
    } catch {
      reportEl.innerHTML = 'Failed to load evaluation report.';
    }
  } else {
    reportEl.innerHTML = 'No evaluation report yet.<br><br>Run <code>/career-ops eval</code> in Claude Code.';
  }
}

function clearReview() {
  selectedJob = null;
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('review-area').style.display = 'none';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  const tabs = ['cv', 'cover', 'report'];
  const labels = ['cv', 'cover', 'report'];

  document.querySelectorAll('.review-tab').forEach((el, i) => {
    el.classList.toggle('active', labels[i] === tab);
  });
  tabs.forEach(t => {
    document.getElementById(`pane-${t}`).classList.toggle('active', t === tab);
  });
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function downloadCV() {
  if (!selectedJob?.cv) return;
  window.location.href = `/api/jobs/${selectedJob.id}/download-cv`;
  showToast('Downloading CV…', 'success');
}

function downloadCover() {
  if (!selectedJob?.cover) return;
  window.location.href = `/api/jobs/${selectedJob.id}/download-cover`;
  showToast('Downloading cover letter…', 'success');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreTag(score) {
  if (score === null || score === undefined || score === '') {
    return `<span class="score-badge score-none">?</span>`;
  }
  const n = parseFloat(score);
  const cls = n >= 8 ? 'score-high' : n >= 6 ? 'score-mid' : 'score-low';
  return `<span class="score-badge ${cls}">${n.toFixed(1)}</span>`;
}

function statusTag(status) {
  if (!status) return '';
  const map = {
    applied: 'status-applied',
    interviewing: 'status-interviewing',
    pending_eval: 'status-pending',
    evaluated: 'status-pending',
    cv_generated: 'status-pending',
  };
  const cls = map[status] || '';
  return `<span class="meta-tag ${cls}">${esc(status.replace(/_/g, ' '))}</span>`;
}

// Minimal markdown renderer (headings, bold, code, lists)
function markdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.split('|').filter(Boolean);
      const isHeader = cells.every(c => /^[-\s]+$/.test(c.trim()));
      if (isHeader) return '';
      const tag = 'td';
      return `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[huptl])(.+)$/gm, (line) => line ? `<p>${line}</p>` : '')
    .replace(/<p><\/p>/g, '');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}
