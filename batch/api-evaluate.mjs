#!/usr/bin/env node
/**
 * batch/api-evaluate.mjs
 *
 * Evaluates all pending pipeline.md jobs using the Anthropic API (claude-sonnet-4-6).
 * For jobs scoring ≥ 7: generates cover letter + tailored CV HTML → PDF via Playwright.
 * Updates applications.md and pipeline.md, then re-runs generate-data.mjs.
 *
 * Usage:
 *   node batch/api-evaluate.mjs              # process all pending
 *   node batch/api-evaluate.mjs --dry-run    # score only, no writes
 *   node batch/api-evaluate.mjs --max 10     # limit to N jobs
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const ROOT   = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA   = join(ROOT, 'data');
const OUT    = join(ROOT, 'output');
const TMPL   = join(ROOT, 'templates');
const REP    = join(ROOT, 'reports');
const BATCH  = join(ROOT, 'batch');

mkdirSync(OUT,  { recursive: true });
mkdirSync(REP,  { recursive: true });
mkdirSync(join(BATCH, 'tracker-additions'), { recursive: true });

// ── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const MAX_IDX  = args.indexOf('--max');
const MAX_JOBS = MAX_IDX !== -1 ? parseInt(args[MAX_IDX + 1]) : Infinity;
const MODEL           = 'claude-sonnet-4-6';
const SCORE_THRESHOLD = 7.0;
const DELAY_MS        = 10_000;  // 10s between jobs → ~6 jobs/min, safely under 30K TPM
const MAX_RETRIES     = 3;

// ── Load env ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY not set — add it to .env or export it');
  process.exit(1);
}

const client = new Anthropic({ apiKey: API_KEY });

// ── Already-evaluated dedup ───────────────────────────────────────────────────

function loadEvaluatedKeys() {
  const f = join(DATA, 'applications.md');
  const seen = new Set();
  if (!existsSync(f)) return seen;
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length < 4 || cols[0] === '#') continue;
    const company = cols[2].toLowerCase();
    const role    = cols[3].toLowerCase();
    if (company && role) seen.add(`${company}::${role}`);
  }
  return seen;
}

// ── Parse pipeline.md ─────────────────────────────────────────────────────────

function parsePending(alreadyEvaluated) {
  const f = join(DATA, 'pipeline.md');
  if (!existsSync(f)) return [];
  const pending = [];
  let skip = false;
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    if (/^## (Procesadas|Descartadas|Processed|Discarded)/.test(line)) skip = true;
    if (skip) continue;
    const m = line.match(/^- \[ \] (.+)/);
    if (!m) continue;
    const parts = m[1].split('|').map(s => s.trim());
    const key = `${(parts[1] || '').toLowerCase()}::${(parts[2] || '').toLowerCase()}`;
    if (alreadyEvaluated.has(key)) continue; // skip — already in applications.md
    pending.push({
      url:     parts[0] || '',
      company: parts[1] || '',
      role:    parts[2] || '',
      region:  parts[3] || '',
      date:    parts[4] || '',
      raw:     line,
    });
  }
  return pending;
}

// ── JD fetchers ───────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchWithTimeout(url, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'career-ops/1.0 (job research bot)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJD(job) {
  const { url, company, role } = job;

  try {
    // Greenhouse: job-boards.greenhouse.io/{board}/jobs/{id}
    const ghMatch = url.match(/(?:job-boards(?:\.eu)?\.greenhouse\.io|boards\.greenhouse\.io)\/([^/?#]+)\/jobs\/(\d+)/);
    if (ghMatch) {
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs/${ghMatch[2]}`;
      const res = await fetchWithTimeout(apiUrl);
      const data = await res.json();
      const content = data.content ? stripHtml(data.content) : '';
      return `${data.title || role}\n\n${content}`.substring(0, 6000);
    }

    // Lever: jobs.lever.co/{company}/{uuid}
    const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)\/([a-f0-9-]{36})/);
    if (leverMatch) {
      const apiUrl = `https://api.lever.co/v0/postings/${leverMatch[1]}/${leverMatch[2]}`;
      const res = await fetchWithTimeout(apiUrl);
      const data = await res.json();
      const desc = data.description ? stripHtml(data.description) : '';
      const lists = (data.lists || []).map(l => `${l.text}:\n${l.content ? stripHtml(l.content) : ''}`).join('\n');
      return `${data.text || role}\n\n${desc}\n${lists}`.substring(0, 6000);
    }

    // Ashby: jobs.ashbyhq.com/{org}/{uuid}
    const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([a-f0-9-]{36})/);
    if (ashbyMatch) {
      const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}/postings/${ashbyMatch[2]}`;
      const res = await fetchWithTimeout(apiUrl);
      const data = await res.json();
      const desc = data.descriptionHtml ? stripHtml(data.descriptionHtml) : (data.description || '');
      return `${data.title || role}\n\n${desc}`.substring(0, 6000);
    }

    // Fallback: just use what we have from pipeline.md
    return `${role} at ${company}\n\nURL: ${url}\n\n(Full JD unavailable — evaluate based on title and company context)`;
  } catch (err) {
    return `${role} at ${company}\n\nURL: ${url}\n\n(JD fetch failed: ${err.message})`;
  }
}

// ── Load candidate context ─────────────────────────────────────────────────────

function loadProfile() {
  const f = join(ROOT, 'config', 'profile.yml');
  return existsSync(f) ? yaml.load(readFileSync(f, 'utf-8')) : {};
}

function loadCV() {
  const f = join(ROOT, 'cv.md');
  return existsSync(f) ? readFileSync(f, 'utf-8') : '';
}

// ── Next available report number ──────────────────────────────────────────────

function nextTrackerNum() {
  const f = join(DATA, 'applications.md');
  if (!existsSync(f)) return 1;
  const lines = readFileSync(f, 'utf-8').split('\n').filter(l => l.startsWith('|'));
  let max = 0;
  for (const line of lines) {
    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length > 0) {
      const n = parseInt(cols[0]);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

// ── Claude API call ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional career advisor evaluating job-fit for a specific candidate.
Respond ONLY with a single valid JSON object. No markdown, no code fences, no explanation outside the JSON.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evaluateJob(job, jdText, cvContent, profile) {
  const candidate = profile.candidate || {};
  const name      = candidate.full_name || 'the candidate';

  const userMsg = `Evaluate this job posting for ${name} and return a JSON object.

## Candidate CV
\`\`\`
${cvContent.substring(0, 4000)}
\`\`\`

## Job Details
Company: ${job.company}
Role: ${job.role}
Region hint: ${job.region}
URL: ${job.url}

## Job Description
\`\`\`
${jdText}
\`\`\`

## Return this JSON schema (fill every field):
{
  "score": <number 1-10, overall fit>,
  "rationale": "<2-3 sentences on why this score>",
  "region": "<one of: EMEA-DE, EMEA-UK, EMEA-NL, EMEA-FR, MEA-AE, MEA-QA, SEA-SG, SEA-MY, other>",
  "template": "<cv-template-de.html for EMEA-DE roles, cv-template-dx.html for all other regions>",
  "paper_format": "<a4 or letter — use letter only for US/Canada, a4 for everything else>",
  "cover_letter": "<if score >= ${SCORE_THRESHOLD}: a 3-paragraph professional cover letter addressed to the hiring team; if score < ${SCORE_THRESHOLD}: null>",
  "summary_rewrite": "<if score >= ${SCORE_THRESHOLD}: a 2-sentence professional summary tailored to this JD using keywords from it; if score < ${SCORE_THRESHOLD}: null>",
  "competencies": <if score >= ${SCORE_THRESHOLD}: ["keyword1", "keyword2", ...] — 6 to 8 keyword phrases from the JD that match the candidate's skills; if score < ${SCORE_THRESHOLD}: null>
}

Scoring guide (1-10):
- 9-10: Exceptional match — candidate exceeds requirements, must apply
- 7-8: Strong match — meets core requirements, good application potential
- 5-6: Partial match — some gaps but worth considering
- 3-4: Weak match — significant skill gaps
- 1-2: Poor fit — very different domain or requirements`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      });
      const raw = response.content[0]?.text || '{}';
      try {
        return JSON.parse(raw.trim());
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]+\}/);
        if (jsonMatch) {
          try { return JSON.parse(jsonMatch[0]); } catch {}
        }
        console.warn(`  ⚠ JSON parse failed for ${job.company}, using defaults`);
        return { score: 0, rationale: 'Parse error', region: job.region, template: 'cv-template-dx.html', paper_format: 'a4' };
      }
    } catch (err) {
      const is429 = err.status === 429 || (err.message || '').includes('rate_limit');
      if (is429 && attempt < MAX_RETRIES) {
        const wait = 60_000 * attempt; // 60s, 120s
        console.warn(`  ⏳ Rate limited — waiting ${wait / 1000}s before retry ${attempt}/${MAX_RETRIES}...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

// ── CV HTML builder ───────────────────────────────────────────────────────────

function compileCVSection(cvMd, sectionHeader) {
  const lines = cvMd.split('\n');
  let inSection = false;
  const sectionLines = [];
  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(sectionHeader)) { inSection = true; continue; }
    if (inSection && line.startsWith('## ')) break;
    if (inSection) sectionLines.push(line);
  }
  return sectionLines.join('\n');
}

function mdExperienceToHtml(expMd) {
  const blocks = [];
  let current = null;

  for (const line of expMd.split('\n')) {
    // ### Company — Location
    const compMatch = line.match(/^### (.+?)\s*[—–-]+\s*(.+)/);
    if (compMatch) {
      if (current) blocks.push(current);
      current = { company: compMatch[1].trim(), location: compMatch[2].trim(), role: '', period: '', bullets: [] };
      continue;
    }
    if (!current) continue;

    // **Role Title** or __Role Title__
    const roleMatch = line.match(/^\*\*(.+?)\*\*$|^__(.+?)__$/);
    if (roleMatch && !current.role) { current.role = (roleMatch[1] || roleMatch[2]).trim(); continue; }

    // Date range line (e.g. Mar 2025 – Apr 2026)
    const dateMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present)\s+\d{4}.*)/);
    if (dateMatch && !current.period) { current.period = dateMatch[1].trim(); continue; }

    // Bullet
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      current.bullets.push(bulletMatch[1].trim()
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>'));
    }
  }
  if (current) blocks.push(current);

  return blocks.map(b => `
  <div class="job">
    <div class="job-header">
      <span class="job-company">${esc(b.company)}</span>
      <span class="job-period">${esc(b.period)}</span>
    </div>
    <div class="job-role">${esc(b.role)}</div>
    <div class="job-location">${esc(b.location)}</div>
    <ul>${b.bullets.map(bl => `<li>${bl}</li>`).join('\n      ')}</ul>
  </div>`).join('\n');
}

function mdEducationToHtml(eduMd) {
  const blocks = [];
  let current = null;
  for (const line of eduMd.split('\n')) {
    const degreeMatch = line.match(/^\*\*(.+?)\*\*/);
    if (degreeMatch) {
      if (current) blocks.push(current);
      current = { degree: degreeMatch[1], school: '', period: '', notes: [] };
      continue;
    }
    if (!current) continue;
    if (line.match(/^\d{4}/) || line.includes('–') || line.includes('–')) {
      current.period = line.trim();
    } else if (line.trim() && !line.startsWith('#')) {
      if (!current.school) current.school = line.trim();
      else current.notes.push(line.trim());
    }
  }
  if (current) blocks.push(current);
  return blocks.map(b => `
  <div class="edu-item">
    <div class="edu-header">
      <span class="edu-title">${esc(b.degree)}</span>
      <span class="edu-year">${esc(b.period)}</span>
    </div>
    <div class="edu-school">${esc(b.school)}</div>
  </div>`).join('\n');
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildCVHtml(profile, evaluation, cvContent) {
  const c    = profile.candidate || {};
  const isDE = evaluation.template === 'cv-template-de.html';
  const phone = isDE ? (c.phone_eu || c.phone_in || '') : (c.phone_in || c.phone_eu || '');

  const templateFile = join(TMPL, evaluation.template || 'cv-template-dx.html');
  let html = existsSync(templateFile)
    ? readFileSync(templateFile, 'utf-8')
    : readFileSync(join(TMPL, 'cv-template-dx.html'), 'utf-8');

  const expHtml  = mdExperienceToHtml(compileCVSection(cvContent, 'Experience'));
  const eduHtml  = mdEducationToHtml(compileCVSection(cvContent, 'Education'));

  const competencies = (evaluation.competencies || [])
    .map(k => `<span class="competency-tag">${esc(k)}</span>`)
    .join('\n      ');

  // Compile skills from cv.md Skills section
  const skillsMd  = compileCVSection(cvContent, 'Skills');
  const skillsHtml = skillsMd
    .split('\n').filter(l => l.match(/^[-*]\s/))
    .map(l => `<li>${esc(l.replace(/^[-*]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'))}</li>`)
    .join('\n    ') || '';

  // Certifications
  const certsMd  = compileCVSection(cvContent, 'Certifications');
  const certsHtml = certsMd
    .split('\n').filter(l => l.match(/^[-*]\s/))
    .map(l => `<li>${esc(l.replace(/^[-*]\s+/, ''))}</li>`)
    .join('\n    ') || '';

  const replacements = {
    '{{LANG}}':                 'en',
    '{{PAGE_WIDTH}}':           evaluation.paper_format === 'letter' ? '8.5in' : '210mm',
    '{{NAME}}':                 esc(c.full_name || 'Vilol Joshi'),
    '{{PHONE}}':                esc(phone),
    '{{EMAIL}}':                esc(c.email || ''),
    '{{LINKEDIN_URL}}':         esc(c.linkedin_url || ''),
    '{{LINKEDIN_DISPLAY}}':     esc(c.linkedin_display || c.linkedin_url || ''),
    '{{PORTFOLIO_URL}}':        esc(c.portfolio_url || ''),
    '{{PORTFOLIO_DISPLAY}}':    esc(c.portfolio_url || ''),
    '{{LOCATION}}':             esc(c.location || 'Mumbai, India · Open to Relocation'),
    '{{SECTION_SUMMARY}}':      'Professional Summary',
    '{{SUMMARY_TEXT}}':         esc(evaluation.summary_rewrite || ''),
    '{{SECTION_COMPETENCIES}}': 'Core Competencies',
    '{{COMPETENCIES}}':         competencies,
    '{{SECTION_EXPERIENCE}}':   'Work Experience',
    '{{EXPERIENCE}}':           expHtml,
    '{{SECTION_PROJECTS}}':     'Projects',
    '{{PROJECTS}}':             '',
    '{{SECTION_EDUCATION}}':    'Education',
    '{{EDUCATION}}':            eduHtml,
    '{{SECTION_CERTIFICATIONS}}': 'Certifications',
    '{{CERTIFICATIONS}}':       certsHtml ? `<ul>${certsHtml}</ul>` : '',
    '{{SECTION_SKILLS}}':       'Skills',
    '{{SKILLS}}':               skillsHtml ? `<ul>${skillsHtml}</ul>` : '',
  };

  for (const [key, val] of Object.entries(replacements)) {
    html = html.split(key).join(val);
  }
  return html;
}

// ── Pipeline + applications update ───────────────────────────────────────────

function markPipelineProcessed(processedRaws) {
  const f = join(DATA, 'pipeline.md');
  if (!existsSync(f) || processedRaws.length === 0) return;
  const rawSet = new Set(processedRaws);
  const lines  = readFileSync(f, 'utf-8').split('\n');
  const updated = lines.map(line =>
    rawSet.has(line) ? line.replace('- [ ] ', '- [x] ') : line
  );
  writeFileSync(f, updated.join('\n'), 'utf-8');
}

function appendToApplications(result, trackerNum, date) {
  const f = join(DATA, 'applications.md');
  if (!existsSync(f)) {
    writeFileSync(f,
      '# Applications Tracker\n\n| # | Date | Company | Role | Score | Region | Status | CV | Cover | Report | Notes |\n|---|------|---------|------|-------|--------|--------|----|-------|--------|-------|\n',
      'utf-8'
    );
  }
  const score   = result.evaluation.score?.toFixed(1) ?? '';
  const region  = result.evaluation.region || result.job.region || '';
  const cvPath  = result.pdfPath  ? result.pdfPath.replace(ROOT + '/', '')  : '';
  const covPath = result.coverPath ? result.coverPath.replace(ROOT + '/', '') : '';
  const repPath = result.reportPath ? result.reportPath.replace(ROOT + '/', '') : '';
  const row = `| ${trackerNum} | ${date} | ${result.job.company} | ${result.job.role} | ${score} | ${region} | evaluated | ${cvPath} | ${covPath} | ${repPath} | |\n`;
  appendFileSync(f, row, 'utf-8');
}

// ── Report writer ─────────────────────────────────────────────────────────────

function writeReport(result, reportNum, date) {
  const slug  = result.job.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const fname = `${reportNum}-${slug}-${date}.md`;
  const path  = join(REP, fname);
  const ev    = result.evaluation;
  const content = `# Evaluation: ${result.job.company} — ${result.job.role}

**Date:** ${date}
**Score:** ${ev.score ?? 'N/A'}/10
**Region:** ${ev.region || result.job.region}
**Template:** ${ev.template || 'N/A'}
**URL:** ${result.job.url}

---

## Fit Rationale

${ev.rationale || ''}

## Keywords / Competencies

${(ev.competencies || []).join(', ') || 'N/A'}
`;
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  CareerOps — Batch API Evaluator     ║');
  console.log(`║  Model: ${MODEL}        ║`);
  console.log(`║  Threshold: ${SCORE_THRESHOLD}+  DryRun: ${DRY_RUN}     ║`);
  console.log('╚══════════════════════════════════════╝\n');

  const profile          = loadProfile();
  const cvContent        = loadCV();
  const alreadyEvaluated = loadEvaluatedKeys();
  let pending            = parsePending(alreadyEvaluated).slice(0, MAX_JOBS);

  if (alreadyEvaluated.size > 0) {
    console.log(`⏭  Skipping ${alreadyEvaluated.size} already-evaluated jobs (found in applications.md)\n`);
  }

  if (pending.length === 0) {
    console.log('✓ Pipeline is empty — nothing to evaluate.');
    return;
  }
  console.log(`📋 ${pending.length} pending jobs to evaluate\n`);

  const today   = new Date().toISOString().slice(0, 10);
  const results = [];
  let trackerNum = nextTrackerNum();
  const eta = Math.ceil(pending.length * DELAY_MS / 60_000);
  console.log(`⏱  Sequential mode — 1 job every ${DELAY_MS / 1000}s → ~${eta} min total\n`);

  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    process.stdout.write(`[${i + 1}/${pending.length}] ${job.company} — ${job.role}...`);

    const jdText     = await fetchJD(job);
    process.stdout.write(' fetched → evaluating...');
    const evaluation = await evaluateJob(job, jdText, cvContent, profile);
    const score      = evaluation.score ?? 0;
    const marker     = score >= SCORE_THRESHOLD ? '🟢' : score >= 5 ? '🟡' : '🔴';
    console.log(` ${marker} ${score.toFixed(1)}`);
    results.push({ job, jdText, evaluation });

    // Rate limit buffer — skip delay after last job
    if (i < pending.length - 1 && !DRY_RUN) await sleep(DELAY_MS);
  }

  // Summary + decide which to process further
  console.log('\n\n══ Results Summary ═══════════════════════');
  const qualified = results.filter(r => (r.evaluation.score ?? 0) >= SCORE_THRESHOLD);
  const rejected  = results.filter(r => (r.evaluation.score ?? 0) < SCORE_THRESHOLD);
  console.log(`  🟢 Score ≥ ${SCORE_THRESHOLD}: ${qualified.length} jobs`);
  console.log(`  🔴 Score < ${SCORE_THRESHOLD}: ${rejected.length} jobs\n`);
  qualified.forEach(r => console.log(`  → ${r.job.company} — ${r.job.role}  (${r.evaluation.score?.toFixed(1)})`));

  if (DRY_RUN) {
    console.log('\n⚠ --dry-run: no files written');
    return;
  }

  // Write reports + cover letters + CVs for all jobs
  const processedRaws = [];

  for (const result of results) {
    const ev         = result.evaluation;
    const slug       = result.job.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const reportNum  = String(trackerNum).padStart(3, '0');

    // Report .md for all scored jobs
    result.reportPath = writeReport(result, reportNum, today);

    if ((ev.score ?? 0) >= SCORE_THRESHOLD) {
      // Cover letter
      if (ev.cover_letter) {
        const coverPath  = join(OUT, `cover-${slug}-${today}.txt`);
        writeFileSync(coverPath, ev.cover_letter, 'utf-8');
        result.coverPath = coverPath;
      }

      // CV HTML → PDF
      if (ev.summary_rewrite && ev.competencies) {
        const htmlPath = join(OUT, `cv-${slug}-${today}.html`);
        const pdfPath  = join(OUT, `cv-${slug}-${today}.pdf`);
        const cvHtml   = buildCVHtml(profile, ev, cvContent);
        writeFileSync(htmlPath, cvHtml, 'utf-8');

        process.stdout.write(`  Generating PDF for ${result.job.company}...`);
        const r = spawnSync('node', [
          join(ROOT, 'generate-pdf.mjs'),
          htmlPath,
          pdfPath,
          `--format=${ev.paper_format || 'a4'}`,
        ], { cwd: ROOT, encoding: 'utf-8' });

        if (r.status === 0) {
          result.pdfPath = pdfPath;
          console.log(' ✓');
        } else {
          console.log(' ✗ (PDF failed — HTML saved)');
          result.pdfPath = htmlPath;
        }
      }
    }

    // Update tracker
    appendToApplications(result, trackerNum, today);
    processedRaws.push(result.job.raw);
    trackerNum++;
  }

  // Mark pipeline entries as processed
  markPipelineProcessed(processedRaws);
  console.log(`\n✓ Marked ${processedRaws.length} pipeline entries as processed`);

  // Regenerate static JSON
  console.log('  Regenerating data/jobs.json + data/pipeline.json...');
  const gen = spawnSync('node', [join(ROOT, 'generate-data.mjs')], {
    cwd: ROOT, encoding: 'utf-8',
  });
  if (gen.status === 0) console.log('  ' + (gen.stdout || '').trim().split('\n').join('\n  '));

  console.log('\n✅ Batch evaluation complete!');
  console.log(`   Reports  → reports/`);
  console.log(`   CVs      → output/cv-*.pdf`);
  console.log(`   Covers   → output/cover-*.txt`);
  console.log(`   Tracker  → data/applications.md`);
  console.log('\nPush to GitHub → dashboard updates automatically.\n');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
