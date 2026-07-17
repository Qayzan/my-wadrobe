import React, { useState, useRef } from "react";
import { Upload, Shirt, Sparkles, Trash2, Loader2, X, Wand2, Grid, Layers, AlertCircle } from "lucide-react";

const T = {
  paper: "#FBFAF7", card: "#FFFFFF", ink: "#1C1B19", stone: "#8A857C",
  line: "#E7E3DB", sage: "#6B7A63", blush: "#C7A69A",
};

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Footwear", "Accessories", "Dresses"];

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

// Wardrobe persists in this browser only (localStorage), no account needed.
const STORE = "wardrobe.items.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
const save = (items) => { try { localStorage.setItem(STORE, JSON.stringify(items)); } catch {} };

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

  const commit = (next) => { setItems(next); save(next); };

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

  const remove = (id) => {
    commit(items.filter((i) => i.id !== id));
    setOutfits((p) => p.filter((o) => !o.itemIds.includes(id)));
  };

  const shown = filter === "All" ? items : items.filter((i) => i.category === filter);
  const byId = (id) => items.find((i) => i.id === id);

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
            {[["wardrobe", "Collection", Grid], ["studio", "Studio", Layers]].map(([k, label, Icon]) => (
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
                    <div style={{ aspectRatio: "3/4", overflow: "hidden", background: T.paper }}>
                      <img src={it.src} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
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
                          <div style={{ width: 72, height: 94, borderRadius: 10, overflow: "hidden", border: `1px solid ${T.line}` }}>
                            <img src={it.src} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: T.stone, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(28,27,25,.4)", display: "grid", placeItems: "center", padding: 20, zIndex: 40 }}>
          <div onClick={(e) => e.stopPropagation()} className="fade" style={{ background: T.card, borderRadius: 20, overflow: "hidden", maxWidth: 360, width: "100%" }}>
            <div style={{ aspectRatio: "3/4", background: T.paper }}>
              <img src={detail.src} alt={detail.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
