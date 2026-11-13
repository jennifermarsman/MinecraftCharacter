import { useEffect, useRef, useState } from "react";
import { SkinViewer, IdleAnimation } from "skinview3d";

function FlatCharacter({ skin }: { skin: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, 160, 320);
      ctx.imageSmoothingEnabled = false;
      const faces = [
        [8, 8, 8, 8, 40, 0, 80, 80], [40, 8, 8, 8, 40, 0, 80, 80],
        [20, 20, 8, 12, 40, 80, 80, 120], [20, 36, 8, 12, 40, 80, 80, 120],
        [44, 20, 4, 12, 0, 80, 40, 120], [36, 52, 4, 12, 120, 80, 40, 120],
        [4, 20, 4, 12, 40, 200, 40, 120], [20, 52, 4, 12, 80, 200, 40, 120],
      ];
      for (const [sx, sy, sw, sh, dx, dy, dw, dh] of faces) {
        ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    };
    image.src = skin;
    return () => { active = false; };
  }, [skin]);
  return <canvas ref={ref} width={160} height={320} className="flat-character" aria-label="Front view of your character" />;
}

export function CharacterPreview({ skin, rotating }: { skin: string; rotating: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!canvas.current || !container.current) return;
    let instance: SkinViewer;
    try {
      instance = new SkinViewer({ canvas: canvas.current, width: 400, height: 420 });
    } catch {
      setUnavailable(true);
      return;
    }
    viewer.current = instance;
    instance.fov = 40;
    instance.zoom = 0.9;
    instance.animation = new IdleAnimation();
    instance.controls.enableZoom = false;
    instance.controls.enablePan = false;
    instance.playerObject.rotation.y = -0.35;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      instance.setSize(width, height);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = viewer.current;
    if (!instance || !skin) return;
    let active = true;
    instance.loadSkin(skin, { model: "default" })
      .then(() => { if (active) setLoadError(false); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [skin]);

  useEffect(() => {
    if (viewer.current) viewer.current.autoRotate = rotating;
  }, [rotating]);

  return <div className="character-viewport" ref={container}>
    <canvas ref={canvas} hidden={unavailable || loadError} aria-label="Interactive 3D Minecraft character; drag to rotate" />
    {(unavailable || loadError) && <>
      <FlatCharacter skin={skin} />
      <span className="fallback-note">3D unavailable · front view</span>
    </>}
  </div>;
}
