import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { AGENT_COLORS } from "./agents";

/**
 * The five LÜMEN agents as glossy toy robots, built from primitives (no model files to download).
 * mode "lineup": a row; the active one steps forward and waves.
 * mode "office": each stands at a desk with a laptop; `working` types and its screen glows; `finished` makes all hop.
 * Robots react to hover and are clickable (onPick).
 */
export type Bot = {
  root: THREE.Group; head: THREE.Group; armL: THREE.Group; armR: THREE.Group; eyes: THREE.Mesh[]; home: THREE.Vector3;
  face: number; phase: number; hit: THREE.Object3D[]; screen?: THREE.MeshStandardMaterial;
};

export function makeBot(color: string, desk: boolean): Bot {
  const shell = new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06 });
  const visor = new THREE.MeshPhysicalMaterial({ color: "#0B1020", metalness: 0.4, roughness: 0.08, clearcoat: 1 });
  const glow = new THREE.MeshBasicMaterial({ color: "#7FE7FF" });
  const root = new THREE.Group();
  const hit: THREE.Object3D[] = [];

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.38, 8, 24), shell);
  body.position.y = 0.78;
  body.scale.set(1, 1, 0.9);
  root.add(body);
  hit.push(body);
  for (const x of [-0.18, 0.18]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.18, 6, 16), shell);
    leg.position.set(x, 0.2, 0);
    root.add(leg);
  }
  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.5 * side, 1.0, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 16), shell);
    m.position.y = -0.2;
    g.add(m);
    g.rotation.z = 0.25 * side;
    root.add(g);
    return g;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const head = new THREE.Group();
  head.position.y = 1.62;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 32), shell);
  skull.scale.set(1.12, 0.95, 1);
  head.add(skull);
  hit.push(skull);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 32), visor);
  face.scale.set(0.86, 0.62, 0.42);
  face.position.set(0, -0.02, 0.33);
  head.add(face);
  const eyes: THREE.Mesh[] = [];
  for (const x of [-0.16, 0.16]) {
    const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.06, 4, 12), glow);
    e.position.set(x, 0, 0.53);
    head.add(e);
    eyes.push(e);
  }
  root.add(head);

  let screen: THREE.MeshStandardMaterial | undefined;
  if (desk) {
    const white = new THREE.MeshPhysicalMaterial({ color: "#F1F3F8", roughness: 0.3, clearcoat: 0.7 });
    const metal = new THREE.MeshPhysicalMaterial({ color: "#2A3142", metalness: 0.6, roughness: 0.3 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 0.62), white);
    top.position.set(0, 0.95, 0.66);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.92, 16), white);
    stem.position.set(0, 0.47, 0.66);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.38), metal);
    base.position.set(0, 1.0, 0.62);
    screen = new THREE.MeshStandardMaterial({ color: "#0F1626", emissive: new THREE.Color(color), emissiveIntensity: 0.15 });
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z — the -z face looks back at the robot
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.03), [metal, metal, metal, metal, metal, screen]);
    lid.position.set(0, 1.2, 0.84);
    lid.rotation.x = 0.28;
    root.add(top, stem, base, lid);
    hit.push(top, lid);
  }
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { root, head, armL, armR, eyes, home: new THREE.Vector3(), face: 0, phase: Math.random() * 6, hit, screen };
}

export default function AgentTeam3D({ active = -1, onPick, mode = "lineup", working = -1, finished = false, className = "", label,
  agent = 0, mood = "idle", tint }: {
  active?: number; onPick?: (i: number) => void; mode?: "lineup" | "office" | "solo"; working?: number; finished?: boolean;
  className?: string; label?: string;
  /** solo mode: which agent, what it is doing, and the colour of the glowing tablet it holds */
  agent?: number; mood?: "idle" | "working" | "done"; tint?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ active, working, finished, onPick, mood, tint });
  state.current = { active, working, finished, onPick, mood, tint };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the page still works without the picture
    }
    const office = mode === "office";
    const solo = mode === "solo";
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
    const key = new THREE.DirectionalLight("#ffffff", 1.6);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    scene.add(key, new THREE.AmbientLight("#ffffff", 0.35));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.14 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const cast = solo ? [AGENT_COLORS[agent] ?? AGENT_COLORS[0]] : AGENT_COLORS;
    const bots = cast.map((c, i) => {
      const b = makeBot(c, office);
      if (solo) {
        b.home.set(0, 0, 0);
      } else if (office) {
        const a = (i - 2) * 0.36; // desks on a gentle arc around the viewer
        b.home.set(Math.sin(a) * 5.4, 0, 5.4 - Math.cos(a) * 5.4);
        b.face = -a;
      } else {
        b.home.set((i - 2) * 1.45, 0, i % 2 ? -0.35 : 0);
      }
      b.root.position.copy(b.home);
      b.root.rotation.y = b.face;
      b.hit.forEach((h) => (h.userData.i = solo ? agent : i));
      scene.add(b.root);
      return b;
    });
    const hitList = bots.flatMap((b) => b.hit);

    // solo: a glowing tablet held in front of the chest, and a head that follows the pointer
    const tabletMat = new THREE.MeshStandardMaterial({ color: "#0F1626", emissive: new THREE.Color(tint ?? AGENT_COLORS[agent] ?? "#7C4DFF"), emissiveIntensity: 0.25 });
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.025), tabletMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.02),
      new THREE.MeshPhysicalMaterial({ color: "#F1F3F8", roughness: 0.25, clearcoat: 1 }));
    frame.position.z = -0.015;
    tablet.add(frame);
    const sparks: THREE.Mesh[] = [];
    if (solo) {
      tablet.position.set(0, 0.86, 0.6);
      tablet.rotation.x = -0.55;
      bots[0].root.add(tablet);
      for (let k = 0; k < 6; k++) {
        const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 }));
        scene.add(sp);
        sparks.push(sp);
      }
    }
    const look = new THREE.Vector2();
    const onWinMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      look.set(THREE.MathUtils.clamp((ev.clientX - (r.left + r.width / 2)) / 500, -1, 1),
        THREE.MathUtils.clamp((ev.clientY - (r.top + r.height / 3)) / 500, -1, 1));
    };
    if (solo) window.addEventListener("pointermove", onWinMove);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      const half = Math.tan(THREE.MathUtils.degToRad(18));
      if (solo) {
        camera.position.set(0, 1.5, 4.6);
        camera.lookAt(0, 1.0, 0);
      } else {
        const z = Math.max(6.8, (office ? 4.6 : 4.0) / (half * Math.min(camera.aspect, 1.8)));
        camera.position.set(0, (office ? 3.4 : 1.6) + z * 0.06, z + (office ? 1.2 : 0));
        camera.lookAt(0, office ? 1.25 : 1.0, office ? 0.9 : 0);
      }
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // hover and click: a ray from the pointer finds the robot under it
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
    const onMove = (ev: MouseEvent) => {
      hovered = pickAt(ev);
      renderer.domElement.style.cursor = hovered >= 0 && state.current.onPick ? "pointer" : "";
    };
    const onLeave = () => { hovered = -1; renderer.domElement.style.cursor = ""; };
    const onClick = (ev: MouseEvent) => {
      const i = pickAt(ev);
      if (i >= 0) state.current.onPick?.(i);
    };
    const cv = renderer.domElement;
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("click", onClick);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const t = clock.getElapsedTime();
      const { active: act, working: work, finished: fin, mood: md, tint: tn } = state.current;
      bots.forEach((b, i) => {
        const over = solo ? hovered >= 0 : i === hovered;
        if (solo) {
          const busy = md === "working";
          const done = md === "done";
          if (tn) tabletMat.emissive.lerp(new THREE.Color(tn), 0.08);
          tabletMat.emissiveIntensity = busy ? 1.1 + Math.sin(t * 10) * 0.3 : done ? 0.9 : 0.55;
          const s = over ? 1.06 : 1;
          b.root.scale.lerp(tmp.set(s, s, s), 0.12);
          if (!still) {
            b.root.position.y = done ? Math.abs(Math.sin(t * 4.5)) * 0.28 : Math.sin(t * 2 + b.phase) * 0.04;
            b.root.rotation.y = THREE.MathUtils.lerp(b.root.rotation.y, look.x * 0.35, 0.06);
            b.head.rotation.y = THREE.MathUtils.lerp(b.head.rotation.y, busy ? Math.sin(t * 2.2) * 0.12 : look.x * 0.5, 0.1);
            b.head.rotation.x = THREE.MathUtils.lerp(b.head.rotation.x, busy ? 0.32 + Math.sin(t * 7) * 0.04 : look.y * 0.3, 0.1);
            // arms hold the tablet; when done or greeted, the right one waves
            b.armL.rotation.x = THREE.MathUtils.lerp(b.armL.rotation.x, -1.0 + (busy ? Math.sin(t * 16) * 0.15 : 0), 0.15);
            b.armR.rotation.x = THREE.MathUtils.lerp(b.armR.rotation.x, done || over ? -2.6 : -1.0 + (busy ? Math.sin(t * 16 + 1.5) * 0.15 : 0), 0.15);
            b.armR.rotation.z = done || over ? 0.25 + Math.sin(t * 9) * 0.35 : 0.25;
            tablet.rotation.y = busy ? Math.sin(t * 3) * 0.12 : 0;
            sparks.forEach((sp, k) => {
              const a = t * (busy ? 2.4 : 1) + (k / sparks.length) * Math.PI * 2;
              sp.position.set(Math.cos(a) * 0.9, 1.0 + Math.sin(a * 1.7) * 0.35 + b.root.position.y, Math.sin(a) * 0.5 + 0.4);
              sp.rotation.set(t * 2, t * 3, 0);
              const m = sp.material as THREE.MeshBasicMaterial;
              m.opacity = THREE.MathUtils.lerp(m.opacity, busy || done ? 0.9 : 0, 0.08);
              m.color.copy(tabletMat.emissive);
            });
          }
        } else if (office) {
          const typing = i === work && !fin;
          const s = (typing ? 1.08 : 1) * (over ? 1.06 : 1);
          b.root.scale.lerp(tmp.set(s, s, s), 0.12);
          if (!still) {
            b.root.position.y = fin ? Math.abs(Math.sin(t * 5 + i * 0.7)) * 0.35 : Math.sin(t * 2 + b.phase) * 0.03;
            b.armR.rotation.x = typing ? -1.15 + Math.sin(t * 18) * 0.25 : fin ? -2.7 : -0.15;
            b.armL.rotation.x = typing ? -1.15 + Math.sin(t * 18 + 1.6) * 0.25 : fin ? -2.7 : -0.15;
            b.head.rotation.x = typing ? 0.2 + Math.sin(t * 6) * 0.03 : 0;
            b.head.rotation.y = typing ? Math.sin(t * 1.5) * 0.15 : Math.sin(t * 0.5 + b.phase) * 0.3;
          }
          if (b.screen) b.screen.emissiveIntensity = typing ? 0.9 + Math.sin(t * 9) * 0.25 : fin ? 0.7 : 0.12;
        } else {
          const on = i === act;
          tmp.set(b.home.x * (on ? 0.85 : 1), 0, on ? 1.1 : b.home.z);
          b.root.position.lerp(tmp, still ? 1 : 0.08);
          const s = (on ? 1.18 : 0.92) * (over ? 1.07 : 1);
          b.root.scale.lerp(tmp.set(s, s, s), still ? 1 : 0.1);
          if (!still) {
            b.root.position.y = Math.sin(t * 2 + b.phase) * 0.04 + (over ? 0.08 : 0);
            b.head.rotation.y = on ? Math.sin(t * 1.3) * 0.25 : Math.sin(t * 0.6 + b.phase) * 0.12;
            b.armR.rotation.z = on || over ? 0.25 + Math.abs(Math.sin(t * 3)) * 1.6 : 0.25 + Math.sin(t + b.phase) * 0.05;
            b.armL.rotation.z = -0.25 - Math.sin(t + b.phase) * 0.05;
          }
          b.root.rotation.y = THREE.MathUtils.lerp(b.root.rotation.y, on ? 0 : -b.home.x * 0.08, 0.08);
        }
        if (!still) {
          b.head.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04;
          const blink = (t + b.phase) % 4 < 0.12 ? 0.15 : 1;
          b.eyes.forEach((e) => (e.scale.y = blink));
        }
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("click", onClick);
      window.removeEventListener("pointermove", onWinMove);
      const seen = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if (!seen.has(x)) { seen.add(x); x.dispose(); } });
        }
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      cv.remove();
    };
  }, [mode, agent]);

  return <div ref={host} className={className} role={label ? "img" : undefined} aria-label={label} />;
}
