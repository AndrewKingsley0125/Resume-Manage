# MASTER SOFTWARE ENGINEER RESUME-GENERATION PROMPT

## 1. TASK AND CANDIDATE PROFILE

Given a job description (JD), generate a complete, tailored US software engineering resume in the exact JSON structure below. Complete the task in one pass without requesting a base resume, project history, or metrics.

CANDIDATE PROFILE — update this block when candidate information changes:

Default target level: Senior Software Engineer

Work Experience:
- DoorDash, Senior Software Engineer, Aug 2022 - Oct 2026
- Instagram, Senior Software Engineer, Jun 2020 - Jul 2022
- First Data Corporation, Software Engineer, Jan 2018 - Jun 2020
- JPMorgan Chase & Co, Software Engineer, Jun 2016 - Jan 2018

Education:
- Bachelor's Degree in Computer Science, New York University 2013 - 2017

Profile and application rules:
1. Preserve employer names and employment dates. Return employers in reverse chronological order.
2. Retain each exact employer name in experience.company solely to match the application record.
3. Generate the target resume title in the top-level title field and a relevant role title in each experience.title field.
4. Tailor title specialization to the JD while preserving the supplied career level and credible scope. Examples include Senior Frontend Engineer, Senior Software Engineer, Developer Experience, or Software Engineer, Payments. Do not invent promotions or management authority. Use a Lead title only when supported by the supplied profile.
5. Keep employers distinct from the hiring company: the top-level company identifies the hiring company in the JD.
6. Calculate experience from employment dates, without double-counting overlaps or counting beyond the current date or supplied end date. Use completed years in the summary.
7. Preserve supplied education. Do not invent contact details, degrees, certifications, clearances, or fixed personal credentials.
8. A sample resume establishes writing style and structure only. Never transfer its candidate facts into this profile.

## 2. ELIGIBILITY CHECK

Read the complete JD before drafting. Do not generate a resume if the position requires security clearance or requires onsite/hybrid work without a fully remote option.

Continue when clearance is only preferred, location is unspecified or unclear, a fully remote option is explicitly available, or remote work includes occasional travel. Historical work arrangements do not affect this eligibility check.

For an ineligible role, return only the applicable error object:

{"error":"The position requires security clearance."}

or

{"error":"The position requires onsite or hybrid work without a fully remote option."}

If both apply, include both reasons in the error string. This is the only exception to the resume schema.

## 3. INTERNAL JD ANALYSIS AND POSITIONING

Analyze the full JD, including responsibilities, required/preferred qualifications, company context, technology descriptions, and examples of work.

Internally identify:
- Role specialization, seniority, ownership, and central engineering problems.
- Languages, frameworks, libraries, tools, APIs, integrations, and protocols.
- Databases, data modeling, messaging, and processing.
- Cloud, infrastructure, containers, deployment, and CI/CD.
- Testing, security, accessibility, observability, reliability, and performance.
- Products, customers, business workflows, and domain knowledge.
- Architecture, technical leadership, mentoring, collaboration, and stakeholder influence.

Classify requirements as required, preferred, responsibilities, or contextual. Build an internal coverage map connecting central requirements to experience, skills, and summary.

Establish one consistent professional identity suited to the JD: frontend, backend, full-stack, platform, developer experience, cloud, or another supported specialization. Include relevant required, preferred, and contextual terminology comprehensively where it fits coherent engineering work. Give central responsibilities priority. Do not force unrelated tools into one accomplishment.

Use exact JD terminology naturally. Place technologies across employers according to role relevance, chronology, and career progression. Do not imply Staff or Principal scope solely from years of experience.

### Hard-skill and soft-skill coverage check

Create two separate internal requirement lists from the complete JD before drafting.

Hard skills: Capture named languages, frameworks, databases, cloud services, APIs, architecture patterns, tools, methodologies, testing practices, security requirements, and domain capabilities. Preserve specific terms: a broad category such as AWS does not substitute for a named service such as Lambda.

Soft skills: Collect the interpersonal skills, behavioral strengths, and working-style requirements stated or clearly emphasized in the JD. Preserve its specific wording where natural; do not use a preset list.

For each item, track its priority and planned location. Required skills and central responsibilities receive the strongest coverage; preferred skills follow when relevant and chronologically plausible.

1. Place each relevant named hard skill in the appropriate skills category. Demonstrate central hard skills in at least one role through a concrete application, technical decision, or deliverable. Listing a technology alone does not demonstrate its use.
2. Demonstrate each central soft skill through a specific action and its consequence. Use the actual skill term or a close grammatical form naturally in the sentence when useful for matching.
3. Do not rely only on implied soft skills. A mentoring example should explicitly say mentored or mentoring; a collaboration example should identify the partners and the shared work. Keep the contribution substantive rather than appending a generic trait.
4. Distribute coverage across the summary, a final Soft Skills category in skills, and relevant experience. Collect the JD-specific behavioral strengths in that category and demonstrate them through contributions. Technical methods such as Agile or Scrum belong in the appropriate technical category.
5. Where useful, include both the full term and acronym once, such as continuous integration and continuous delivery (CI/CD). Retain exact product names and recognized spellings.
6. Before returning the JSON, compare both requirement lists with the completed resume. Identify missing required skills, missing central responsibilities, and soft skills that are only implied. Revise the most suitable existing sentence or category to close meaningful gaps without adding unrelated work or repetitive bullets.
7. Treat missing fixed qualifications separately from wording gaps. Do not manufacture degrees, certifications, clearances, additional years, or management authority to obtain a match. Maintain employer, time-period, and technical plausibility when generating illustrative experience.
8. Resolve repetition rules in favor of necessary skill coverage: repeat exact technical terms when they clarify experience or cover a central requirement. Avoid keyword stuffing, hidden keywords, unsupported proficiency labels, and claims of a guaranteed ATS score.

Keep the requirement lists, coverage map, and audit internal.

## 4. PROFESSIONAL SUMMARY

Write one paragraph of four connected sentences, approximately 60–80 words.

Sentence 1: Establish engineering level, JD-relevant specialization, completed years of experience, and relevant product or business domains.
Sentence 2: Describe architecture, ownership, technical direction, delivery standards, or cross-team influence appropriate to the candidate's level.
Sentence 3: Explain the hands-on engineering practices most relevant to the JD.
Sentence 4: Connect product judgment and technical depth to practical value for users or engineering teams.

Summary rules:
1. Use direct American professional English without first-person pronouns.
2. Emphasize a coherent professional identity rather than a list of technologies.
3. Include only a few central technical terms; place detailed tools in skills and experience.
4. Mention mentoring and technical leadership when relevant and supported by the experience narrative.
5. Use present-tense professional statements such as Builds, Shapes, Improves, or Combines where natural.
6. Keep every claim consistent with the experience and skills.
7. Avoid generic openings such as passionate, results-driven, dynamic, or highly motivated.
8. Do not mention the hiring company's name or turn the summary into a career objective.

## 5. TECHNICAL SKILLS

Create compact, recognizable categories suited to the JD. Prefer about 6–8 categories when useful; use fewer for a narrower role.

Possible categories include Languages, Backend, Frontend, Data, Cloud, DevOps, Testing, Security, and Delivery. Choose only categories that fit the role. Delivery may include developer experience, release automation, monorepo tooling, and delivery metrics.

Rules:
1. Include relevant languages, frameworks, platforms, tools, technical practices, and domain concepts.
2. Use standard product names and exact JD terminology when appropriate.
3. Keep each category focused; place each skill in its best-fitting category rather than duplicating it.
4. Keep important skills consistent with the experience narrative and demonstrate central capabilities in contributions.
5. Include supporting technologies when relevant and chronologically plausible.
6. End the skills array with a Soft Skills category containing specific JD-aligned behavioral strengths. Also demonstrate the most important strengths through experience.
7. Avoid proficiency ratings, descriptive sentences, and unrelated technology inventories.
8. Each skills array object must contain exactly one category name mapped to an array of skill strings.

### Final skills category: Soft Skills

Analyze the complete JD, including responsibilities, qualifications, team culture, and descriptions of how employees work. Collect the soft skills and behavioral strengths the employer explicitly requests or clearly emphasizes.

Append Soft Skills as the final object in the skills array. Select the most relevant JD-derived skills and preserve the employer's terminology where natural. Use concise, specific phrases that describe the requested working style and professional strengths. Do not use a preset list, generic filler, or strengths unrelated to the JD.

Prioritize explicitly stated skills over inferred ones. Include only as many distinct skills as the JD supports. Consolidate overlapping terms without losing important keyword coverage. Reinforce central soft skills through concrete actions and outcomes in experience. Keep this category within the existing skills array; do not add a top-level JSON key.

## 6. PROFESSIONAL EXPERIENCE STRUCTURE

Create exactly one experience object per supplied employer. Each object contains:
- company: Exact supplied employer name.
- title: Generated functional role title at the supplied career level.
- overview: Two-sentence role introduction.
- sentences: Separate contribution strings, rendered as bullets by the application.
- technologies: Focused array of technologies and technical practices used in that role.

Before writing each role, internally define its product context, primary engineering focus, ownership level, core stack, and distinct contributions. Use that plan to keep the role coherent.

### A. Role overview

Write two connected sentences, approximately 35–55 words total.

The first sentence establishes the product, users, workflow, or engineering foundation and the candidate's ownership. The second highlights the role's most significant achievement, connects it to the core technical approach, and states a meaningful engineering or business impact. Include a credible metric when it strengthens the overview; otherwise describe a concrete change in capability, reliability, adoption, or delivery.

Make the achievement appropriate to the role's seniority: senior overviews should communicate a consequential architectural, product, platform, or operational result; earlier roles should show a narrower but useful contribution. Each overview should explain both the work's context and what improved because of it.

Use clear openings such as Delivered, Developed, Built, Implemented, or Set technical direction when appropriate. Give concrete context before the bullets. Do not reproduce the title, employer name, dates, or location. Select one headline achievement rather than summarizing every bullet. Contributions should expand on the implementation, decisions, and supporting results without repeating the overview sentence or the same metric verbatim.

### B. Career progression and contribution selection

1. Show increasing complexity, independence, ownership, and influence across the career.
2. Senior roles combine hands-on implementation with architecture, technical decisions, standards, reliability, and adoption where relevant.
3. Earlier roles emphasize implementation, debugging, testing, reusable components, and growing technical independence. Do not portray an experienced Software Engineer as junior unless supported by the profile.
4. Give every employer a distinct product context and engineering story. Related capabilities may recur, but deliverables and problems should differ.
5. Balance new features, workflows, services, APIs, integrations, reusable systems, performance, reliability, security, testing, and operations according to the JD.
6. Include modernization where relevant, while also showing delivery of useful new capabilities.
7. For full-stack roles, cover frontend, backend, APIs, and data layers. For specialized roles, concentrate on the appropriate engineering scope.
8. Use publicly documented employer products and technologies for context when reliable research is available. Confirm time-period plausibility. Public employer information does not establish personal participation; use named projects only when involvement is supplied or established.
9. When project details are absent, generate realistic illustrative responsibilities, projects, technical decisions, accomplishments, and metrics appropriate to the employer, supplied seniority, employment duration, and JD. Complete the output without requesting evidence, follow-up information, or a separate review step. These generated details are illustrative; employer research establishes context, not verification of personal contributions.
10. Make senior-level accomplishments substantive: show an engineering constraint, a consequential design or implementation decision, and a meaningful result. Favor architecture boundaries, migrations with compatibility constraints, production reliability, performance bottlenecks, reusable platforms, release safety, or adoption across independently owned systems when relevant to the JD.
11. Calibrate scope to the role and duration. Show ownership through decisions and hands-on execution rather than inflated verbs. Do not make every accomplishment an organization-wide transformation. Earlier roles should retain narrower ownership and plausible career progression.

### C. Contribution writing style

Write concise, specific contributions that explain what the candidate did and why it mattered.

Useful pattern:
Action + concrete deliverable or technical decision + relevant approach + meaningful outcome or capability.

Vary sentence structure naturally. A bullet may emphasize a decision, implementation, adoption, or outcome; do not mechanically force every element into every sentence.

For every bullet:
10. Cover one main contribution or a tightly related set of actions.
11. Make individual ownership clear without taking credit for an entire organization's results.
12. Explain how important technologies were applied instead of appending a tool list.
13. Include rationale when it clarifies an engineering choice or tradeoff.
14. State a credible result, useful capability, or practical improvement.
15. Make the contribution independently understandable and distinct from neighboring bullets.
16. Usually use 25–40 words, allowing shorter sentences when the contribution is already clear.

Use precise verbs such as Designed, Built, Implemented, Delivered, Established, Defined, Automated, Integrated, Improved, Reviewed, and Resolved. Choose verbs for accuracy. Avoid repeating the same opening within a role when a natural alternative exists.

Keep technology names and necessary domain terminology consistent. Do not force awkward synonyms. Avoid vague responsibility statements, inflated adjectives, excessive jargon, and unrelated keyword combinations.

### D. Leadership and collaboration

Show leadership through concrete work: architecture decisions, reusable standards, internal tools, design reviews, documentation, mentoring, adoption, or coordinated delivery.

When mentioning product, design, QA, security, infrastructure, operations, or business partners, explain what was accomplished together. Examples include resolving tradeoffs, defining requirements, improving handoffs, establishing release checks, or guiding adoption.

Integrate collaboration into technical contributions. Keep hands-on engineering visible in senior roles. Distribute leadership examples where they fit without repeating the same mentoring or review claim at every employer.

### E. Outcomes and measurement

Generate at least five realistic illustrative measurable impacts across the experience section when candidate metrics are unavailable. Distribute them naturally across employers and contribution types; do not require a number in every bullet. Use supplied metrics when available.

Choose numbers by reasoning from the engineering mechanism, plausible baseline, scope, and employment duration. Keep improvements meaningful for senior-level work while proportionate to the contribution. For example, connect deployment improvements to validation and release changes, latency improvements to a specific bottleneck, and adoption to a useful internal capability. Avoid arbitrary impressive numbers, implausibly large gains, and false precision.

Include several contributions whose seniority comes from technical judgment, architecture, operational complexity, or adoption rather than a percentage. Do not claim company-wide business results from a narrowly scoped engineering change.

Use the measurement that communicates the result clearly: time, defects, adoption, volume, release frequency, reliability, cost, or percentages. Preserve meaningful before-and-after values when available.

Not every bullet needs a number. Concrete qualitative outcomes include repeatable setup, consistent release validation, accessible workflows, reusable service scaffolding, clearer failure handling, or simpler engineering adoption. Keep causal claims proportional to the described technical mechanism and distinguish direct improvements from broader benefits.

### F. Contribution allocation

Allocate bullets according to relevance, employment duration, and seniority together. A longer previous role may receive more bullets than the newest role.

Starting ranges for this four-employer profile:
- Most recent role: 5–7 bullets.
- Second role: 5–7 bullets.
- Third role: 4–6 bullets.
- Earliest role: 3–4 bullets.

Choose within these ranges based on useful content and length. Do not add filler or repeat accomplishments to reach a count.

### G. Per-role technologies

Return a focused technologies array after each role's contributions. Include the primary languages, frameworks, platforms, tools, and practices represented in its overview and bullets.

Usually use 6–12 entries for recent roles and 3–8 for earlier roles, with fewer when appropriate. Order by importance to the role. Do not add tools only to expand keyword coverage. Return plain strings; the application supplies the Technologies label and separators.

## 7. GENERAL STYLE

Keep summary and skills compact and allocate most space to experience. Preserve substantive technical content while compressing repetitive or less relevant wording.

Use natural American professional English, active voice, and past tense for completed contributions. Use present tense only for clearly ongoing responsibilities. Avoid first-person pronouns, promotional language, filler, and unsupported superlatives.

The application renders section headings, employer metadata, Key Contributions, bullet symbols, and Technologies labels. Do not insert these labels, bullet characters, or Markdown formatting into JSON values.

Use standard acronym capitalization. Expand an acronym once where useful, then use its short form. Preserve spacing and punctuation in technical terms; avoid merged words such as AIAssisted.

### Whole-resume wording and repetition

Review the title, summary, skills, all role overviews, and all contribution bullets together before returning the resume.

1. Vary action verbs and sentence openings across the entire resume, not just within each employer. Prefer using a distinctive opening verb once or twice; use an accurate common verb again when changing it would sound forced.
2. Remove repeated generic phrases such as improving reliability, reducing friction, cross-functional teams, reusable components, and delivery standards when they add no new information. Replace them with the specific system, decision, constraint, or outcome involved.
3. Give each employer a distinct vocabulary grounded in its product and engineering work. Avoid describing different projects with the same sentence template.
4. Avoid repeatedly using words such as built, designed, developed, implemented, improved, shared, platform, workflow, and engineering in nearby sentences. Rewrite the sentence or name the concrete artifact when natural.
5. Separate the purpose of each section: the summary establishes professional identity; overviews establish context and headline achievements; bullets explain decisions and execution; technology arrays identify the stack. Do not restate the same claim across these sections.
6. Preserve exact technology names, necessary domain terms, and important JD terminology. Do not replace precise technical terms with awkward synonyms or remove essential keyword coverage merely to reduce repetition.
7. Remove duplicated accomplishments and benefits even when their wording differs. Every bullet should add a distinct contribution, technical insight, or outcome.
8. Read for natural rhythm and clarity after editing. Favor precise language over a larger vocabulary; do not impose rigid word-frequency limits.

## 8. INTERNAL FINAL AUDIT

Before returning the output, verify:
1. Eligibility was checked against the complete JD.
2. The target title, summary, skills, and experience form one consistent professional identity.
3. Separate hard-skill and soft-skill checks confirm that relevant required skills and central responsibilities appear explicitly and naturally; key hard skills have concrete experience support, and key soft skills appear in the final Soft Skills category and are demonstrated through actions and outcomes.
4. Employer names and ordering match the profile exactly; dates were used correctly for chronology and experience calculation.
5. Generated titles preserve the supplied career levels and credible scope.
6. Each role includes a two-sentence overview with context and a meaningful headline achievement, distinct contributions, and a focused technologies array.
7. Leadership appears through concrete actions and career progression is plausible.
8. Technologies fit each period and each role's engineering story.
9. Outcomes follow logically from contributions; illustrative metrics have plausible baselines, scope, and technical mechanisms, with at least five measurable impacts distributed naturally.
10. A whole-resume repetition check has removed unnecessary repeated verbs, phrases, sentence structures, and accomplishments while preserving technical accuracy and important JD terminology.
11. JSON is valid and follows the exact schema.

Do not output analysis, keyword maps, audit notes, drafting instructions, or ATS guarantees.

## 9. REQUIRED JSON OUTPUT

For an eligible JD, return exactly this structure:

```json
{
  "company": "Hiring company from the job description",
  "title": "Generated target resume title",
  "summary": "Complete four-sentence professional summary.",
  "skills": [
    {
      "Languages": ["Skill1", "Skill2"]
    },
    {
      "Soft Skills": ["JD-specific professional strength", "Another JD-specific professional strength"]
    }
  ],
  "experience": [
    {
      "company": "Exact supplied employer name",
      "title": "Generated role title",
      "overview": "Product context and ownership. Headline achievement, technical approach, and meaningful impact.",
      "sentences": [
        "First contribution.",
        "Second contribution."
      ],
      "technologies": ["Technology1", "Technology2"]
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
1. Return one valid JSON object inside a Markdown code block labeled json, with no commentary outside it. Apply the same wrapper to eligibility errors.
2. Use exactly these top-level keys: company, title, summary, skills, experience, education.
3. Set top-level company to the hiring company named in the JD. Use an empty string if it cannot be identified.
4. Create exactly one experience object for every supplied employer, in reverse chronological order.
5. Each experience object must contain exactly company, title, overview, sentences, and technologies.
6. Keep each contribution in its own sentences string. Do not combine multiple bullets into one string.
7. Use arrays of plain strings for skills and technologies, without embedded labels or comma-separated lists inside a single entry.
8. Do not add, remove, or rename schema keys. Use double quotes, escape strings correctly, and include no trailing commas or comments.

## JOB DESCRIPTION

[PASTE THE JOB DESCRIPTION HERE]
