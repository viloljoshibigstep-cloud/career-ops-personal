#!/usr/bin/env node
/**
 * generate-data.mjs
 * Converts data/applications.md + data/pipeline.md → data/jobs.json + data/pipeline.json
 * Also copies PDFs/covers to output/ (served by GitHub Pages from root).
 * Run after every scan or CV generation, then push to GitHub.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA  = join(ROOT, 'data');
const OUT   = DATA; // JSON files live alongside the markdown files

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

// ── Main ──────────────────────────────────────────────────────────────────────
const jobs     = parseApplications();
const pipeline = parsePipeline();

writeFileSync(join(OUT, 'jobs.json'),     JSON.stringify(jobs,     null, 2), 'utf8');
writeFileSync(join(OUT, 'pipeline.json'), JSON.stringify(pipeline, null, 2), 'utf8');

console.log(`✓ data/jobs.json      — ${jobs.length} jobs`);
console.log(`✓ data/pipeline.json  — ${pipeline.length} pending`);
console.log(`\nPush to GitHub → Pages updates automatically.`);
