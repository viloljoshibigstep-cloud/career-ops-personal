# Mode: pdf — Tailored CV Generation

## Reference designs
Visual reference PDFs (do not modify these — use only as design reference):
- `templates/ref-cv-de.pdf` — CV_DE layout (Germany / EMEA-DE)
- `templates/ref-cv-dx.pdf` — CV_DX layout (all other regions)

## ━━ ABSOLUTE RULES — NO EXCEPTIONS ━━

1. **ZERO hallucination.** Every bullet, metric, date, company, skill must exist verbatim or be a direct reformulation of content already in `cv.md`. If a JD asks for a skill Vilol does not have, do NOT add it. Do NOT invent new metrics, projects, or responsibilities.
2. **Reformulation is allowed; fabrication is not.** You may reframe existing experience using JD vocabulary (e.g. "RAG pipelines" when cv.md says "retrieval workflows"). You may NOT claim experiences that do not exist.
3. **Preserve all real metrics exactly.** These numbers are non-negotiable and must never be altered:
   - 45% (compliance review reduction — Solytics)
   - €15M (enterprise sales pipeline — Solytics)
   - 65% (UDF adoption increase — Solytics)
   - 25% (API turnaround reduction — Solytics)
   - 54M+ (AI music creations — Ogilvy)
   - 9% (revenue uplift — Ogilvy)
   - 35% (reporting effort reduction — Ogilvy)
   - 70% (manual ops reduction — Schbang)
   - 50K+ (KYC/AML documents/month — Schbang)
   - +18% / 12% (conversion / churn — Schbang)
   - 34% (TTM reduction — Schbang)
   - 40+ hours/month (SEB automation)
   - 40–80K leads / 70% faster closures (Lead Enrichment project)
   - +60% / +25% (insurance app KPIs)
4. **No new sections.** Do not add skills, tools, or sections not in cv.md.
5. **Dates are fixed.** Do not change any employment dates.

## Template selection

| Job region | Template to use |
|---|---|
| EMEA-DE (Germany) | `templates/cv-template-de.html` |
| All other regions (EMEA-UK, EMEA-NL, EMEA-FR, MEA-AE, MEA-QA, SEA-SG, SEA-MY) | `templates/cv-template-dx.html` |

## Full pipeline

1. Read `cv.md` — this is the single source of truth
2. Get the JD (from context or URL)
3. Extract 15–20 keywords from the JD
4. Detect job region → select template (see table above)
5. Set `{{PAGE_WIDTH}}` = `210mm` (A4) for all regions
6. Set `{{LANG}}` = `en` (default); `de` only if JD is entirely in German
7. Build photo HTML (see Photo section below)
8. Tailor content (see Tailoring section below)
9. Render HTML from the selected template, replacing all `{{PLACEHOLDERS}}`
10. Write HTML to `/tmp/cv-vilol-joshi-{company-slug}-{YYYY-MM-DD}.html`
11. Execute: `node generate-pdf.mjs /tmp/cv-vilol-joshi-{company-slug}-{YYYY-MM-DD}.html output/cv-vilol-joshi-{company-slug}-{YYYY-MM-DD}.pdf --format=a4`
12. Report: output path, page count, keyword coverage %

## Photo handling

Check `config/profile.yml` for `photo_path`. If the file exists at that path:
```html
<img src="{photo_path}" class="header-photo" alt="">
```
If `photo_path` is not set or file does not exist:
```html
<div class="header-photo-placeholder"></div>
```

## Tailoring rules (what is allowed)

### Professional Summary (CV_DX only — `{{SUMMARY_TEXT}}`)
- Rewrite 3–4 sentences using JD keywords, referencing real experience from cv.md
- Always include at least 2 real metrics
- Mirror JD language (e.g. "AI-first", "agentic workflows", "human-in-the-loop")
- End with a location/context sentence (e.g. "Seeking AI PM roles in [region]'s growing tech ecosystem")
- **Never claim experiences that don't exist in cv.md**

### Core Competencies / Key Strengths
- Select the 4–6 most relevant from cv.md's competency list
- Rewrite the description paragraph to front-load JD vocabulary
- **Keep all real metrics intact — only reframe the surrounding text**

### Experience bullets
- Reorder bullets within each job to put the most JD-relevant first
- May reframe using JD vocabulary (e.g. "product roadmapping" when cv.md says "product planning")
- **Never add bullets, metrics, or responsibilities not in cv.md**

### Projects
- Select 2–3 most relevant from the 3 projects in cv.md
- May reorder bullets within a project
- **Never invent project outcomes or KPIs**

### Technical Skills
- Keep all skill categories and items from cv.md
- May reorder categories to put most-JD-relevant first
- **Never add skills not in cv.md**

## Placeholder reference — cv-template-de.html

| Placeholder | Content |
|---|---|
| `{{LANG}}` | `en` or `de` |
| `{{PAGE_WIDTH}}` | `210mm` |
| `{{NAME}}` | Vilol Joshi |
| `{{LOCATION}}` | Berlin, Germany · Open to relocation |
| `{{PHONE_DE}}` | +37125670263 (EU number — always use for DE/EMEA CVs) |
| `{{EMAIL}}` | viloljoshi10@gmail.com |
| `{{PORTFOLIO_URL}}` | https://www.linkedin.com/in/viloljoshi (until portfolio URL is set) |
| `{{LINKEDIN_URL}}` | https://www.linkedin.com/in/viloljoshi |
| `{{PHOTO_HTML}}` | `<img>` tag or placeholder div (see Photo section) |
| `{{EXPERIENCE}}` | `.job` divs — company, role, dates, bullets (see HTML structure below) |
| `{{PROJECTS}}` | `.project` divs — title + bullets |
| `{{EDUCATION}}` | `.edu-item` divs |
| `{{CORE_COMPETENCIES}}` | `.competency` divs — bold title + paragraph |
| `{{LANGUAGES_DE}}` | `.lang-item` divs for English, Spanish, German |
| `{{CERTIFICATIONS_LIST}}` | `<li>` items |
| `{{SKILLS}}` | `.skill-category` + `.skill-list` divs |

## Placeholder reference — cv-template-dx.html

| Placeholder | Content |
|---|---|
| `{{LANG}}` | `en` |
| `{{PAGE_WIDTH}}` | `210mm` |
| `{{NAME}}` | Vilol Joshi |
| `{{HEADLINE}}` | Technical AI Product Manager · {role domain from JD} |
| `{{LOCATION}}` | Berlin, Germany (Open to Relocation) |
| `{{PHONE_DX}}` | +917410152053 (Indian number — use for MEA/SEA CVs) |
| `{{EMAIL}}` | viloljoshi10@gmail.com |
| `{{PORTFOLIO_URL}}` | https://www.linkedin.com/in/viloljoshi |
| `{{LINKEDIN_URL}}` | https://www.linkedin.com/in/viloljoshi |
| `{{PHOTO_HTML}}` | `<img>` tag or placeholder div |
| `{{SUMMARY_TEXT}}` | Tailored 3–4 sentence summary with JD keywords (see rules above) |
| `{{EXPERIENCE}}` | `.job` divs — company, role, dates, `.job-bullets` (see below) |
| `{{PROJECTS}}` | `.project` divs — title + `.project-bullets` |
| `{{EDUCATION}}` | `.edu-item` divs |
| `{{KEY_STRENGTHS}}` | `.strength` divs — bold title + short paragraph |
| `{{LANGUAGES_DX}}` | `.lang-item` divs |
| `{{CERTIFICATIONS_LIST}}` | `<li>` items |
| `{{SKILLS}}` | `.skill-category` + `.skill-list` divs |

## HTML structure for experience (both templates)

### cv-template-de.html jobs
```html
<div class="job">
  <div class="job-header">
    <span class="job-company">Company Name</span>
    <span class="job-location-inline">, Location</span>
  </div>
  <div class="job-role-row">
    <span class="job-role">Role Title</span>
    <span class="job-dates">Mon YYYY – Mon YYYY</span>
  </div>
  <ul>
    <li>Bullet one (most JD-relevant first)</li>
    <li>Bullet two</li>
  </ul>
</div>
```

### cv-template-dx.html jobs (arrow bullets)
```html
<div class="job">
  <div class="job-header-row">
    <div>
      <span class="job-company">Company Name</span>
      <span class="job-location-inline"> — Location</span>
    </div>
    <span class="job-dates">Mon YYYY – Mon YYYY</span>
  </div>
  <div class="job-role">Role Title</div>
  <ul class="job-bullets">
    <li>Bullet one (most JD-relevant first)</li>
    <li>Bullet two</li>
  </ul>
</div>
```

## HTML structure for core competencies (cv-template-de.html)
```html
<div class="competency">
  <div class="competency-title">Category Title</div>
  <div class="competency-text">Description paragraph with real metrics.</div>
</div>
```

## HTML structure for key strengths (cv-template-dx.html)
```html
<div class="strength">
  <div class="strength-title">Category Title</div>
  <div class="strength-text">Short description with real metric.</div>
</div>
```

## HTML structure for education (both templates)
```html
<div class="edu-item">
  <div class="edu-school">Riga Technical University</div>
  <div class="edu-degree-row">
    <span class="edu-degree">M.Sc. in Business Informatics Sciences</span>
    <span class="edu-meta">Riga, Latvia</span>
  </div>
</div>
```

## HTML structure for skills (both templates)
```html
<div class="skill-category">Gen-AI &amp; Agentic Systems</div>
<div class="skill-list">LLM Application Design, Agentic Workflows, ...</div>
<div class="skill-category">AI Evaluation &amp; Reliability</div>
<div class="skill-list">Golden Dataset Evaluation, ...</div>
```

## Final check before generating PDF

Before executing `node generate-pdf.mjs`, verify:
- [ ] Every metric matches the values in cv.md exactly
- [ ] No experience, project, or skill was added that doesn't exist in cv.md
- [ ] All bullet points are present (none accidentally omitted)
- [ ] Correct phone number used (EU +37125670263 for DE/EMEA, IN +917410152053 for MEA/SEA)
- [ ] Correct template used for the region
- [ ] Dates are unchanged from cv.md
