// Vercel serverless function. Proxies FASHN AI (try-on, cutouts) so
// FASHN_API_KEY stays private and never reaches the browser.
//
// POST { model_name, inputs }  -> submits a job, returns { id }
// GET  ?id=<prediction id>     -> returns job status / output
const FASHN = "https://api.fashn.ai/v1";

export default async function handler(req, res) {
  const key = process.env.FASHN_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Server is missing FASHN_API_KEY. Add it in Vercel project settings (get a key at app.fashn.ai/api)." });
  }
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  try {
    if (req.method === "GET") {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const r = await fetch(`${FASHN}/status/${encodeURIComponent(id)}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data?.message || data?.error || "FASHN status error" });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const { model_name, inputs } = req.body || {};
      if (!model_name || !inputs) return res.status(400).json({ error: "model_name and inputs required" });
      const r = await fetch(`${FASHN}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model_name, inputs }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data?.message || data?.error || "FASHN run error" });
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
