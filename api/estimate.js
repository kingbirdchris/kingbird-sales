// Vercel Edge Function — AI-powered estimate refinement
// Receives rule-based phase breakdown + prospect description
// Returns phase multipliers, signals, and before/after scenarios from Claude Haiku
// Falls back gracefully: if this errors, front-end keeps the rule-based result

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { phases = [], data = {}, totH = 0, activeCost = 0, activeRate = 75 } = body;

  // Don't call the API if there's no meaningful description to analyze
  const desc = (data.description || '').trim();
  if (desc.length < 50) {
    return new Response(JSON.stringify({ skip: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const phaseLines = phases
    .map(p => `  ${p.id}: ${p.h} hours`)
    .join('\n');

  const typeList  = (data.types || []).join(', ') || 'not specified';
  const compliStr = data.compliance === 'none' ? 'none' : data.compliance;
  const integStr  = data.integrations === '0' ? 'none' : data.integrations + ' external systems';

  const prompt = `You are a senior software estimator at Kingbird Solutions, a custom software development shop that builds owned, maintainable software for non-technical founders and operators.

A prospect has described their project. A rule-based estimator has already produced hour estimates per phase, adjusted for AI-assisted senior engineers. Your job is to:
1. Read the description and identify signals the parameter-based rules would not capture
2. Write 3 before/after comparison rows that are specific to THIS project (not generic)

RULE-BASED BASELINE (hours already reflect AI tooling efficiency):
${phaseLines}
Total: ${totH} hours at $${activeRate}/hr = $${activeCost.toLocaleString()}

PROJECT PARAMETERS:
- Type(s): ${typeList}
- Integrations: ${integStr}
- Compliance: ${compliStr}
- User scale: ${data.users}
- Existing code: ${data.existing}
- Design situation: ${data.design}
- Timeline: ${data.timeline}
- Company: ${data.company || 'not provided'}
- Industry: ${data.industry || 'not provided'}

PROSPECT DESCRIPTION:
"${desc}"

Return ONLY a raw JSON object. No markdown fences, no explanation outside the JSON.

{
  "phase_adjustments": {
    "discovery": 1.0,
    "design": 1.0,
    "frontend": 1.0,
    "backend": 1.0,
    "integrations": 1.0,
    "deployment": 1.0,
    "qa": 1.0,
    "pm": 1.0
  },
  "overall_note": "one sentence: what the description reveals that the baseline rules did not capture",
  "confidence_boost": false,
  "additional_questions": [],
  "before_after": [
    {
      "label": "short scenario label (2-4 words, e.g. 'Intake process' or 'Reporting')",
      "bad": "one concrete sentence describing the specific pain this project currently causes — reference their actual workflow if possible",
      "good": "one concrete sentence describing the specific outcome after the build — reference their actual use case"
    },
    {
      "label": "...",
      "bad": "...",
      "good": "..."
    },
    {
      "label": "Vendor relationship",
      "bad": "The offshore agency delivers and disappears. No documentation. Support tickets go unanswered.",
      "good": "Direct access to the engineer who wrote your code. Throughout the engagement, not just at kickoff."
    }
  ]
}

Rules for phase_adjustments:
- Set a multiplier only when the description contains a clear, specific signal for that phase
- Multipliers range: 0.60 to 2.00. Default is 1.0 (no change)
- Most phases should remain at 1.0
- overall_note: skip generic observations, only note what is specific and meaningful
- confidence_boost: true only if the description significantly clarifies scope beyond what the parameters captured
- additional_questions: maximum 2, only questions the description raised that the standard parameter set does not already ask

Rules for before_after:
- All 3 rows must be specific to what the prospect described — no generic filler
- Row 1 and 2: derive directly from the pain or workflow mentioned in the description
- Row 3: always use the vendor relationship row exactly as shown above
- bad: describe the current broken state using concrete details from the description
- good: describe the post-build outcome in terms of their actual use case
- Label: 2-4 words, title case, specific to the scenario (not "Problem" or "Solution")`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, err);
      return new Response(JSON.stringify({ error: 'Upstream API error' }), {
        status: 502,
  