#!/usr/bin/env node
/**
 * generate-data.mjs
 * Converts data/applications.md + data/pipeline.md → docs/data/jobs.json + docs/data/pipeline.json
 * Run after every scan or CV generation, then push to GitHub.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA  = join(ROOT, 'data');
const DOCS  = join(ROOT, 'docs');
const OUT   = join(DOCS, 'data');

mkdirSync(OUT, { recursive: true });
mkdirSync(join(DOCS, 'output'), { recursive: true });

// ── Parse applications.md ─────────────────────────────────────────────────────
function parseApplications() {
  const f = join(DATA, 'applications.md');
  if (!existsSync(f)) return [];
  const rows = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*#/.test(line) || /^\|--/.test(line) || /^\|\s*<!--/.test(line)) continue;
    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length < 8) continue;
    const [num, date, company, role, score, region, status, cv, cover = '', report = '', ...rest] = cols;
    const numericScore = parseFloat(score);
    rows.push({
      id: parseInt(num) || rows.length + 1,
      date, company, role,
      score: isNaN(numericScore) ? null : numericScore,
      region, status,
      cv: cv || '',
      cover: cover || '',
      report: report || '',
      notes: rest.join(' | ').trim(),
    });
  }
  return rows.sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ── Parse pipeline.md ─────────────────────────────────────────────────────────
function parsePipeline() {
  const f = join(DATA, 'pipeline.md');
  if (!existsSync(f)) return [];
  const pending = [];
  let inPending = false;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (line.trim() === '## Pendientes') { inPending = true; continue; }
    if (line.startsWith('## ')) { inPending = false; continue; }
    if (!inPending) continue;
    const m = line.match(/^- \[ \] (.+)/);
    if (!m) continue;
    const parts = m[1].split('|').map(s => s.trim());
    pending.push({
      url:     parts[0] || '',
      company: parts[1] || '',
      role:    parts[2] || '',
      region:  parts[3] || '',
      date:    parts[4] || '',
    });
  }
  return pending;
}

// ── Copy PDFs + covers to docs/output ────────────────────────────────────────
function copyArtifacts(jobs) {
  let copied = 0;
  for (const job of jobs) {
    for (const field of ['cv', 'cover', 'report']) {
      const rel = job[field];
      if (!rel) continue;
      const src = join(ROOT, rel);
      if (!existsSync(src)) continue;
      // Only copy files that live under output/ or reports/
      if (!rel.startsWith('output/') && !rel.startsWith('reports/')) continue;
      const dest = join(DOCS, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      copied++;
    }
  }
  return copied;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const jobs     = parseApplications();
const pipeline = parsePipeline();
const copied   = copyArtifacts(jobs);

writeFileSync(join(OUT, 'jobs.json'),     JSON.stringify(jobs,     null, 2), 'utf8');
writeFileSync(join(OUT, 'pipeline.json'), JSON.stringify(pipeline, null, 2), 'utf8');

console.log(`✓ docs/data/jobs.json      — ${jobs.length} jobs`);
console.log(`✓ docs/data/pipeline.json  — ${pipeline.length} pending`);
console.log(`✓ Artifacts copied         — ${copied} files`);
console.log(`\nPush to GitHub → Pages updates automatically.`);
