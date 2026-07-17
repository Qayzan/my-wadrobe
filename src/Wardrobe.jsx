import React, { useState, useRef } from "react";
import { Upload, Shirt, Sparkles, Trash2, Loader2, X, Wand2, Grid, Layers, AlertCircle, Scissors, UserRound, ImagePlus, Check, Download } from "lucide-react";

const T = {
  paper: "#FBFAF7", card: "#FFFFFF", ink: "#1C1B19", stone: "#8A857C",
  line: "#E7E3DB", sage: "#6B7A63", blush: "#C7A69A",
};

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Footwear", "Accessories", "Dresses"];
// Categories the try-on model can dress you in (shoes/accessories aren't supported by tryon-v1.6).
const WEARABLE = ["Tops", "Bottoms", "Outerwear", "Dresses"];
const TRYON_CATEGORY = { Tops: "tops", Outerwear: "tops", Bottoms: "bottoms", Dresses: "one-pieces" };

// Calls OUR serverless function, not Anthropic directly. The key lives on the server.
async function callClaude(messages, maxTokens = 1500) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.text;
}

// Submits a FASHN job through our serverless proxy, then polls until it finishes.
// Returns the first output image as a data URL (we always ask for return_base64).
async function runFashn(model_name, inputs) {
  const res = await fetch("/api/fashn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_name, inputs: { ...inputs, return_base64: true } }),
  });
  const sub = await res.json();
  if (!res.ok) throw new Error(sub.error || `Error ${res.status}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const sr = await fetch(`/api/fashn?id=${encodeURIComponent(sub.id)}`);
    const st = await sr.json();
    if (!sr.ok) throw new Error(st.error || `Error ${sr.status}`);
    if (st.status === "completed") {
      if (!st.output || !st.output[0]) throw new Error("The AI returned no image. Try again.");
      return st.output[0];
    }
    if (st.status === "failed") throw new Error(st.error?.message || st.error?.name || "Generation failed. Try a clearer photo.");
  }
  throw new Error("Timed out waiting for the result. Try again.");
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{") >= 0 ? clean.indexOf("{") : clean.indexOf("[");
  const e = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
  if (s < 0 || e < 0) throw new Error("The AI didn't return a readable result. Try again.");
  return JSON.parse(clean.slice(s, e + 1));
}

// Resize the photo down before sending, so it stays under Vercel's ~4.5MB
// request limit (a full phone photo as base64 is often larger). Also faster + cheaper.
// Always outputs JPEG. Returns { b64, media }.
const fileToB64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        res({ b64: dataUrl.split(",")[1], media: "image/jpeg" });
      };
      img.onerror = rej;
      img.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });

// Shrink a data-URL image, keeping transparency (webp where the browser can
// encode it, PNG otherwise). Keeps cutouts small enough for localStorage.
const shrinkDataUrl = (dataUrl, MAX = 512) =>
  new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      let out = c.toDataURL("image/webp", 0.85);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
      res(out);
    };
    img.onerror = rej;
    img.src = dataUrl;
  });

// Wardrobe persists in this browser only (localStorage), no account needed.
const STORE = "wardrobe.items.v1";
const MODEL_STORE = "wardrobe.model.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
const save = (items) => { try { localStorage.setItem(STORE, JSON.stringify(items)); return true; } catch { return false; } };
const loadModel = () => { try { return localStorage.getItem(MODEL_STORE) || ""; } catch { return ""; } };
const saveModel = (d) => { try { if (d) localStorage.setItem(MODEL_STORE, d); else localStorage.removeItem(MODEL_STORE); } catch {} };

export default function Wardrobe() {
  const [items, setItems] = useState(load);
  const [tab, setTab] = useState("wardrobe");
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter] = useState("All");
  const [outfits, setOutfits] = useState([]);
  const [genLoading, setGenLoading] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef();

  // Fitting room
  const [modelPhoto, setModelPhoto] = useState(loadModel);
  const [queue, setQueue] = useState([]); // [{type:'item', id} | {type:'ext', src, name}]
  const [fitResult, setFitResult] = useState("");
  const [fitBusy, setFitBusy] = useState(false);
  const [fitStep, setFitStep] = useState("");
  const [cuttingId, setCuttingId] = useState("");
  const modelRef = useRef();
  const extRef = useRef();

  const commit = (next) => {
    setItems(next);
    if (!save(next)) setErr("This browser's storage is full — delete a few pieces (or their cut-outs) to make room.");
  };

  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAnalyzing(true);
    setErr("");
    let working = items;
    for (const file of files) {
      try {
        const { b64, media } = await fileToB64(file);
        const dataUrl = `data:${media};base64,${b64}`;
        const text = await callClaude([{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: b64 } },
            { type: "text", text:
              "You are a fashion cataloguer. Identify each distinct clothing item, shoe, and accessory the person is wearing. Respond ONLY with JSON:\n" +
              '{"items":[{"name":"short name","category":"one of Tops/Bottoms/Outerwear/Footwear/Accessories/Dresses","color":"primary color","material":"guess or unknown","tags":["style tags"]}]}' },
          ],
        }]);
        const parsed = parseJSON(text);
        const newItems = (parsed.items || []).map((it, i) => ({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`, ...it, src: dataUrl,
        }));
        working = [...newItems, ...working];
        commit(working);
      } catch (e2) {
        console.error(e2);
        setErr("Couldn't analyze that photo: " + e2.message);
      }
    }
    setAnalyzing(false);
    setTab("wardrobe");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function generateOutfits() {
    if (items.length < 2) return;
    setGenLoading(true);
    setErr("");
    try {
      const wardrobe = items.map((i) => ({ id: i.id, name: i.name, category: i.category, color: i.color, tags: i.tags }));
      const text = await callClaude([{
        role: "user",
        content:
          `Wardrobe JSON: ${JSON.stringify(wardrobe)}.\n` +
          (occasion ? `Occasion: "${occasion}".\n` : "") +
          "Compose 4 complete wearable outfits using ONLY these item ids. Respond ONLY with JSON:\n" +
          '{"outfits":[{"title":"evocative name","why":"one sentence","itemIds":["id1","id2"]}]}',
      }], 2000);
      setOutfits(parseJSON(text).outfits || []);
    } catch (e2) {
      console.error(e2);
      setErr("Couldn't compose outfits: " + e2.message);
    }
    setGenLoading(false);
  }

  // Two FASHN steps: "edit" isolates the garment as a product shot, then
  // "background-remove" makes it a transparent cutout. Cached on the item.
  async function makeCutout(item) {
    setCuttingId(item.id);
    setErr("");
    try {
      const shot = await runFashn("edit", {
        image: item.src,
        prompt:
          `Remove the person and the background entirely. Show only the ${item.color || ""} ${item.name}` +
          " as a professional e-commerce product photo: the garment neatly presented, front view, centered on a plain pure white background." +
          " No person, no body parts, no other clothing or objects.",
        resolution: "1k",
        generation_mode: "fast",
      });
      const png = await runFashn("background-remove", { image: shot });
      const cutout = await shrinkDataUrl(png, 512);
      const next = items.map((i) => (i.id === item.id ? { ...i, cutout } : i));
      commit(next);
      setDetail((d) => (d && d.id === item.id ? { ...d, cutout } : d));
    } catch (e2) {
      console.error(e2);
      setErr("Couldn't cut out that piece: " + e2.message);
    }
    setCuttingId("");
  }

  async function setModelFromFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { b64, media } = await fileToB64(file);
      const dataUrl = `data:${media};base64,${b64}`;
      setModelPhoto(dataUrl);
      saveModel(dataUrl);
      setFitResult("");
    } catch (e2) {
      setErr("Couldn't read that photo: " + e2.message);
    }
    if (modelRef.current) modelRef.current.value = "";
  }

  async function addExternalGarment(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { b64, media } = await fileToB64(file);
      setQueue((q) => [...q, { type: "ext", src: `data:${media};base64,${b64}`, name: "From photo" }].slice(0, 4));
    } catch (e2) {
      setErr("Couldn't read that photo: " + e2.message);
    }
    if (extRef.current) extRef.current.value = "";
  }

  const toggleQueued = (id) => {
    setQueue((q) => {
      const has = q.some((e) => e.type === "item" && e.id === id);
      if (has) return q.filter((e) => !(e.type === "item" && e.id === id));
      if (q.length >= 4) return q;
      return [...q, { type: "item", id }];
    });
  };

  const tryOnOutfit = (o) => {
    const wearables = o.itemIds.filter((id) => {
      const it = byId(id);
      return it && WEARABLE.includes(it.category);
    });
    setQueue(wearables.map((id) => ({ type: "item", id })).slice(0, 4));
    setFitResult("");
    setTab("fitting");
  };

  // Try each garment on in sequence: the output of one try-on becomes the
  // model image for the next, so layered outfits build up piece by piece.
  async function runTryOn() {
    if (!modelPhoto || !queue.length || fitBusy) return;
    setFitBusy(true);
    setFitResult("");
    setErr("");
    let base = modelPhoto;
    try {
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        const it = entry.type === "item" ? byId(entry.id) : null;
        const garment = it ? (it.cutout || it.src) : entry.src;
        const label = it ? it.name : entry.name;
        setFitStep(`Fitting ${i + 1} of ${queue.length}: ${label}…`);
        base = await runFashn("tryon-v1.6", {
          model_image: base,
          garment_image: garment,
          category: it ? (TRYON_CATEGORY[it.category] || "auto") : "auto",
          garment_photo_type: it && it.cutout ? "flat-lay" : "auto",
          mode: "balanced",
          output_format: "jpeg",
        });
      }
      setFitResult(base);
    } catch (e2) {
      console.error(e2);
      setErr("Try-on failed: " + e2.message);
    }
    setFitStep("");
    setFitBusy(false);
  }

  const remove = (id) => {
    commit(items.filter((i) => i.id !== id));
    setOutfits((p) => p.filter((o) => !o.itemIds.includes(id)));
    setQueue((q) => q.filter((e) => !(e.type === "item" && e.id === id)));
  };

  const shown = filter === "All" ? items : items.filter((i) => i.category === filter);
  const byId = (id) => items.find((i) => i.id === id);
  const isQueued = (id) => queue.some((e) => e.type === "item" && e.id === id);
  const wearableItems = items.filter((i) => WEARABLE.includes(i.category));

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: "'Inter','Helvetica Neue',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .frau { font-family: 'Fraunces', Georgia, serif; }
        .fade { animation: fade .5s ease both; }
        @keyframes fade { from {opacity:0; transform:translateY(8px);} to {opacity:1; transform:none;} }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ch { transition: transform .25s ease, box-shadow .25s ease; }
        .ch:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(28,27,25,.10); }
        @media (prefers-reduced-motion: reduce){ .fade,.ch{animation:none;transition:none;} }
        button:focus-visible { outline: 2px solid ${T.sage}; outline-offset: 2px; }
      `}</style>

      <header style={{ borderBottom: `1px solid ${T.line}`, padding: "18px 16px", position: "sticky", top: 0, background: `${T.paper}f0`, backdropFilter: "blur(8px)", zIndex: 20 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: "0.22em", color: T.stone, textTransform: "uppercase" }}>Personal Atelier</div>
            <h1 className="frau" style={{ fontSize: 26, fontWeight: 500, margin: "2px 0 0", lineHeight: 1 }}>The Wardrobe</h1>
          </div>
          <div style={{ display: "flex", gap: 4, background: T.card, border: `1px solid ${T.line}`, borderRadius: 999, padding: 4 }}>
            {[["wardrobe", "Collection", Grid], ["studio", "Studio", Layers], ["fitting", "Fitting Room", UserRound]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                display: "flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
                padding: "9px 15px", borderRadius: 999, fontSize: 13.5, fontWeight: 500,
                background: tab === k ? T.ink : "transparent", color: tab === k ? T.paper : T.stone,
              }}><Icon size={15} /> {label}</button>
            ))}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px 80px" }}>
        {err && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#FBF3F0", border: `1px solid ${T.blush}`, borderRadius: 12, padding: "12px 14px", marginBottom: 20, fontSize: 13, color: "#7A4A3E" }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
          </div>
        )}

        {tab === "wardrobe" && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
              <button onClick={() => fileRef.current?.click()} disabled={analyzing} className="ch" style={{
                flex: "1 1 300px", minHeight: 90, border: `1.5px dashed ${T.blush}`, background: T.card,
                borderRadius: 16, cursor: analyzing ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 16, padding: "0 20px", textAlign: "left",
              }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: T.paper, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {analyzing ? <Loader2 size={22} style={{ animation: "spin 1s linear infinite", color: T.sage }} /> : <Upload size={22} color={T.sage} />}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{analyzing ? "Reading your photos…" : "Upload photos of yourself"}</div>
                  <div style={{ fontSize: 12.5, color: T.stone, marginTop: 2 }}>{analyzing ? "Extracting garments" : "Each piece gets catalogued automatically"}</div>
                </div>
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{ display: "none" }} />
              <div style={{ display: "flex", gap: 18, alignItems: "center", padding: "0 6px" }}>
                <Stat n={items.length} label="Pieces" />
                <div style={{ width: 1, height: 34, background: T.line }} />
                <Stat n={new Set(items.map((i) => i.category)).size} label="Categories" />
              </div>
            </div>

            {items.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
                {["All", ...CATEGORIES].map((c) => {
                  const count = c === "All" ? items.length : items.filter((i) => i.category === c).length;
                  if (c !== "All" && count === 0) return null;
                  return (
                    <button key={c} onClick={() => setFilter(c)} style={{
                      border: `1px solid ${filter === c ? T.ink : T.line}`, background: filter === c ? T.ink : "transparent",
                      color: filter === c ? T.paper : T.stone, padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
                    }}>{c} <span style={{ opacity: 0.6 }}>{count}</span></button>
                  );
                })}
              </div>
            )}

            {items.length === 0 ? <Empty analyzing={analyzing} /> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 14 }}>
                {shown.map((it) => (
                  <div key={it.id} className="ch fade" onClick={() => setDetail(it)} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", position: "relative" }}>
                    <div style={{ aspectRatio: "3/4", overflow: "hidden", background: T.paper, display: "grid", placeItems: "center" }}>
                      <img src={it.cutout || it.src} alt={it.name} style={it.cutout
                        ? { width: "88%", height: "88%", objectFit: "contain" }
                        : { width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    {it.cutout && (
                      <div style={{ position: "absolute", top: 8, left: 8, background: `${T.paper}e0`, backdropFilter: "blur(4px)", borderRadius: 8, width: 26, height: 26, display: "grid", placeItems: "center" }}>
                        <Scissors size={13} color={T.sage} />
                      </div>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); remove(it.id); }} style={{ position: "absolute", top: 8, right: 8, border: "none", background: `${T.paper}e0`, backdropFilter: "blur(4px)", borderRadius: 8, width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}><Trash2 size={14} color={T.stone} /></button>
                    <div style={{ padding: "10px 12px 12px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: colorDot(it.color), border: `1px solid ${T.line}` }} />
                        <span style={{ fontSize: 11.5, color: T.stone }}>{it.color} · {it.category}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "studio" && (
          <div className="fade">
            <div style={{ maxWidth: 620, marginBottom: 24 }}>
              <h2 className="frau" style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>Styling Studio</h2>
              <p style={{ color: T.stone, fontSize: 14.5, lineHeight: 1.6, marginTop: 8 }}>Name an occasion, or leave it open, and I'll compose full looks from your collection.</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 26 }}>
              <input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="e.g. dinner in the city, rainy commute…" style={{ flex: "1 1 300px", border: `1px solid ${T.line}`, background: T.card, borderRadius: 12, padding: "13px 16px", fontSize: 14.5, color: T.ink, outline: "none" }} />
              <button onClick={generateOutfits} disabled={genLoading || items.length < 2} style={{ border: "none", background: items.length < 2 ? T.line : T.ink, color: items.length < 2 ? T.stone : T.paper, borderRadius: 12, padding: "13px 22px", fontSize: 14.5, fontWeight: 600, cursor: items.length < 2 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 9 }}>
                {genLoading ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> : <Wand2 size={17} />}
                {genLoading ? "Composing…" : "Style me"}
              </button>
            </div>
            {items.length < 2 && <div style={{ color: T.stone, fontSize: 14, padding: "40px 0", textAlign: "center" }}>Add at least two pieces to your collection first.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 18 }}>
              {outfits.map((o, idx) => (
                <div key={idx} className="fade" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Sparkles size={15} color={T.blush} />
                    <h3 className="frau" style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{o.title}</h3>
                  </div>
                  <p style={{ fontSize: 13, color: T.stone, lineHeight: 1.55, margin: "0 0 14px" }}>{o.why}</p>
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                    {o.itemIds.map((id) => {
                      const it = byId(id);
                      if (!it) return null;
                      return (
                        <div key={id} style={{ flexShrink: 0, width: 72 }}>
                          <div style={{ width: 72, height: 94, borderRadius: 10, overflow: "hidden", border: `1px solid ${T.line}`, background: T.paper, display: "grid", placeItems: "center" }}>
                            <img src={it.cutout || it.src} alt={it.name} style={it.cutout ? { width: "88%", height: "88%", objectFit: "contain" } : { width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: T.stone, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                        </div>
                      );
                    })}
                  </div>
                  {o.itemIds.some((id) => { const it = byId(id); return it && WEARABLE.includes(it.category); }) && (
                    <button onClick={() => tryOnOutfit(o)} style={{ marginTop: 12, border: `1px solid ${T.line}`, background: "transparent", color: T.sage, borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                      <UserRound size={14} /> Try this look on me
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "fitting" && (
          <div className="fade">
            <div style={{ maxWidth: 620, marginBottom: 24 }}>
              <h2 className="frau" style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>Fitting Room</h2>
              <p style={{ color: T.stone, fontSize: 14.5, lineHeight: 1.6, marginTop: 8 }}>
                Add one clear, well-lit full-body photo of yourself, pick up to four pieces — from your collection or any photo or screenshot — and see them on you.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18, alignItems: "start" }}>
              {/* Left: model photo + rack */}
              <div>
                <SectionLabel>Your photo</SectionLabel>
                {modelPhoto ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 22 }}>
                    <div style={{ width: 110, aspectRatio: "3/4", borderRadius: 12, overflow: "hidden", border: `1px solid ${T.line}` }}>
                      <img src={modelPhoto} alt="You" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <button onClick={() => modelRef.current?.click()} style={{ border: `1px solid ${T.line}`, background: T.card, color: T.stone, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Replace photo</button>
                  </div>
                ) : (
                  <button onClick={() => modelRef.current?.click()} className="ch" style={{
                    width: "100%", minHeight: 84, border: `1.5px dashed ${T.blush}`, background: T.card, borderRadius: 16,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "0 18px", textAlign: "left", marginBottom: 22,
                  }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: T.paper, display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <UserRound size={20} color={T.sage} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Add a full-body photo of yourself</div>
                      <div style={{ fontSize: 12, color: T.stone, marginTop: 2 }}>Stays in this browser only — front-facing, simple background works best</div>
                    </div>
                  </button>
                )}
                <input ref={modelRef} type="file" accept="image/*" onChange={setModelFromFile} style={{ display: "none" }} />

                <SectionLabel>The rack · {queue.length}/4</SectionLabel>
                {wearableItems.length === 0 && <div style={{ color: T.stone, fontSize: 13, marginBottom: 12 }}>No wearable pieces yet — add tops, bottoms, outerwear or dresses to your collection first.</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {wearableItems.map((it) => {
                    const on = isQueued(it.id);
                    return (
                      <button key={it.id} onClick={() => toggleQueued(it.id)} style={{ position: "relative", width: 64, border: on ? `2px solid ${T.sage}` : `1px solid ${T.line}`, borderRadius: 10, padding: 0, overflow: "hidden", cursor: "pointer", background: T.paper }}>
                        <div style={{ width: "100%", aspectRatio: "3/4", display: "grid", placeItems: "center" }}>
                          <img src={it.cutout || it.src} alt={it.name} style={it.cutout ? { width: "86%", height: "86%", objectFit: "contain" } : { width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                        {on && (
                          <div style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, background: T.sage, display: "grid", placeItems: "center" }}>
                            <Check size={11} color={T.paper} strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                  <button onClick={() => extRef.current?.click()} disabled={queue.length >= 4} style={{ width: 64, aspectRatio: "3/4", border: `1.5px dashed ${T.blush}`, borderRadius: 10, background: T.card, cursor: queue.length >= 4 ? "not-allowed" : "pointer", display: "grid", placeItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                      <ImagePlus size={18} color={T.sage} />
                      <div style={{ fontSize: 9, color: T.stone, marginTop: 4, lineHeight: 1.3 }}>Any photo or screenshot</div>
                    </div>
                  </button>
                </div>
                <input ref={extRef} type="file" accept="image/*" onChange={addExternalGarment} style={{ display: "none" }} />

                {queue.some((e) => e.type === "ext") && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {queue.filter((e) => e.type === "ext").map((e, i) => (
                      <div key={i} style={{ position: "relative", width: 64 }}>
                        <div style={{ width: "100%", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", border: `2px solid ${T.sage}` }}>
                          <img src={e.src} alt="External garment" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                        <button onClick={() => setQueue((q) => q.filter((x) => x !== e))} style={{ position: "absolute", top: -6, right: -6, border: "none", background: T.ink, color: T.paper, borderRadius: 9, width: 18, height: 18, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={runTryOn} disabled={fitBusy || !modelPhoto || !queue.length} style={{
                  border: "none", background: (!modelPhoto || !queue.length) ? T.line : T.ink, color: (!modelPhoto || !queue.length) ? T.stone : T.paper,
                  borderRadius: 12, padding: "13px 22px", fontSize: 14.5, fontWeight: 600, cursor: (fitBusy || !modelPhoto || !queue.length) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 9, marginTop: 6,
                }}>
                  {fitBusy ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={17} />}
                  {fitBusy ? (fitStep || "Fitting…") : "Try it on"}
                </button>
              </div>

              {/* Right: result */}
              <div>
                <SectionLabel>The mirror</SectionLabel>
                <div style={{ aspectRatio: "3/4", borderRadius: 16, border: `1px solid ${T.line}`, background: T.card, overflow: "hidden", display: "grid", placeItems: "center" }}>
                  {fitResult ? (
                    <img src={fitResult} alt="Try-on result" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : fitBusy ? (
                    <div style={{ textAlign: "center", color: T.stone, fontSize: 13, padding: 20 }}>
                      <Loader2 size={22} style={{ animation: "spin 1s linear infinite", color: T.sage }} />
                      <div style={{ marginTop: 10 }}>{fitStep || "Fitting…"}</div>
                      <div style={{ marginTop: 4, fontSize: 11.5 }}>About 10 seconds per piece</div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", color: T.stone, fontSize: 13, padding: 20, maxWidth: 240 }}>
                      <UserRound size={26} color={T.blush} />
                      <div style={{ marginTop: 8 }}>Your look appears here</div>
                    </div>
                  )}
                </div>
                {fitResult && (
                  <a href={fitResult} download="wardrobe-try-on.jpg" style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, color: T.sage, fontSize: 13, fontWeight: 600, textDecoration: "none", border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 14px" }}>
                    <Download size={14} /> Save image
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(28,27,25,.4)", display: "grid", placeItems: "center", padding: 20, zIndex: 40 }}>
          <div onClick={(e) => e.stopPropagation()} className="fade" style={{ background: T.card, borderRadius: 20, overflow: "hidden", maxWidth: 360, width: "100%" }}>
            <div style={{ aspectRatio: "3/4", background: T.paper, display: "grid", placeItems: "center" }}>
              <img src={detail.cutout || detail.src} alt={detail.name} style={detail.cutout ? { width: "88%", height: "88%", objectFit: "contain" } : { width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 className="frau" style={{ fontSize: 21, fontWeight: 500, margin: 0 }}>{detail.name}</h3>
                <button onClick={() => setDetail(null)} style={{ border: "none", background: T.paper, borderRadius: 8, width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer" }}><X size={16} /></button>
              </div>
              <div style={{ fontSize: 13.5, color: T.stone, marginTop: 6 }}>{detail.category} · {detail.color} · {detail.material}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                {(detail.tags || []).map((t) => <span key={t} style={{ fontSize: 11.5, color: T.sage, border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 11px" }}>{t}</span>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {!detail.cutout && (
                  <button onClick={() => makeCutout(detail)} disabled={cuttingId === detail.id} style={{ border: `1px solid ${T.line}`, background: "transparent", color: T.sage, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: cuttingId === detail.id ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                    {cuttingId === detail.id ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Scissors size={14} />}
                    {cuttingId === detail.id ? "Cutting out… ~20s" : "Cut out garment"}
                  </button>
                )}
                {WEARABLE.includes(detail.category) && (
                  <button onClick={() => { if (!isQueued(detail.id)) toggleQueued(detail.id); setDetail(null); setTab("fitting"); }} style={{ border: "none", background: T.ink, color: T.paper, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                    <UserRound size={14} /> {isQueued(detail.id) ? "In fitting room" : "Try it on"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10.5, letterSpacing: "0.18em", color: "#8A857C", textTransform: "uppercase", marginBottom: 10 }}>{children}</div>;
}

function Stat({ n, label }) {
  return (
    <div>
      <div className="frau" style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10.5, color: "#8A857C", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Empty({ analyzing }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", border: `1px dashed ${T.line}`, borderRadius: 20, background: T.card }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: T.paper, display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
        <Shirt size={26} color={T.blush} />
      </div>
      <div className="frau" style={{ fontSize: 20, fontWeight: 500 }}>{analyzing ? "Building your collection…" : "Your collection is empty"}</div>
      <div style={{ fontSize: 14, color: T.stone, marginTop: 6, maxWidth: 340, marginInline: "auto", lineHeight: 1.6 }}>Upload a few photos of yourself and every garment gets catalogued here automatically.</div>
    </div>
  );
}

function colorDot(c = "") {
  const map = { black: "#1C1B19", white: "#FFF", grey: "#9A958C", gray: "#9A958C", navy: "#2B3A55", blue: "#3B5B8C", red: "#A6362E", green: "#4C6B47", beige: "#D8C7A8", brown: "#6B4E38", cream: "#EFE7D6", tan: "#C9A96A", pink: "#D8A5AE", denim: "#4A6785" };
  const key = Object.keys(map).find((k) => c.toLowerCase().includes(k));
  return key ? map[key] : "#B9B3A8";
}
