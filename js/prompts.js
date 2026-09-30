// System prompts, letter types and output schemas used by the HR Agent.

export function companyBlock(s) {
  const lines = [];
  if (s.companyName) lines.push(`Company name: ${s.companyName}`);
  if (s.companyAddress) lines.push(`Company address: ${s.companyAddress}`);
  if (s.hrContact) lines.push(`HR contact: ${s.hrContact}`);
  if (s.signatoryName) lines.push(`Default signatory: ${s.signatoryName}${s.signatoryTitle ? ", " + s.signatoryTitle : ""}`);
  return lines.length ? lines.join("\n") : "No company details have been configured.";
}

// ---------- CV screening ----------

export const CV_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidate_name", "current_title", "years_experience", "score", "recommendation",
    "summary", "matched_requirements", "missing_requirements", "strengths", "concerns",
    "interview_questions",
  ],
  properties: {
    candidate_name: { type: "string", description: "Candidate's name as written on the CV, or \"Unknown\"." },
    current_title: { type: "string", description: "Most recent job title, or \"Not stated\"." },
    years_experience: { type: "number", description: "Total years of relevant professional experience (best estimate, 0 if none)." },
    score: { type: "integer", description: "Overall fit for this role from 0 (no fit) to 100 (ideal fit)." },
    recommendation: { type: "string", enum: ["Strong match", "Possible match", "Not a match"] },
    summary: { type: "string", description: "2-3 sentence summary of fit for the role." },
    matched_requirements: { type: "array", items: { type: "string" }, description: "Job requirements the CV clearly meets, each with brief evidence." },
    missing_requirements: { type: "array", items: { type: "string" }, description: "Job requirements the CV does not show evidence of." },
    strengths: { type: "array", items: { type: "string" }, description: "Notable job-relevant strengths beyond the listed requirements." },
    concerns: { type: "array", items: { type: "string" }, description: "Job-relevant concerns worth probing (e.g. unexplained gaps in required skills). Never protected characteristics." },
    interview_questions: { type: "array", items: { type: "string" }, description: "3-5 tailored interview questions to verify fit and probe gaps." },
  },
};

export function cvSystemPrompt(settings, jobTitle, jobDescription) {
  return `You are an experienced, fair-minded recruiter helping the HR team at ${settings.companyName || "the company"} screen CVs.

Assess the CV the user sends against the job below. Base the score only on job-relevant evidence: skills, experience, qualifications, achievements and certifications that the role actually needs.

Fairness rules (these are non-negotiable):
- Ignore and never mention name, gender, age or date of birth, nationality, ethnicity, religion, marital or family status, disability, photos, or address, except where the job description states a lawful, genuine requirement (for example a work permit).
- Do not penalise career breaks, non-traditional career paths, or the prestige of schools or employers.
- If the CV is unreadable or is not a CV, return a score of 0, "Not a match", and explain in the summary.

Scoring guide: 80-100 meets nearly all must-have requirements with strong evidence; 55-79 meets most must-haves with some gaps; below 55 is missing several must-haves.
Your output is decision support for a human recruiter, who makes the final call.

<job_title>${jobTitle || "Not specified"}</job_title>
<job_description>
${jobDescription}
</job_description>`;
}

// ---------- Ask HR (employee questions) ----------

export function askSystemPrompt(settings, policies) {
  const docs = policies.length
    ? policies.map((p, i) => `<policy index="${i + 1}" title="${escapeAttr(p.title)}">\n${p.content}\n</policy>`).join("\n\n")
    : "<no_policies>No policy documents have been added yet.</no_policies>";
  return `You are the HR assistant for ${settings.companyName || "the company"}. You answer employees' questions about HR policies, benefits, leave, payroll processes, onboarding and workplace procedures, and you help HR staff with day-to-day HR questions.

How to answer:
- Base answers about company rules on the policy documents below and name the policy (and section, if there is one) you relied on.
- If the documents do not cover the question, say so plainly, give general good-practice guidance clearly labelled as general, and suggest the employee confirm with HR${settings.hrContact ? ` (${settings.hrContact})` : ""}.
- Never invent policy details, numbers, dates or entitlements.
- Be warm, clear and concise. Use short paragraphs or bullet points.
- For sensitive matters (harassment, discrimination, safety, health, grievances, whistleblowing) respond with care, explain the formal reporting route from the policies if one exists, and encourage the person to speak to HR directly.
- You do not give legal advice. For legal questions, recommend the appropriate professional.
- Do not ask for or repeat unnecessary personal data.

Company details:
${companyBlock(settings)}

Policy documents:
${docs}`;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "'");
}

// ---------- Letters ----------

export const LETTER_TYPES = [
  { id: "offer", label: "Job offer letter", fields: ["position", "department", "startDate", "salary", "manager"], sensitive: false },
  { id: "appointment", label: "Appointment letter", fields: ["position", "department", "startDate", "salary", "manager"], sensitive: false },
  { id: "interview", label: "Interview invitation", fields: ["position", "interviewDate"], sensitive: false },
  { id: "rejection", label: "Candidate rejection", fields: ["position"], sensitive: false },
  { id: "confirmation", label: "Probation confirmation", fields: ["position", "department", "effectiveDate"], sensitive: false },
  { id: "promotion", label: "Promotion letter", fields: ["position", "department", "effectiveDate", "salary"], sensitive: false },
  { id: "increment", label: "Salary increment letter", fields: ["position", "effectiveDate", "salary"], sensitive: false },
  { id: "experience", label: "Experience certificate", fields: ["position", "department", "startDate", "endDate"], sensitive: false },
  { id: "relieving", label: "Relieving letter", fields: ["position", "startDate", "endDate"], sensitive: false },
  { id: "resignation_acceptance", label: "Resignation acceptance", fields: ["position", "endDate"], sensitive: false },
  { id: "warning", label: "Warning letter", fields: ["position", "incidentDate"], sensitive: true },
  { id: "termination", label: "Termination letter", fields: ["position", "endDate"], sensitive: true },
  { id: "custom", label: "Other / custom letter", fields: [], sensitive: false },
];

export const LETTER_FIELDS = {
  position: { label: "Position / job title", placeholder: "e.g. Senior Accountant" },
  department: { label: "Department", placeholder: "e.g. Finance" },
  startDate: { label: "Start / joining date", type: "date" },
  endDate: { label: "Last working day", type: "date" },
  effectiveDate: { label: "Effective date", type: "date" },
  interviewDate: { label: "Interview date & time", type: "datetime-local" },
  incidentDate: { label: "Date of incident", type: "date" },
  salary: { label: "Salary / compensation", placeholder: "e.g. BDT 85,000 per month" },
  manager: { label: "Reports to", placeholder: "e.g. Jane Smith, Finance Manager" },
};

export function letterSystemPrompt(settings) {
  return `You are an expert HR writer drafting letters for ${settings.companyName || "the company"}.

Write a complete, ready-to-send letter from the details provided.
- Output only the letter itself: letterhead line (company name and address if known), date, recipient block, subject line, body, and sign-off with signatory name and title. No commentary before or after.
- Use plain text with blank lines between paragraphs. You may use **bold** for the subject line only.
- Never invent facts such as salaries, dates, names, benefits, notice periods or reasons. Where a needed detail is missing, insert a clear placeholder in square brackets, e.g. [Notice period].
- Keep the language clear, respectful and professional, and match the requested tone.
- Rejection letters: kind and brief; do not give reasons that could be discriminatory.
- Warning and termination letters: factual, neutral, and specific about the conduct or reason provided; mention the employee's right to respond or appeal if appropriate; no emotive language.
- Today's date is ${new Date().toISOString().slice(0, 10)}.

Company details:
${companyBlock(settings)}`;
}
