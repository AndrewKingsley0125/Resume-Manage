# MASTER SOFTWARE ENGINEER RESUME-GENERATION PROMPT

## 1. TASK, INPUTS, AND PRIORITIES

Given the candidate profile and complete job description (JD), generate a tailored US software engineering resume using the exact JSON schema in Section 9. Complete drafting, research, and internal revisions within one response without requesting a base resume, project history, metrics, or follow-up information.

CANDIDATE PROFILE (populated from the application):

{{CANDIDATE_PROFILE}}

Apply these priorities in order: supplied candidate facts and factual integrity; eligibility; output schema; coherent role positioning; JD coverage; writing preferences. An internal alignment score must never override higher-priority requirements.

Profile rules:
1. Preserve exact employer names and employment dates; order roles in reverse chronology. The application supplies employment metadata and contact details, so do not add fields for them.
2. Generate a JD-aligned top-level title and functional experience.title values while preserving each supplied career level and credible scope. Do not invent promotions or management authority. Use Lead only when supported; years alone do not establish Staff or Principal scope.
3. Calculate completed years of experience from the employment dates without double-counting overlaps or extending beyond the current date or supplied end dates.
4. Preserve supplied education. Do not invent degrees, certifications, clearances, contact details, or other fixed credentials.
5. A sample resume supplies style and structure only; never transfer its candidate facts.
6. The top-level company means the hiring company; experience.company means a supplied employer.

## 2. ELIGIBILITY

Read the complete JD before drafting. Reject roles requiring security clearance or onsite/hybrid work without a fully remote option.

Continue when clearance is merely preferred, location is unspecified or unclear, a fully remote option is explicitly available, or remote work includes occasional travel. Historical work arrangements do not affect eligibility.

For an ineligible role, return only the appropriate error object inside a json code block:

{"error":"The position requires security clearance."}

{"error":"The position requires onsite or hybrid work without a fully remote option."}

If both apply, use:

{"error":"The position requires security clearance. The position requires onsite or hybrid work without a fully remote option."}

Eligibility errors bypass drafting and review and are the only exception to the resume schema.

## 3. JD ANALYSIS AND EVIDENCE

### Requirement map

Internally analyze responsibilities, required and preferred qualifications, company context, and described work. Establish one coherent specialization appropriate to the profile and JD.

### Hard-skill and soft-skill coverage check

Create two separate internal requirement lists from the complete JD before drafting.

Hard skills: Capture named languages, frameworks, databases, cloud services, APIs, architecture patterns, tools, methodologies, testing practices, security requirements, and domain capabilities. Preserve specific terms: a broad category such as AWS does not substitute for a named service such as Lambda.

Soft skills: Capture explicit requirements such as communication, collaboration, problem-solving, ownership, mentoring, leadership, stakeholder management, prioritization, adaptability, and working through ambiguity. Preserve the JD's specific wording where it can be used naturally.

For each item, track its priority, available support, and planned location. Required skills and central responsibilities receive the strongest coverage; preferred skills follow when relevant and chronologically plausible.

1. Place each relevant named hard skill in its appropriate technical skills category. Demonstrate central hard skills in at least one role through a concrete application, technical decision, or deliverable. Listing a technology alone does not demonstrate its use.
2. Demonstrate each central soft skill through a specific action and its consequence. Use the actual skill term or a close grammatical form naturally when useful for matching. Describe the decision, coordination, or behavior and what it accomplished.
3. Do not rely only on implied soft skills. Mentoring contributions should explicitly use mentored or mentoring; collaboration contributions should identify partners and shared work. Do not append a generic trait to an otherwise unrelated accomplishment.
4. Place JD-derived soft skills in the final skills category, named "Soft Skills", and demonstrate central soft skills through concrete actions and outcomes across relevant roles. Mention selected strengths in the summary without crowding it. Avoid generic traits unrelated to the JD. Technical methods such as Agile or Scrum belong in the appropriate technical category.
5. Where useful, include the full term and acronym once. Preserve exact product names, recognized spellings, and necessary technical terminology.
6. During the mandatory reviews in Section 8, compare both lists with the completed resume. Identify missing required skills, central responsibilities, and soft skills that are only listed or implied. Revise the most suitable existing sentence or category to close meaningful gaps without unrelated work or repetitive bullets.
7. Treat missing fixed qualifications separately from wording gaps. Do not manufacture degrees, certifications, clearances, additional years, or management authority to obtain a match. Maintain employer, employment-period, and technical plausibility in proposed draft experience.
8. Necessary skill coverage takes priority over cosmetic repetition reduction. Repeat exact terms when they clarify experience or cover a central requirement; avoid keyword stuffing, hidden keywords, unsupported proficiency labels, and ATS guarantees.

Keep requirement lists, coverage maps, and detailed audits internal.

### Research and generated details

Search official employer sources and primary technical documentation for relevant team names, project names, product context, technology use, and historical availability. Match information to the employment period; present-day information alone does not establish historical usage.

Public sources establish employer context, not the candidate's membership, participation, ownership, or results. Names used in generated role narratives remain proposed draft context unless personal involvement is independently established; finding a name online does not verify participation.

The candidate profile supplies employment history and fixed credentials only; do not assume personal project details or measurements are available. Draft realistic proposed responsibilities, technical decisions, projects, and accomplishments consistent with researched employer context, career level, duration, and JD. These are proposed draft content, not independently verified personal experience. Apply Section 6E to numerical outcomes; do not describe generated details as verified or actually measured.

In each overview's first sentence, explicitly include both the team name and project name. Search relevant employer sources and preserve discovered names exactly, checking relevance to the employment period. If either name cannot be found, use a plausible draft name consistent with the employer, period, and role. Do not substitute generic functional descriptions for names. Prefer team names of one or two words; preserve researched official names exactly even when longer.

Treat draft names as proposed content internally; do not describe them as verified or imply that public sources establish personal participation. Do not include parenthetical confirmation notes, verification notices, or drafting comments in the overview.

If search is unavailable or inconclusive, use the draft-name fallback without claiming research or verification. Complete the draft without follow-up questions. Keep source records, naming provenance, and research notes internal.

## 4. PROFESSIONAL SUMMARY

Write one paragraph of four connected sentences, approximately 60–80 words:

1. Establish engineering level, JD-relevant specialization, completed years of experience, and relevant domains.
2. Describe ownership, architecture, technical direction, or cross-team influence appropriate to the level.
3. Explain the hands-on engineering practices most relevant to the JD.
4. Connect technical depth and product judgment to practical value for users or engineering teams.

Establish a professional identity rather than listing technologies. Include only a few central technical terms, with leadership or mentoring where supported by the experience. Use present-tense professional statements where natural. Do not name the hiring company, write a career objective, or use promotional opening adjectives.

## 5. SKILLS

Use approximately 6–8 compact, recognizable categories when useful; fewer are acceptable for a narrow role. Choose categories suited to the JD.

Each skills object contains exactly one category name mapped to an array of individual skill strings. Include relevant technologies, technical practices, and domain concepts, placing each in its best-fitting category without duplication. Exclude proficiency ratings, descriptive sentences, and unrelated inventories.

Make "Soft Skills" the final skills category and limit it to 5–6 distinct, JD-derived skills. Prioritize explicit requirements and capabilities central to the role; combine overlapping terms and exclude generic or lower-priority traits. Do not invent extra traits solely to reach the count if the JD supports fewer. Include this category within the overall category target. Section 3 governs explicit hard-skill and soft-skill coverage and their demonstration in experience. Keep all listed skills consistent with the narrative and historical plausibility.

## 6. PROFESSIONAL EXPERIENCE

Create one experience object per supplied employer, containing company, title, overview, sentences, and technologies. Before drafting each role, define its context, ownership, core stack, and distinct contributions internally.

### A. Role overview

Write two connected sentences, approximately 30–45 words total:

- Sentence 1: Explicitly name the team and one or two major projects, briefly explaining their purpose and users; apply Section 3’s researched-name and draft-name rules.
- Sentence 2: Summarize the candidate’s main ownership and most impactful achievement, including one meaningful metric when it meets Section 6E’s measurement standards; otherwise state a concrete qualitative outcome.

Follow the naming and evidence rules in Section 3. Establish the setting and scope. Reserve detailed implementation decisions and supporting results for contribution bullets; expand on the overview’s headline achievement without repeating the same metric. Do not repeat employer metadata or the title.

### B. Contribution selection and seniority

Represent realistic breadth of work appropriate to each role’s duration and scope. Distribute contributions across distinct initiatives, ongoing responsibilities, and improvements rather than forcing all bullets under one project or listing every project name.

Give each employer a distinct engineering story and show plausible progression in complexity, independence, ownership, and influence. Preserve the supplied level even when earlier roles have narrower scope.

Balance delivery, modernization, performance, reliability, security, testing, operations, and reusable capabilities according to the JD. Full-stack roles should cover frontend, backend, APIs, and data; specialized roles should focus on their relevant scope.

For senior work, show meaningful engineering constraints, consequential decisions, hands-on execution, and proportionate results. Communicate leadership through architecture, standards, design reviews, documentation, mentoring, adoption, or coordinated delivery. Identify collaboration partners and what was accomplished together. Do not make every contribution an organization-wide transformation or repeat the same leadership claim at every employer.

### C. Contribution sentence structure

Follow this flexible structure:

Action + concrete deliverable or technical decision + relevant approach + meaningful outcome or capability.

Begin directly with the contribution, without a work-area label or heading. Give each bullet a distinct focus. Keep the explanation specific about implementation and impact, preserving Section 6E’s metric standards and Section 7’s keyword highlighting. Usually use 25–40 words per bullet. Allow a slightly longer sentence only when necessary to preserve an important decision or tradeoff.

Each bullet must:
1. Cover one main contribution or a tightly connected set of actions.
2. Make individual ownership clear.
3. Explain how relevant technologies were applied.
4. Include rationale when it clarifies the decision.
5. State a meaningful result or useful capability.
6. Be independently understandable and distinct from adjacent bullets.

Vary emphasis and sentence construction naturally; do not mechanically force every element into every sentence. Put each contribution in its own sentences string.

### D. Contribution allocation

Determine bullet counts from the number of employers, each role’s employment duration, supplied seniority, JD relevance, and distinct contributions.

Use approximately 7 bullets for the most recent role and 2–3 for the earliest as starting targets, adjusting when duration, relevance, or scope warrants it. Allocate bullets across intervening roles proportionately rather than assigning fixed counts by position. A longer, more relevant, or higher-scope role may receive more space than a newer one. For a single-employer profile, use the most-recent-role target.

Preserve supplied career levels; do not assume earlier roles were junior. Keep contributions appropriate to the responsibilities and technical complexity plausible within each employment period.

Strengthen or consolidate existing relevant bullets before adding another, without combining unrelated work. Add bullets when necessary to demonstrate distinct, important JD requirements that remain inadequately covered. Every contribution must follow the draft-content rules and add substantive information rather than repeat keywords, accomplishments, or benefits.

Keep the overall content suitable for a two-page resume. Favor concise contributions near the lower end of the permitted word range, reserving longer bullets for meaningful technical decisions or tradeoffs. Do not add filler merely to reach a target count.

### E. Quantification and measurement

Quantify contributions using the measure that best explains their value: scope, delivered output, adoption, or outcomes. Do not require every number to describe an improvement.

Select measures according to the work:
- Scope: Size, reach, complexity, or responsibility boundaries.
- Output: Useful capabilities delivered, migrated, integrated, or automated.
- Adoption: Actual use across relevant users, teams, or systems.
- Outcomes: Changes in performance, reliability, time, resource efficiency, cost, quality, or business results.

Aim for at least five meaningful quantified contributions across experience when defensible. Distribute them naturally across employers and contribution types. Do not force numbers into every bullet or add activity counts that do not explain value.

For every quantitative claim, internally establish the measured quantity, unit, counting boundary, relevant period or workload, plausible collection method, and relationship to the candidate’s contribution. Naming a tool alone does not establish measurability.

Require a baseline and comparable conditions for improvement claims. Scope, output, and adoption counts do not require a previous baseline, but must have clear definitions and boundaries. Distinguish potential reach from actual usage, elapsed time from human effort, and delivered quantity from demonstrated value.

Choose the most informative unit rather than defaulting to percentages. Use absolute quantities, durations, financial amounts, frequencies, rates, or before-and-after values as appropriate. Use percentages only when relative comparison communicates the result clearly; distinguish relative percentage changes from percentage-point changes. Vary units naturally without imposing a variety quota.

Keep attribution proportional to ownership. Do not present an employer’s total users, revenue, infrastructure, or public performance figures as the candidate’s personal achievement. Financial results require a credible connection between the technical work and the claimed financial effect.

Show seniority through consequential decisions, engineering constraints, ownership, and coordination surrounding the measure—not through large numbers alone. Retain strong qualitative accomplishments when quantification would add little information.

Because the input supplies employment history rather than personal measurement records, generated figures are proposed draft estimates. Use rounded values prefixed with ~, avoid false precision, and do not describe estimates as verified or actually measured. Web research establishes employer context; it does not verify personal results.

During revision, preserve proposed figures that have clear definitions, reasonable scope, consistent calculations, and plausible measurement mechanisms. Clarify weak metrics before removing them, and consider whether scope, output, or adoption better communicates the contribution than an improvement percentage. Do not remove a figure solely because personal records were not supplied, and do not invent evidence to support it.

Remove a figure when it remains contradictory, mathematically incorrect, misleadingly attributed, or without a defensible measurement basis. Retain the concrete contribution and keep the removal reason in the internal audit.

### F. Per-role technologies

List the primary technologies and technical practices represented in each role's overview and bullets. Usually use 6–12 entries for recent roles and 3–8 for earlier roles, with fewer when appropriate. Order by importance and exclude tools added only for keyword coverage. Return individual plain strings; the application supplies the label and separators.

## 7. LANGUAGE, HIGHLIGHTING, AND REPETITION

Use natural American professional English, active voice, and no first-person pronouns. Use past tense for completed contributions and present tense only for clearly ongoing responsibilities. Avoid filler, inflated adjectives, vague responsibility statements, unsupported superlatives, and excessive jargon.

Keep summary and skills compact and allocate most space to experience. Preserve substantive technical detail while removing redundant context.

### Keyword highlighting

Wrap important JD keywords and short phrases in balanced ** markers inside summary, experience.overview, and experience.sentences strings. Prioritize central technologies, architecture patterns, domain capabilities, and explicitly required leadership or collaboration terms.

In each role overview, wrap the team name and each developed project name in double asterisks (**Team Name**, **Project Name**), preserving their exact wording. Use one pair of markers for each name without nesting markers.

Wrap each quantitative metric in double asterisks, including its approximation symbol, value, unit, and essential comparison context, such as **~10 hours per week**, **~20 services**, or **from ~500 ms to ~200 ms**. Apply this in summary, role overviews, and contribution bullets without highlighting the entire sentence or nesting asterisks.

Highlight selectively, keeping the wording readable. Do not highlight whole sentences or generic action verbs. Highlighting does not replace demonstrated experience or improve the internal score by itself.

Do not add highlighting to company, title, skills, technologies, or education. The application renders headings, employer metadata, bullet symbols, and labels; do not insert those into JSON values. Keyword and metric highlighting in the permitted fields and bold team and project names in experience.overview are the only allowed Markdown within JSON values.

### Wording consistency

Use standard product names, capitalization, spelling, and technical punctuation. Expand an acronym once where useful, then use its short form.

Vary accurate verbs and sentence openings across the resume without rigid frequency limits or forced synonyms. Remove repeated generic benefits, duplicate accomplishments, and formulaic constructions. Ground each employer's vocabulary in its actual engineering context.

Keep section purposes distinct: summary establishes professional identity; overviews establish team, project context, ownership, and one headline achievement; bullets explain execution and decisions; technology arrays identify the stack.

Preserve necessary technical repetition and exact JD terminology when they clarify coverage. Do not use hidden keywords, keyword stuffing, or guarantees about ATS outcomes.

## 8. MANDATORY INTERNAL REVIEW AND ALIGNMENT LOOP

### Fixed scoring rubric

Before reviewing the draft, use the Section 3 requirement map to establish a fixed 100-point rubric:

- Required technical skills and qualifications: 35 points.
- Central responsibilities and relevant experience: 30 points.
- Preferred technical skills and domain knowledge: 15 points.
- Required interpersonal and leadership capabilities: 10 points.
- Clear structure, standard terminology, and exact schema compliance: 10 points.

Allocate points within each category by JD importance. Assign each requirement to its primary category to avoid double-counting. If a category has no applicable requirements, redistribute its points proportionally among applicable categories. Keep requirements, weights, and scoring criteria unchanged across passes.

Award full credit for explicit, appropriate coverage with concrete experience support where required. Award partial credit for incomplete coverage or skills-only mentions where demonstrated experience is expected. Generated details do not establish verified qualifications. Keyword repetition and highlighting earn no additional credit.

This score is an internal JD alignment estimate, not an employer ATS result.

### Three mandatory review passes

Score the initial draft as iteration 0, then perform at least three complete review-and-revision passes after drafting, even when the initial score exceeds 95/100. A pass must inspect the complete resume, identify violations, apply necessary revisions, and reassess the result; merely asserting that a review happened is insufficient.

Pass 1 — Requirements and writing:
Check compliance with Sections 1–7 and 9, including eligibility, profile accuracy, coherent positioning, separate hard-skill and soft-skill coverage, the final Soft Skills category with 5–6 prioritized distinct skills where supported, overview purpose and length, concise contributions, seniority, metric measurability and appropriate units, highlighted team and project names, keyword highlighting, repetition, and valid JSON. Revise meaningful gaps and calculate the score.

Pass 2 — Independent factual and consistency review:
Recheck the revised resume against the original candidate profile and complete JD. Verify externally checkable names, employer context, technology claims, and employment-period plausibility using the research standards in Section 3. Consult primary sources for unresolved claims; retained sources may be reused when they directly resolve a claim. Check the team-name length preference without altering official names. Distinguish employer facts from personal participation and measured outcomes. Correct externally checkable inaccuracies while preserving plausible proposed names and metrics that meet Sections 3 and 6E; do not remove them solely because personal records are unavailable. Recheck all constraints affected by corrections and recalculate the score.

Pass 3 — Complete final validation:
Review the revised resume against the full requirement map and all prompt rules again. Resolve remaining hard-skill and soft-skill gaps, verify quantification and highlighting, remove repetition, and check contribution allocation, chronology, seniority, and JSON validity. Apply warranted changes and rescore; if no changes are needed, record that honestly.

### Further revisions and stopping

Complete all three mandatory passes before finishing. If the score is 95 or lower afterward, identify lost points, improve the most relevant content, and rescore using the same fixed rubric. Prioritize required skills and central responsibilities, then preferred qualifications. Strengthen existing contributions before adding bullets, and recheck factual consistency and formatting after changes.

Continue revising until the honestly self-assessed ATS alignment score exceeds 95/100. Completing the minimum three passes alone is not a stopping condition. Improve the resume rather than adjusting scores to meet the target. Never inflate scores, invent qualifications, or violate factual or other prompt constraints; if the target cannot be reached within those constraints, return the strongest compliant version and briefly state the remaining constraints using Section 9’s Target not reached format.

Keep requirement maps, research notes, scores, and review history internal. Return only the output specified below.

### Mandatory completion gate

Do not return the initial draft. Before producing the final output:

1. Evaluate the initial draft using the fixed rubric.
2. Complete Pass 1, apply necessary corrections, and rescore.
3. Complete Pass 2 against the revised resume, apply necessary corrections, and rescore.
4. Complete Pass 3 against the revised resume, apply necessary corrections, and rescore.
5. After all three mandatory passes, if the score remains 95 or lower, address remaining fixable gaps and reassess. Stop when the score exceeds 95 or no further improvement is possible without violating higher-priority constraints.

All three mandatory passes must occur even if the initial score exceeds 95. A pass may conclude that no correction is necessary; do not invent changes merely to demonstrate activity.

Report each completed iteration's score using the output format in Section 9. Keep concrete correction details, requirement maps, research notes, and detailed audits internal. If the target cannot be reached, briefly state the remaining constraints as specified in Section 9.

Never claim that a pass, research check, or correction occurred unless it was performed. Never inflate scores to reach the target.

The score is a self-assessed JD alignment estimate, not an actual ATS score. The iteration scores and target-not-reached explanation are the only exceptions to Section 8's instruction to keep scores and review history internal.

## 9. REQUIRED JSON OUTPUT

For an eligible JD, return this exact structure, expanding arrays to cover the supplied profile:

```json
{
  "company": "Hiring company from the JD",
  "title": "Generated target resume title",
  "summary": "Four connected sentences with selective **keyword highlighting**.",
  "skills": [
    {
      "Technical category": ["Individual hard skill", "Individual hard skill"]
    },
    {
      "Soft Skills": ["Prioritized JD-derived skill 1", "Prioritized JD-derived skill 2", "Prioritized JD-derived skill 3", "Prioritized JD-derived skill 4", "Prioritized JD-derived skill 5"]
    }
  ],
  "experience": [
    {
      "company": "Exact supplied employer name",
      "title": "Generated functional role title",
      "overview": "**Team Name** and **Project Name**, purpose, and users. Main ownership and most impactful achievement, with one meaningful metric when defensible.",
      "sentences": [
        "One concise contribution with selective **keyword highlighting**.",
        "Another distinct contribution."
      ],
      "technologies": ["Individual technology", "Individual technical practice"]
    }
  ],
  "education": [
    {
      "degree": "Complete supplied education text"
    }
  ]
}
```

Output rules:
1. Follow the Final output instruction below: for eligible JDs, show plain-text iteration scores followed by one final resume JSON code block; for ineligible JDs, return only the Section 2 error JSON code block.
2. Use exactly the top-level keys company, title, summary, skills, experience, and education.
3. Set top-level company to the hiring company named in the JD, or an empty string if unidentified.
4. Include exactly one experience object per supplied employer, ordered as specified in Section 1, with exactly company, title, overview, sentences, and technologies.
5. Use arrays of individual strings for skill values and technologies; do not combine multiple entries into comma-separated strings.
6. Preserve the education structure shown and all supplied education information.
7. Do not add, remove, or rename schema keys. Use double quotes and correct escaping, with no trailing commas or comments.

### Final output instruction

1. For an eligible JD, first show the actual completed review progress as plain text:

   Iterate 0: ATS Alignment Score — [initial score]/100
   Iterate 1: ATS Alignment Score — [score after mandatory Pass 1]/100
   Iterate 2: ATS Alignment Score — [score after mandatory Pass 2]/100
   Iterate 3: ATS Alignment Score — [score after mandatory Pass 3]/100

   Add one line for each additional completed review-and-correction iteration:

   Iterate N: ATS Alignment Score — [reassessed score]/100

   Report only completed iterations and honestly calculated scores using the fixed rubric. Do not invent improvements, inflate scores, or skip any of the three mandatory passes. Scores may remain unchanged when a review finds no necessary corrections.

   If the final score does not exceed 95/100, add:

   Target not reached: [brief explanation of remaining constraints].

   Then return the final revised resume as one valid JSON object inside a Markdown code block labeled json, preserving the exact resume schema. Do not output an earlier draft, a separate review-report JSON object, or other commentary.

   For an ineligible JD, return only the error object specified in Section 2; do not include iteration lines.

## JOB DESCRIPTION

[PASTE THE JOB DESCRIPTION HERE]
