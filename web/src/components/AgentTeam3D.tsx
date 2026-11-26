import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { AGENT_COLORS } from "./agents";

/** The five LÜMEN agents as glossy toy robots, built from primitives (no model files to download). */

type Bot = { root: THREE.Group; head: THREE.Group; armL: THREE.Group; armR: THREE.Group; eyes: THREE.Mesh[]; home: THREE.Vector3; phase: number };

function makeBot(color: string): Bot {
  const shell = new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06 });
  const visor = new THREE.MeshPhysicalMaterial({ color: "#0B1020", metalness: 0.4, roughness: 0.08, clearcoat: 1 });
  const glow = new THREE.MeshBasicMaterial({ color: "#7FE7FF" });
  const root = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.38, 8, 24), shell);
  body.position.y = 0.78;
  body.scale.set(1, 1, 0.9);
  root.add(body);

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
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  return { root, head, armL, armR, eyes, home: new THREE.Vector3(), phase: Math.random() * 6 };
}

export default function AgentTeam3D({ active, className = "" }: { active: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the section still reads fine without the picture
    }
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
    camera.position.set(0, 2.1, 8.2);
    camera.lookAt(0, 1.1, 0);

    const key = new THREE.DirectionalLight("#ffffff", 1.6);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
    scene.add(key, new THREE.AmbientLight("#ffffff", 0.35));

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.14 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const bots = AGENT_COLORS.map((c, i) => {
      const b = makeBot(c);
      b.home.set((i - 2) * 1.45, 0, i % 2 ? -0.35 : 0);
      b.root.position.copy(b.home);
      scene.add(b.root);
      return b;
    });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      // step back until all five (about 8.6 units wide) fit the frame, whatever its shape
      const half = Math.tan(THREE.MathUtils.degToRad(18));
      camera.position.z = Math.max(6.8, 4.0 / (half * Math.min(camera.aspect, 1.8)));
      camera.position.y = 1.6 + camera.position.z * 0.06;
      camera.lookAt(0, 1.0, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const t = clock.getElapsedTime();
      const act = activeRef.current;
      bots.forEach((b, i) => {
        const on = i === act;
        const target = on ? new THREE.Vector3(b.home.x * 0.85, 0, 1.1) : b.home;
        b.root.position.lerp(target, still ? 1 : 0.08);
        const s = on ? 1.18 : 0.92;
        b.root.scale.lerp(new THREE.Vector3(s, s, s), still ? 1 : 0.08);
        if (!still) {
          b.root.position.y = Math.sin(t * 2 + b.phase) * 0.04;
          b.head.rotation.y = on ? Math.sin(t * 1.3) * 0.25 : Math.sin(t * 0.6 + b.phase) * 0.12;
          b.head.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04;
          b.armR.rotation.z = on ? 0.25 + Math.abs(Math.sin(t * 3)) * 1.6 : 0.25 + Math.sin(t + b.phase) * 0.05; // waves
          b.armL.rotation.z = -0.25 - Math.sin(t + b.phase) * 0.05;
          const blink = (t + b.phase) % 4 < 0.12 ? 0.15 : 1;
          b.eyes.forEach((e) => (e.scale.y = blink));
        }
        b.root.rotation.y = THREE.MathUtils.lerp(b.root.rotation.y, on ? 0 : -b.home.x * 0.08, 0.08);
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        }
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={className} />;
}
