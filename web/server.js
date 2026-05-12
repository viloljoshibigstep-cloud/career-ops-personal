import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.static(path.join(__dirname, 'public')));

// ── Parse applications.md ─────────────────────────────────────────────────────
function parseApplications() {
  const file = path.join(ROOT, 'data', 'applications.md');
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const rows = [];

  for (const line of lines) {
    if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|--') || line.startsWith('| <!--')) continue;
    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length < 8) continue;

    const [num, date, company, role, score, region, status, cv, cover, report, ...notesParts] = cols;
    const numericScore = parseFloat(score);
    rows.push({
      id: parseInt(num) || rows.length + 1,
      date: date || '',
      company: company || '',
      role: role || '',
      score: isNaN(numericScore) ? null : numericScore,
      region: region || '',
      status: status || '',
      cv: cv || '',
      cover: cover || '',
      report: report || '',
      notes: notesParts.join(' | ').trim(),
    });
  }

  return rows;
}

// ── Parse pipeline.md ─────────────────────────────────────────────────────────
function parsePipeline() {
  const file = path.join(ROOT, 'data', 'pipeline.md');
  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf8');
  const pending = [];
  let inPending = false;

  for (const line of content.split('\n')) {
    if (line.trim() === '## Pendientes') { inPending = true; continue; }
    if (line.startsWith('## ')) { inPending = false; continue; }
    if (!inPending) continue;

    const match = line.match(/^- \[ \] (.+)/);
    if (!match) continue;

    const parts = match[1].split('|').map(s => s.trim());
    pending.push({
      url: parts[0] || '',
      company: parts[1] || '',
      role: parts[2] || '',
      region: parts[3] || '',
      date: parts[4] || '',
    });
  }

  return pending;
}

// ── Read file as text ─────────────────────────────────────────────────────────
function readFileText(relPath) {
  if (!relPath) return null;
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// ── API endpoints ─────────────────────────────────────────────────────────────

// All evaluated jobs
app.get('/api/jobs', (req, res) => {
  const minScore = parseFloat(req.query.min_score || '0');
  const region = req.query.region || '';
  let jobs = parseApplications();

  if (minScore > 0) {
    jobs = jobs.filter(j => j.score !== null && j.score >= minScore);
  }
  if (region) {
    jobs = jobs.filter(j => j.region.toLowerCase().includes(region.toLowerCase()));
  }

  jobs.sort((a, b) => (b.score || 0) - (a.score || 0));
  res.json(jobs);
});

// Pipeline (unevaluated)
app.get('/api/pipeline', (req, res) => {
  res.json(parsePipeline());
});

// Serve PDF
app.get('/api/jobs/:id/pdf', (req, res) => {
  const jobs = parseApplications();
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job || !job.cv) return res.status(404).json({ error: 'PDF not found' });

  const abs = path.join(ROOT, job.cv);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'PDF file missing' });
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(abs);
});

// Serve cover letter
app.get('/api/jobs/:id/cover', (req, res) => {
  const jobs = parseApplications();
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job || !job.cover) return res.status(404).json({ error: 'Cover letter not found' });

  const text = readFileText(job.cover);
  if (!text) return res.status(404).json({ error: 'Cover letter file missing' });
  res.json({ content: text });
});

// Serve evaluation report
app.get('/api/jobs/:id/report', (req, res) => {
  const jobs = parseApplications();
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job || !job.report) return res.status(404).json({ error: 'Report not found' });

  const text = readFileText(job.report);
  if (!text) return res.status(404).json({ error: 'Report file missing' });
  res.json({ content: text });
});

// Download CV
app.get('/api/jobs/:id/download-cv', (req, res) => {
  const jobs = parseApplications();
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job || !job.cv) return res.status(404).json({ error: 'CV not found' });

  const abs = path.join(ROOT, job.cv);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'CV file missing' });

  const filename = `CV_VilolJoshi_${job.company.replace(/\s+/g, '_')}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(abs);
});

// Download cover letter as .txt
app.get('/api/jobs/:id/download-cover', (req, res) => {
  const jobs = parseApplications();
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job || !job.cover) return res.status(404).json({ error: 'Cover not found' });

  const text = readFileText(job.cover);
  if (!text) return res.status(404).json({ error: 'Cover file missing' });

  const filename = `CoverLetter_VilolJoshi_${job.company.replace(/\s+/g, '_')}.txt`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain');
  res.send(text);
});

// Trigger job scan
app.post('/api/scan', (req, res) => {
  const before = parseApplications().length;
  execFile('npm', ['run', 'scan'], { cwd: ROOT, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      return res.json({ success: false, error: stderr || err.message });
    }
    const after = parseApplications().length;
    res.json({ success: true, new_jobs: Math.max(0, after - before), output: stdout });
  });
});

// Stats summary
app.get('/api/stats', (req, res) => {
  const jobs = parseApplications();
  const pipeline = parsePipeline();

  res.json({
    total: jobs.length,
    above7: jobs.filter(j => j.score !== null && j.score >= 7).length,
    applied: jobs.filter(j => j.status === 'applied').length,
    interviewing: jobs.filter(j => j.status === 'interviewing').length,
    pending_eval: pipeline.length,
    by_region: jobs.reduce((acc, j) => {
      const r = j.region || 'Unknown';
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {}),
  });
});

app.listen(PORT, () => {
  console.log(`\n  CareerOps Dashboard → http://localhost:${PORT}\n`);
});
