// Vercel Edge Function — posts lead + estimate data to Slack
// Fires when a prospect submits the lead gate on estimate.kingbirdsolutions.com
// Set SLACK_WEBHOOK_URL in Vercel environment variables

export const config = { runtime: 'edge' };

export default async function handler(req) {
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

  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackUrl) {
    // Silently succeed so the front end doesn't break
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { lead = {}, data = {}, est = {} } = body;

  const fmt = n => '$' + Number(n).toLocaleString('en-US');

  const rateNote = est.usonlySelected ? 'US-only team at $92/hr' : 'Standard at $75/hr';

  const lines = [
    '*New estimate lead* | Kingbird Sales Tool',
    '',
    `*${lead.name || 'Unknown'}*  |  ${lead.email || ''}${lead.phone ? '  |  ' + lead.phone : ''}`,
    `Company: ${data.company || 'Not provided'}  |  Industry: ${data.industry || 'Not provided'}`,
    '',
    `*Project:* ${(data.types || []).join(', ') || 'Not specified'}`,
    data.description ? `*Description:* ${data.description.slice(0, 280)}` : '',
    `Integrations: ${data.integrations || '0'}  |  Compliance: ${data.compliance || 'none'}  |  Users: ${data.users || 'small'}`,
    `Design: ${data.design || 'n/a'}  |  Timeline: ${data.timeline || 'flexible'}  |  Team: ${rateNote}`,
    `Budget: ${data.budget || 'Not selected'}`,
    '',
    `*Estimate: ${est.totH || '?'} hrs  |  ${fmt(est.activeCost || 0)} (${rateNote})  |  ${(est.timeline || {}).lo || '?'} to ${(est.timeline || {}).hi || '?'} weeks*`,
    est.costRange ? `Range: ${fmt(est.costRange.lo)} to ${fmt(est.costRange.hi)}  |  Confidence: ${est.confidence || 'unknown'}` : '',
    (est.oqs || []).length
      ? '\n*Questions for intake call:*\n' + est.oqs.map(q => '  - ' + q).join('\n')
      : '',
    '',
    est.shareUrl ? `View estimate: ${est.shareUrl}` : ''
  ].filter(Boolean).join('\n');

  try {
    const slackRes = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines })
    });

    if (!slackRes.ok) {
      console.error('Slack error:', slackRes.status, await slackRes.text());
    }

    return new Response(JSON.stringify({ ok: slackRes.ok }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    console.error('Notify handler error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
