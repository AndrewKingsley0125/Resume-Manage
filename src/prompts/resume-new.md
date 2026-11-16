# MASTER SOFTWARE ENGINEER RESUME-GENERATION PROMPT

## 1. TASK AND CANDIDATE PROFILE

Generate a highly tailored, ATS-friendly US software engineering resume based on the candidate profile and complete job description (JD). Produce a technically credible, senior-level resume emphasizing specific projects, architecture, ownership, engineering scale, measurable accomplishments, and JD alignment.

Complete the entire process independently without requesting additional information or clarification.

### Candidate Profile

{{CANDIDATE_PROFILE}}

Preserve employer names, dates, education, and career progression. Order experience by end date, newest first. Calculate years of experience without double-counting overlapping employment. Align functional role titles to the JD without inventing promotions or management authority. The top-level resume `title` and the most recent employer's `experience[0].title` must share a consistent core role, seniority, and supported specialization. Preserve the supplied employer title; tailor the resume headline to the JD only within the scope supported by that title and the demonstrated work. Exact wording may differ, but do not imply a different career track, higher seniority, or unsupported management authority. Validate these two fields together rather than generating them independently.

## 2. JOB ELIGIBILITY

Analyze the entire JD before generating the resume.

Reject positions requiring:
- Security clearance.
- Mandatory onsite or hybrid work without a fully remote option.

Accept fully remote positions, unspecified work arrangements, occasional travel, and preferred rather than required clearance.

For an ineligible position, return only:

`{"error":"The position requires security clearance."}`

or

`{"error":"The position requires onsite or hybrid work without a fully remote option."}`

Combine both reasons if applicable.

## 3. JD ANALYSIS AND COMPANY RESEARCH

Identify all required and preferred technical skills, engineering responsibilities, domain knowledge, collaboration expectations, and leadership requirements.

Prioritize central JD requirements while preserving the candidate's experience and seniority.

Research official employer information when available to identify historically appropriate engineering teams, projects, products, technologies, and business context. Distinguish company-level information from the candidate's personal accomplishments.

When exact project details are unavailable, develop technically realistic proposed project narratives consistent with each employer, employment period, role, and JD. Do not treat proposed personal experience as verified historical fact.

Ensure each employer has a distinct technical story rather than repeating similar projects across companies.

Keep research and analysis internal.

## 4. PROFESSIONAL SUMMARY

Write exactly four connected sentences, approximately 60–80 words.

Communicate:
1. Engineering seniority, completed years of experience, and JD-relevant specialization.
2. Architecture ownership, technical leadership, and engineering complexity.
3. Core technologies, hands-on engineering expertise, and production experience.
4. Technical accomplishments and value delivered to products, platforms, or engineering teams.

Use natural American professional English. Avoid generic self-promotion, excessive keywords, and career objectives.

## 5. TECHNICAL SKILLS

Create approximately 6–8 logically organized categories aligned with the JD.

Include relevant programming languages, frameworks, cloud technologies, databases, architecture patterns, infrastructure, development practices, and specialized tools.

- Prioritize required skills before preferred skills.
- Include only technologies consistent with the candidate's experience.
- Avoid duplicated or unrelated skills.
- Use individual skill strings within each category.
- Make **Soft Skills** the final category, with up to 5–6 relevant capabilities.
- Demonstrate important listed skills through actual experience contributions.

## 6. PROFESSIONAL EXPERIENCE

Create one experience object per employer.

Each role must contain `company`, `title`, `overview`, `sentences`, and `technologies`.

Build a coherent engineering narrative showing what the team developed, what the system did, what the candidate owned, how it was implemented, and what was accomplished.

### A. Role Overview — Team, Project, Ownership, and Accomplishment

Write exactly two connected sentences (45–65 words) for each employer. The first sentence must identify the **specific engineering team**, **named project**, and clearly explain what the project does, who uses it, and its purpose. The second sentence must describe the candidate's **specific technical ownership and primary accomplishment**, including at least one meaningful quantitative metric demonstrating engineering scale, delivered capability, or measurable impact. Use concrete technologies and engineering responsibilities appropriate to the role and seniority. Avoid vague project descriptions, generic achievements, and repeating contribution bullets. Every overview must clearly communicate **team, project, functionality, ownership, and quantified accomplishment**.

### B. Engineering Contribution Bullets

Write technically detailed, accomplishment-oriented bullets following:

**Engineering action + specific technical ownership + implementation approach + measurable result.**

Each bullet must explain a distinct contribution and demonstrate meaningful engineering responsibility, implementation complexity, or technical decision-making.

Include:
- Concrete services, systems, components, or features delivered.
- Relevant architecture, technologies, algorithms, or engineering practices.
- Important technical challenges, design decisions, or trade-offs where appropriate.
- Production-scale accomplishments, operational improvements, or measurable outcomes.
- Collaboration, mentoring, or cross-team influence when relevant.

Prefer approximately 25–40 words per bullet.

**Bullet Allocation**
- Most recent role: approximately 7 bullets.
- Intermediate roles: allocate according to relevance, duration, and responsibility.
- Earlier roles: approximately 2–3 bullets.

Show increasing technical ownership and seniority across the career. Avoid generic responsibilities, repeated accomplishments, and unsupported organization-wide ownership.

### C. Engineering Metrics and Quantification

Include meaningful quantitative metrics in **every employer overview and at least 80% of contribution bullets**, aiming for 5–6 quantified bullets in recent senior-level roles and 2–3 in earlier roles. Automatically select diverse metrics appropriate to each project's technical responsibilities, including services, APIs, integrations, transactions, requests, data volumes, models, GPUs, infrastructure scale, users, adoption, reliability, performance, cost, and business impact. Prioritize concrete engineering scale, architectural complexity, technical ownership, and measurable accomplishments rather than relying mainly on percentages or time savings. Integrate one or two complementary metrics naturally into quantified bullets, connecting them to implementation and results. Where actual measurements are unavailable, use realistic, seniority-appropriate illustrative estimates grounded in the employer and project context, and identify them as estimates rather than verified achievements. During final review, count quantified overviews and bullets, and revise any role that fails these coverage requirements.

### D. Technologies Per Role

List technologies directly supported by each role's overview and contributions.

- Recent roles: approximately 6–12 technologies.
- Earlier roles: approximately 3–8 technologies.
- Order by relevance and importance.
- Avoid duplicates, irrelevant keywords, and technologies absent from the experience narrative.

## 7. WRITING AND FORMATTING

Use clear, natural, technically specific American professional English.

- Write accomplishments in active voice and appropriate tense.
- Use precise engineering terminology without excessive jargon.
- Demonstrate seniority through architectural decisions, ownership, technical challenges, and outcomes.
- Avoid vague phrases, promotional language, repetitive verbs, and keyword stuffing.
- Maintain consistency between overview, bullets, and technologies.
- Keep the resume suitable for approximately two pages.

### Keyword Highlighting

Use balanced `**` markers only inside the JSON string values for `summary`, each employer's `overview`, and each contribution in `sentences`. Include the literal markers in the JSON even when it is displayed in a code block; the downstream resume renderer must interpret them as bold.

Apply these mandatory highlighting rules:

- Bold every meaningful engineering metric wherever it occurs in these fields, including the number, unit, and necessary qualifier as one complete phrase, such as `**20 million requests per day**`, `**99.99% availability**`, or `**an estimated 30% reduction**`. Preserve estimate labels. Do not bold employment dates or years of experience merely because they contain numbers.
- Identify a concise priority set of central JD technologies and engineering concepts during JD analysis. Bold their first occurrence in the summary and their first occurrence within each employer's overview and contributions, when present. Do not add keywords solely to meet highlighting requirements.
- Bold each team name and project name on its first occurrence in the employer's overview.
- Selectively bold meaningful architecture, ownership, and leadership capabilities when they add useful emphasis. Prioritize required metric and keyword highlighting over this optional emphasis.
- Keep spans short and specific. Do not bold entire sentences, generic action verbs, unrelated terms, or repeated occurrences of the same keyword within an employer unless needed for a complete metric phrase.

Do not apply Markdown formatting to company names, titles, skills, technologies, or education.

Before final output, inspect every eligible string: verify that every meaningful metric is enclosed in a complete bold span, required first occurrences of priority keywords and team/project names are highlighted, all `**` markers are paired without nesting, and no prohibited field contains formatting. Repair missing or malformed highlighting without changing the other content requirements.

### Narrative Consistency

The summary establishes the candidate's overall professional identity. Each overview explains the team, project, purpose, ownership, and quantified accomplishment. Contribution bullets provide the technical implementation and supporting achievements. Technologies summarize the actual stack.

Avoid repeating identical details across sections.

## 8. MANDATORY THREE-PASS REVIEW

Before generating the final output, internally evaluate JD alignment using this fixed 100-point rubric:

| Evaluation Category | Points |
|---|---:|
| Required technical skills and qualifications | 35 |
| Core responsibilities and relevant experience | 30 |
| Preferred skills and domain knowledge | 15 |
| Leadership and interpersonal capabilities | 10 |
| Resume structure, clarity, and compliance | 10 |

Allocate points according to JD importance without double-counting requirements. Treat scores as internal estimates, not actual employer ATS results.

### Iteration 0 — Initial Draft

Generate the complete resume and calculate the initial JD alignment score.

### Iteration 1 — Requirements and Content

Review required skills, responsibilities, technical depth, seniority, leadership, project relevance, and accomplishment quality.

Verify that every overview explicitly communicates the team, named project, project functionality, candidate ownership, and a quantified accomplishment.

Revise gaps and recalculate the score.

### Iteration 2 — Technical and Metric Quality

Review engineering plausibility, employer context, architectural complexity, implementation detail, technology consistency, and ownership boundaries.

**Count quantified overviews and contribution bullets.** Ensure every overview contains a meaningful metric and at least 80% of bullets contain appropriate quantitative evidence. Check that metrics cover diverse dimensions of engineering scale and are not dominated by percentages or time savings.

Correct inconsistencies and recalculate the score.

### Iteration 3 — Final Validation

Review the complete resume again for:
- Comprehensive JD coverage.
- Specific and coherent project narratives.
- Clear individual ownership and senior-level accomplishments.
- Required metric coverage and meaningful metric diversity.
- Distinct, technically substantial contribution bullets.
- Consistency between summary, overview, bullets, and technologies.
- Accurate employment chronology, education, and professional seniority.
- Clear writing, keyword highlighting, and valid JSON.

Revise remaining issues and calculate the final score.

### Completion Requirements

- Perform all three review passes.
- Aim for an internal alignment score above 95/100.
- Continue meaningful revisions when necessary, without manufacturing qualifications or artificially inflating scores.
- Preserve technical plausibility and distinguish proposed details from verified facts.
- Keep research notes, internal analysis, and detailed review commentary out of the final response.

## 9. REQUIRED JSON OUTPUT

For eligible positions, return exactly these top-level fields:

```json
{
  "company": "Hiring company",
  "title": "JD-aligned resume title",
  "summary": "Four connected sentences with selective **keyword highlighting**.",
  "skills": [
    {
      "Languages": ["Python", "Go"]
    },
    {
      "Cloud & Infrastructure": ["AWS", "Kubernetes"]
    },
    {
      "Soft Skills": [
        "Technical Leadership",
        "Cross-functional Collaboration",
        "Problem Solving"
      ]
    }
  ],
  "experience": [
    {
      "company": "Exact employer name",
      "title": "JD-aligned functional role title",
      "overview": "First sentence identifies the **Team Name**, **Project Name**, and actual project functionality. Second sentence explains specific technical ownership and a **quantified accomplishment**.",
      "sentences": [
        "Technically detailed accomplishment with concrete implementation and **measurable engineering scale**.",
        "Distinct engineering contribution with specific ownership, technologies, and **quantified impact**."
      ],
      "technologies": [
        "Python",
        "Kubernetes",
        "PostgreSQL"
      ]
    }
  ],
  "education": [
    {
      "degree": "Complete supplied education information"
    }
  ]
}
```

### JSON Rules

1. Use exactly the top-level keys `company`, `title`, `summary`, `skills`, `experience`, and `education`.
2. Include one experience object per employer, ordered by employment end date, newest first.
3. Every experience object must contain exactly `company`, `title`, `overview`, `sentences`, and `technologies`.
4. Represent skills as category objects containing arrays of individual skill strings.
5. Preserve all supplied education details.
6. Use valid JSON with double-quoted strings and no trailing commas.
7. Do not include extra fields, comments, contact details, or additional JSON objects.

### Final Response Format

First display the completed iteration scores:

Iterate 0: ATS Alignment Score — [score]/100  
Iterate 1: ATS Alignment Score — [score]/100  
Iterate 2: ATS Alignment Score — [score]/100  
Iterate 3: ATS Alignment Score — [score]/100

If the final score remains at or below 95, briefly identify the unresolved limitations.

Then provide the final revised resume in a single valid JSON code block.

Do not output intermediate drafts, research notes, detailed explanations, or review commentary.

For ineligible positions, return only the applicable eligibility error JSON.

---

## JOB DESCRIPTION

[PASTE THE JOB DESCRIPTION HERE]
