import { useEffect, useRef, useState } from "react";
import type { Appearance, Catalog, Decision, Generation, ProviderMode } from "../shared/types";
import { CharacterPreview } from "./CharacterPreview";

function Icon({ name, size = 20 }: { name: "upload" | "spark" | "download" | "cube" | "arrow" | "rotate"; size?: number }) {
  const paths = {
    upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7L20 2Z" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" /></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10M7.5 4.5l9 5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    rotate: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.error ?? `Request failed (${response.status}). Please try again.`);
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [skin, setSkin] = useState("");
  const [mode, setMode] = useState<ProviderMode>("demo");
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rotating, setRotating] = useState(true);
  const [error, setError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [notice, setNotice] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationController = useRef<AbortController | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/catalog", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw await responseError(response);
      return response.json();
    }).then(data => {
      setCatalog(data.categories);
      setMode(data.mode);
      setAppearance(Object.fromEntries(data.categories.map((c: Catalog[number]) => [c.id, c.default])));
      setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    if (!photo) { setPhotoUrl(""); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!appearance) return;
    const controller = new AbortController();
    setRendering(true);
    setRenderError("");
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch("/api/skin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appearance }), signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!controller.signal.aborted) {
          setSkin(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`);
        }
      } catch (e) {
        if (!controller.signal.aborted) setRenderError(e instanceof Error ? e.message : "Skin could not be rendered.");
      } finally {
        if (!controller.signal.aborted) setRendering(false);
      }
    }, 180);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [appearance]);

  useEffect(() => () => generationController.current?.abort(), []);

  function choosePhoto(file?: File) {
    if (!file || generating) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP photograph.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("The image must be smaller than 10 MB.");
      return;
    }
    setPhoto(file);
    setNotice("");
    setDecisions([]);
    setError("");
  }

  async function generate() {
    if (!photo || generating) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.append("image", photo);
    try {
      const response = await fetch("/api/generate", { method: "POST", body, signal: controller.signal });
      if (!response.ok) throw await responseError(response);
      const result: Generation = await response.json();
      setAppearance(result.appearance);
      setDecisions(result.decisions);
      setNotice(result.message);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Generation failed.");
    } finally { if (!controller.signal.aborted) setGenerating(false); }
  }

  const optionCount = catalog.reduce((sum, c) => sum + c.options.length, 0);
  const busy = generating || rendering;
  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="Block and You home"><span className="brand-icon"><Icon name="cube" size={25} /></span> block<span className="brand-amp">&</span>you<span className="studio-tag">CHARACTER STUDIO</span></a>
      <a className="help-link" href="#how-to">How to use <span>↗</span></a>
    </header>

    <main>
      <section className="intro">
        <div><div className="eyebrow"><span className="tiny-square" /> A LITTLE MORE YOU. A LITTLE MORE BLOCKY.</div>
          <h1>Your next adventure.<br /><span>Your own character.</span></h1>
          <p>Turn your real-world look into a world of blocks.<br className="desktop-break" /> One photo, a few personal touches, and you’re ready to play.</p>
        </div>
        <div className="intro-note"><span className="pixel-star">✦</span><p>Made for your<br /><strong>block era.</strong></p><span className="doodle-arrow">↙</span></div>
      </section>

      <div className={`mode-banner ${mode === "demo" ? "" : "pending"}`}>
        <span className="status-dot" />
        <strong>{mode === "demo" ? "Demo workspace" : mode === "live" ? "Microsoft Decision 1.1" : "Model not configured"}</strong>
        <span>{mode === "demo" ? "Demo mode does not analyze photos. Explore a sample skin, or configure live mode." : mode === "live" ? "Your photo will be sent to your configured Foundry deployment to select your character's features." : "Configure live mode to analyze photos. The manual skin editor is available."}</span>
      </div>
      {error && <div role="alert" className="error-message">{error} {!catalog.length && <button onClick={() => setCatalogAttempt(n => n + 1)}>Retry connection</button>}</div>}

      <section className="workspace" aria-label="Character studio">
        <article className="panel photo-panel">
          <div className="panel-heading"><div><span className="step-number">01</span><h2>The inspiration</h2></div><span className="panel-kicker">YOUR PHOTO</span></div>
          <div className={`upload-zone ${dragging ? "dragging" : ""} ${photoUrl ? "has-photo" : ""}`}
            onDragOver={event => { event.preventDefault(); if (!generating) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); choosePhoto(event.dataTransfer.files[0]); }}>
            {photoUrl ? <>
              <img src={photoUrl} alt="Your uploaded inspiration photograph" className="uploaded-photo" onError={() => setError("Your browser could not display this image. Please choose another photograph.")} />
              <div className="photo-caption"><span>{photo?.name}</span><button disabled={generating} onClick={() => inputRef.current?.click()}>Replace photo</button></div>
            </> : <div className="upload-empty">
              <div className="photo-illustration" aria-hidden="true"><div className="mini-sun" /><div className="mini-mountain back" /><div className="mini-mountain" /><span className="upload-badge"><Icon name="upload" size={19} /></span></div>
              <h3>A photo. A whole new you.</h3>
              <p>Drop your photo here, or choose<br />one from your device.</p>
              <button className="button button-outline" disabled={generating} onClick={() => inputRef.current?.click()}><Icon name="upload" size={17} /> Choose a photo</button>
              <span className="file-hint">PNG, JPG, WEBP · UP TO 10 MB</span>
            </div>}
            <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a person photograph" disabled={generating} onChange={event => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          <div className="photo-tip"><span>☀</span><p><strong>A good photo goes a long way.</strong><br />Try a clear, well-lit photo with your hair and outfit visible.</p></div>
          <button className="button button-primary generate-button" disabled={!photo || !appearance || generating} onClick={generate}>
            {generating ? <span className="spinner" /> : <Icon name="spark" />}
            {generating ? "Building your character…" : mode === "demo" ? "Build demo character" : "Build my character"}<Icon name="arrow" size={18} />
          </button>
          <p className="privacy-note">{mode === "live" ? "This app doesn’t save photos. Photo analysis sends the normalized image to your Foundry deployment." : "Photos stay in memory and aren’t saved. No images are sent to an AI service in this mode."}</p>
        </article>

        <div className="workspace-connector" aria-hidden="true"><Icon name="arrow" size={19} /></div>

        <article className="panel skin-panel">
          <div className="panel-heading"><div><span className="step-number">02</span><h2>Your block alter ego</h2></div><span className="live-tag"><span /> LIVE PREVIEW</span></div>
          <div className="preview-stage" aria-busy={busy}>
            <div className="stage-label"><span className="tiny-square" /> CLASSIC MODEL</div>
            <div className="stage-grid" /><div className="character-shadow" />
            {skin ? <CharacterPreview skin={skin} rotating={rotating} /> : <div className="preview-loading">{renderError ? "Preview unavailable" : "Preparing your canvas…"}</div>}
            <button className={`rotation-button ${rotating ? "active" : ""}`} onClick={() => setRotating(v => !v)} aria-pressed={rotating} aria-label={rotating ? "Pause rotation" : "Start rotation"}><Icon name="rotate" size={17} /> {rotating ? "Auto-rotate on" : "Auto-rotate off"}</button>
            <div className="preview-hint">{rendering ? "Updating skin…" : "DRAG TO LOOK AROUND"}</div>
          </div>
          <div className="skin-meta"><span><span className="green-dot" /> 64 × 64 px <span className="meta-divider">/</span> PNG skin</span><span>Classic · 4 px arms</span></div>
          <div className="download-row">
            <div><strong>Ready for a new world.</strong><p>Your skin, ready to take with you.</p></div>
            <a className={`button button-dark ${!skin || busy || renderError ? "disabled" : ""}`} href={skin || undefined} download="block-and-you-skin.png" aria-disabled={!skin || busy || !!renderError} onClick={event => { if (!skin || busy || renderError) event.preventDefault(); }}><Icon name="download" size={18} /> Download skin</a>
          </div>
          {renderError && <p role="alert" className="error-message">{renderError} <button onClick={() => setAppearance(a => a ? { ...a } : a)}>Retry preview</button></p>}
        </article>
      </section>

      {notice && <div className="notice" role="status"><Icon name="spark" /><span>{notice}</span></div>}

      <section className="customizer" aria-labelledby="customize-title">
        <div className="section-heading"><div><span className="eyebrow">IT’S ALL IN THE DETAILS</span><h2 id="customize-title">Make it feel like you.</h2><p>A little tweak here, a different color there. You’re in control.</p></div><span className="catalog-count">{optionCount || "…"} options in your wardrobe</span></div>
        <div className="options-grid">{catalog.map(category => {
          const decision = decisions.find(d => d.category === category.id);
          const confidence = decision && decision.choice === appearance?.[category.id] ? decision.confidence : null;
          return <div className="option-field" key={category.id}>
            <label htmlFor={category.id}>{category.label}{confidence != null && <span className="confidence">{Math.round(confidence * 100)}% match</span>}</label>
            <div className="select-wrap">
              {category.options.find(o => o.id === appearance?.[category.id])?.color && <span className="color-swatch" style={{ background: category.options.find(o => o.id === appearance?.[category.id])?.color }} />}
              <select id={category.id} value={appearance?.[category.id] ?? category.default} disabled={generating} className={category.options[0].color ? "with-swatch" : ""} onChange={event => {
                setAppearance(a => a ? { ...a, [category.id]: event.target.value } : a);
              }}>{category.options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
            </div>
          </div>;
        })}</div>
        <div className="customizer-footer"><p>Skirts and hairstyles are pixel-art interpretations on the classic character shape.</p><button disabled={!appearance || generating} onClick={() => {
          setAppearance(Object.fromEntries(catalog.map(c => [c.id, c.default])));
          setDecisions([]);
          setNotice("Restored the default palette. Any previous model selections have been cleared.");
        }}>Reset to default palette <span>↺</span></button></div>
      </section>

      <section id="how-to" className="how-to">
        <div><span className="eyebrow">FROM STUDIO TO SPAWN POINT</span><h2>A new look.<br />Same adventurer.</h2></div>
        <div className="instruction"><span>01 / SAVE IT</span><h3>Download your skin</h3><p>Save the 64 × 64 PNG. Keep the original file size; it’s a skin texture, not a screenshot.</p></div>
        <div className="instruction"><span>02 / EQUIP IT</span><h3>Bring it into Minecraft</h3><p>In Java Launcher: Skins → New skin → Classic → Browse. In Bedrock on Windows or mobile: Dressing Room → Classic Skins → Owned → Import.</p></div>
      </section>
    </main>
    <footer><span className="footer-brand"><Icon name="cube" size={17} /> block&you</span><span>Made of pixels. Full of personality.</span><span>Not affiliated with Mojang or Microsoft.</span></footer>
  </div>;
}
