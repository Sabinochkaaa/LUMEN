import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { AGENT_COLORS } from "./agents";
import { makeBot } from "./AgentTeam3D";

/**
 * Landing «team» showcase (design 3.0): all five agents stand in a shallow arc, each on its own pedestal.
 * active = -1 shows the whole team; a picked agent (active = i) gets the camera: it flies in (about a second),
 * leaves room for the info panel (left on wide screens, below on narrow ones) and slowly orbits the robot (±25°). Each robot shows its job — the Analyst scans a sheet,
 * the Skeptic raises a magnifier, the FinTech expert tosses a ₸ coin, the Translator cycles letters, Support waves
 * with a headset on. Heads follow the pointer; a click on a robot picks it.
 * Calls onFail when WebGL is unavailable so the page can keep its static picture.
 */
const GLYPHS = ["А", "Ә", "A", "文", "Ü"];

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, redraw: (fn: typeof draw) => { g.clearRect(0, 0, size, size); fn(g, size); tex.needsUpdate = true; } };
}

const easeBack = (p: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export default function TeamShowcase3D({ active, onPick, onFail, className = "", label }: {
  active: number; onPick: (i: number) => void; onFail?: () => void; className?: string; label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ active, onPick });
  state.current = { active, onPick };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onFail?.();
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);

    // studio light: a soft key from the upper right, a cool fill, a rim from behind
    const key = new THREE.DirectionalLight("#ffffff", 1.7);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 8;
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 6, bottom: -6 });
    key.shadow.mapSize.set(2048, 1024);
    const fill = new THREE.DirectionalLight("#dfe8ff", 0.45);
    fill.position.set(-6, 3, 4);
    const rim = new THREE.DirectionalLight("#ffffff", 0.6);
    rim.position.set(0, 4, -6);
    scene.add(key, fill, rim, new THREE.AmbientLight("#ffffff", 0.3));

    // podium: a low disc in the page's surface colour, re-tinted when the theme changes
    const podiumMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const edgeMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const tintPodium = () => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (v: string) => {
        const [r, g, b] = css.getPropertyValue(v).trim().split(/\s+/).map((n) => Number(n) / 255);
        return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
      };
      podiumMat.color.copy(rgb("--surface"));
      edgeMat.color.copy(rgb("--line"));
    };
    tintPodium();
    const mo = new MutationObserver(tintPodium);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const SPACING = 1.85;
    const spot = (i: number) => new THREE.Vector3((i - 2) * SPACING, 0, Math.abs(i - 2) * 0.4 - 0.4); // arc opening to the viewer
    AGENT_COLORS.forEach((_, i) => {
      const at = spot(i);
      const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.86, 0.14, 72), [edgeMat, podiumMat, edgeMat]);
      podium.position.set(at.x, -0.07, at.z);
      podium.receiveShadow = true;
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 72), new THREE.ShadowMaterial({ opacity: 0.18 }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(at.x, 0.002, at.z);
      shadow.receiveShadow = true;
      scene.add(podium, shadow);
    });

    // five robots, one per pedestal, turned slightly towards the middle
    const bots = AGENT_COLORS.map((c, i) => {
      const b = makeBot(c, false);
      b.home.copy(spot(i));
      b.face = -(i - 2) * 0.12;
      b.root.position.copy(b.home);
      b.root.rotation.y = b.face;
      b.hit.forEach((h) => (h.userData.i = i));
      scene.add(b.root);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.66, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(b.home.x, 0.01, b.home.z);
      scene.add(ring);
      const eyeMat = b.eyes[0].material as THREE.MeshBasicMaterial;
      return { ...b, ring, eyeMat, lift: 0 };
    });
    const hitList = bots.flatMap((b) => b.hit);
    const EYE_ON = new THREE.Color("#7FE7FF");
    const EYE_OFF = new THREE.Color("#1A2236");
    if (!still) bots.forEach((b) => b.eyeMat.color.copy(EYE_OFF));

    const white = new THREE.MeshPhysicalMaterial({ color: "#F4F6FA", roughness: 0.35, clearcoat: 0.6 });
    const dark = new THREE.MeshPhysicalMaterial({ color: "#20283A", roughness: 0.3, metalness: 0.4 });

    // 0 · Analyst: a sheet held at the chest with a scan line running over it
    const sheet = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.012), white);
    sheet.add(paper);
    const linesMat = new THREE.MeshBasicMaterial({ color: "#B9C2D3" });
    for (let r = 0; r < 6; r++) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(r % 3 === 2 ? 0.22 : 0.34, 0.022), linesMat);
      ln.position.set(r % 3 === 2 ? -0.06 : 0, 0.2 - r * 0.075, 0.008);
      sheet.add(ln);
    }
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.03), new THREE.MeshBasicMaterial({ color: "#2F6BFF", transparent: true, opacity: 0.85 }));
    scan.position.z = 0.009;
    sheet.add(scan);
    sheet.position.set(0, 0.98, 0.58);
    sheet.rotation.x = -0.22;
    bots[0].root.add(sheet);

    // 1 · Skeptic: a magnifier that rests at the hip and is raised to the visor every few seconds
    const loupe = new THREE.Group();
    loupe.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.026, 12, 40), dark));
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.14, 40), new THREE.MeshPhysicalMaterial({ color: "#CFE9FF", transmission: 0.6, transparent: true, opacity: 0.45, roughness: 0.05 }));
    loupe.add(glass);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.26, 12), dark);
    handle.position.y = -0.28;
    loupe.add(handle);
    bots[1].root.add(loupe);

    // 2 · FinTech expert: a ₸ coin tossed and caught
    const coinFace = canvasTexture((g, s) => {
      g.fillStyle = "#E7B24A"; g.fillRect(0, 0, s, s);
      g.strokeStyle = "#B9832A"; g.lineWidth = s * 0.05; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#8A5C14"; g.font = `700 ${s * 0.52}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("₸", s / 2, s / 2 + s * 0.03);
    });
    const gold = new THREE.MeshPhysicalMaterial({ color: "#E7B24A", metalness: 0.85, roughness: 0.25 });
    const faceMat = new THREE.MeshPhysicalMaterial({ map: coinFace.tex, metalness: 0.6, roughness: 0.3 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 40), [gold, faceMat, faceMat]);
    coin.castShadow = true;
    bots[2].root.add(coin);

    // 3 · Translator: a speech bubble above the head that cycles letters of different scripts
    const drawGlyph = (ch: string) => (g: CanvasRenderingContext2D, s: number) => {
      g.fillStyle = "#FFFFFF"; g.strokeStyle = "#D6DBE4"; g.lineWidth = 6;
      g.beginPath(); g.roundRect(14, 14, s - 28, s - 64, 36); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(s * 0.42, s - 52); g.lineTo(s * 0.5, s - 18); g.lineTo(s * 0.58, s - 52); g.closePath(); g.fill();
      g.fillStyle = "#0F1B2D"; g.font = `600 ${s * 0.42}px -apple-system, "SF Pro Display", "Inter Variable", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(ch, s / 2, (s - 50) / 2 + 8);
    };
    const bubble = canvasTexture(drawGlyph(GLYPHS[0]));
    const bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubble.tex, transparent: true, depthWrite: false }));
    bubbleSprite.position.set(0.35, 2.55, 0);
    bubbleSprite.scale.setScalar(0.62);
    bots[3].root.add(bubbleSprite);
    let glyph = 0;

    // 4 · Support: a headset with a boom mic
    const headset = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 10, 48, Math.PI), dark);
    headset.add(band);
    for (const x of [-0.58, 0.58]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 24), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.x = x;
      headset.add(cup);
    }
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), dark);
    boom.rotation.set(Math.PI / 2, 0, 0.5);
    boom.position.set(-0.5, -0.16, 0.2);
    headset.add(boom);
    const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: "#F0453A" }));
    micTip.position.set(-0.4, -0.25, 0.4);
    headset.add(micTip);
    bots[4].head.add(headset);

    [sheet, loupe, coin, headset].forEach((g) => g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }));

    const look = new THREE.Vector2();
    const onWinMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      look.set(THREE.MathUtils.clamp((ev.clientX - (r.left + r.width / 2)) / (r.width * 0.8), -1, 1),
        THREE.MathUtils.clamp((ev.clientY - (r.top + r.height / 2.5)) / (r.height * 0.9), -1, 1));
    };
    window.addEventListener("pointermove", onWinMove);

    let baseZ = 10; // camera distance on a picked robot
    let overZ = 12; // camera distance for the whole team
    const half = Math.tan(THREE.MathUtils.degToRad(16));
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      // a picked robot (≈2.9 units with the speech bubble) fills about two thirds of the height; narrow screens step back
      baseZ = Math.max(6.2, 1.45 / (half * Math.min(camera.aspect, 1)));
      // the whole arc (±4.3 units) fits the width, the robots' height fits the height
      overZ = Math.max(7.2, 5.1 / (half * camera.aspect));
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let hovered = -1;
    const pickAt = (ev: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(hitList, false)[0];
      return hit ? (hit.object.userData.i as number) : -1;
    };
    const cv = renderer.domElement;
    const onMove = (ev: MouseEvent) => { hovered = pickAt(ev); cv.style.cursor = hovered >= 0 ? "pointer" : ""; };
    const onLeave = () => { hovered = -1; cv.style.cursor = ""; };
    const onClick = (ev: MouseEvent) => { const i = pickAt(ev); if (i >= 0) state.current.onPick(i); };
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("click", onClick);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    const target = new THREE.Vector3(0, 1.1, 0);
    const focus = new THREE.Vector3(0, 1.1, 0); // the point the camera circles
    let dist = 0; // current camera distance (0 = not set yet)
    let zoom = 0; // 0 = whole team, 1 = a picked robot
    const aim = new THREE.Vector3();
    let raf = 0;
    let prevT = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const t = still ? 99 : clock.getElapsedTime();
      const dt = Math.min(0.25, Math.max(0, t - prevT));
      prevT = t;
      const act = state.current.active;

      // camera: the whole team, or flies to the picked robot and orbits it gently (about ±25°); time-based, ~1 s
      const fi = act;
      const k = still ? 1 : 1 - Math.exp(-dt * 3.2);
      if (fi >= 0) target.set(bots[fi].home.x, 1.15, bots[fi].home.z);
      else target.set(0, 1.05, 0);
      focus.lerp(target, k);
      const wantDist = fi >= 0 ? baseZ : overZ;
      dist = dist ? dist + (wantDist - dist) * k : wantDist;
      zoom += ((fi >= 0 ? 1 : 0) - zoom) * k;
      const orbit = still ? 0 : zoom * Math.sin(t * 0.32) * 0.42 + look.x * 0.12;
      camera.position.set(focus.x + Math.sin(orbit) * dist, focus.y + 0.7 - look.y * (still ? 0 : 0.2), focus.z + Math.cos(orbit) * dist);
      // leave room for the info panel: on wide screens the robot moves right, on narrow ones up
      const wide = camera.aspect > 1.15;
      const shiftX = wide ? dist * half * camera.aspect * 0.42 * zoom : 0;
      const shiftY = wide ? 0 : dist * half * 0.42 * zoom;
      aim.set(focus.x - Math.cos(orbit) * shiftX, focus.y - shiftY, focus.z + Math.sin(orbit) * shiftX);
      camera.lookAt(aim);

      bots.forEach((b, i) => {
        // power-on: one after another, a small drop and an overshoot
        const p = clamp01((t - 0.25 - i * 0.28) / 0.55);
        const on = i === act;
        const over = i === hovered;
        const s = Math.max(0.001, easeBack(p)) * (over ? 1.03 : 1);
        b.root.scale.lerp(tmp.set(s, s, s), p < 1 ? 1 : 0.12);
        tmp.set(b.home.x, 0, b.home.z);
        b.root.position.lerp(tmp, still ? 1 : 0.08);
        b.root.position.y = (1 - p) * 0.6 + (still ? 0 : Math.sin(t * 2 + b.phase) * 0.03);
        b.eyeMat.color.lerp(p >= 1 ? EYE_ON : EYE_OFF, still ? 1 : 0.15);
        const ringOp = on ? 0.95 : over ? 0.55 : 0;
        const rm = b.ring.material as THREE.MeshBasicMaterial;
        rm.opacity = THREE.MathUtils.lerp(rm.opacity, ringOp, 0.15);
        b.ring.position.set(b.root.position.x, 0.01, b.root.position.z);

        // body turns to the viewer when picked or hovered; otherwise keeps its place in the arc
        const faceTo = on || over ? 0 : b.face;
        b.root.rotation.y = THREE.MathUtils.lerp(b.root.rotation.y, faceTo, 0.08);
        if (!still) {
          // whole team: heads follow the pointer; picked: it watches the camera, the rest look at it
          const glance = fi < 0 ? look.x * 0.45 : i === fi ? orbit * 0.9 + look.x * 0.2 : Math.sign(fi - i) * 0.5;
          b.head.rotation.y = THREE.MathUtils.lerp(b.head.rotation.y, glance, 0.07);
          b.head.rotation.x = THREE.MathUtils.lerp(b.head.rotation.x, look.y * 0.18, 0.07);
          b.head.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04;
          if (p >= 1 && (t + b.phase) % 4 < 0.12) b.eyes.forEach((e) => (e.scale.y = 0.15));
          else b.eyes.forEach((e) => (e.scale.y = 1));
        }
        b.armL.rotation.z = -0.25;
        b.armR.rotation.z = 0.25;
      });

      const L = (v: number, to: number, k = 0.12) => (still ? to : THREE.MathUtils.lerp(v, to, k));

      // Analyst: both arms forward holding the sheet, a scan line running down and back
      const an = bots[0];
      an.armL.rotation.x = L(an.armL.rotation.x, -1.25);
      an.armR.rotation.x = L(an.armR.rotation.x, -1.25);
      scan.position.y = still ? 0 : Math.sin(t * 1.6) * 0.26;

      // Skeptic: every 4 s the magnifier goes up to the visor, the eyes narrow
      const sk = bots[1];
      const cyc = (t % 4.2) / 4.2;
      const raise = still ? 0 : cyc < 0.15 ? cyc / 0.15 : cyc < 0.55 ? 1 : cyc < 0.7 ? 1 - (cyc - 0.55) / 0.15 : 0;
      const e = raise * raise * (3 - 2 * raise);
      loupe.position.set(THREE.MathUtils.lerp(0.56, 0.16, e), THREE.MathUtils.lerp(0.72, 1.6, e), THREE.MathUtils.lerp(0.22, 0.66, e));
      loupe.rotation.set(0, 0, THREE.MathUtils.lerp(0.5, 0.1, e));
      sk.armR.rotation.x = -0.3 - e * 1.9;
      sk.armR.rotation.z = 0.25 - e * 0.25;
      if (!still && e > 0.5) sk.eyes.forEach((m) => (m.scale.y = 0.45));
      sk.head.rotation.x = THREE.MathUtils.lerp(sk.head.rotation.x, e * 0.12, 0.2);

      // FinTech expert: toss every 2.4 s, the coin spins in flight and lands in the palm
      const fx = bots[2];
      const ct = (t % 2.4) / 2.4;
      const flight = still ? 1 : clamp01(ct / 0.6);
      const air = flight < 1 ? 4 * flight * (1 - flight) : 0;
      coin.position.set(0.55, 0.8 + air * 1.2, 0.45);
      coin.rotation.set(Math.PI / 2 + (flight < 1 ? flight * Math.PI * 6 : 0), 0, 0);
      fx.armR.rotation.x = L(fx.armR.rotation.x, ct < 0.08 || ct > 0.92 ? -1.0 : -0.7, 0.2);

      // Translator: the bubble pops with the next letter every 1.2 s
      const tr = bots[3];
      const gi = Math.floor(t / 1.2) % GLYPHS.length;
      if (!still && gi !== glyph) { glyph = gi; bubble.redraw(drawGlyph(GLYPHS[gi])); }
      const pop = still ? 1 : easeBack(clamp01(((t % 1.2) / 1.2) / 0.22));
      const bp = clamp01((t - 0.25 - 3 * 0.28 - 0.4) / 0.3);
      bubbleSprite.scale.setScalar(0.62 * Math.max(0.001, pop * bp));
      bubbleSprite.position.y = 2.55 + (still ? 0 : Math.sin(t * 2) * 0.03);
      tr.armL.rotation.x = L(tr.armL.rotation.x, -0.2);

      // Support: waves every 3.5 s and when picked
      const su = bots[4];
      const wave = act === 4 || hovered === 4 || (!still && (t % 3.5) < 1.4 && t > 2);
      su.armR.rotation.x = L(su.armR.rotation.x, wave ? -2.65 : -0.15, 0.15);
      su.armR.rotation.z = wave && !still ? 0.25 + Math.sin(t * 9) * 0.35 : 0.25;
      micTip.scale.setScalar(1 + (still ? 0 : Math.max(0, Math.sin(t * 5)) * 0.25));

      // whoever is picked waves hello (except the Skeptic and the Analyst, whose hands are busy)
      if (act >= 0 && act !== 4 && act !== 0 && act !== 1 && !still) {
        const b = bots[act];
        b.armR.rotation.x = -2.6;
        b.armR.rotation.z = 0.25 + Math.abs(Math.sin(t * 6)) * 0.6;
      }

      renderer.render(scene, camera);
    };
    tick();
    if ((import.meta as any).env?.DEV) (window as any).__lumenShowcase = { camera, bots }; // dev-only: lets a test check the framing

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("click", onClick);
      window.removeEventListener("pointermove", onWinMove);
      const seen = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh | THREE.Sprite;
        if ((m as THREE.Mesh).isMesh || (m as THREE.Sprite).isSprite) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if (!seen.has(x)) { seen.add(x); x.dispose(); } });
        }
      });
      coinFace.tex.dispose();
      bubble.tex.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      cv.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={className} role={label ? "img" : undefined} aria-label={label} />;
}
