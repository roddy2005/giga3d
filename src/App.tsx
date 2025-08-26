import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ----------------------------------------------------
// 3D 투상도 시뮬레이터
// - 포켓 블록 2종 유지
// - 새 도형 추가: 대각 능선 블록(diagRidgeBlock) + 코너 삼각 절삭 블록(cornerChamfer)
// - 그림자/윤곽선/그리드/축 토글 + 셀프 테스트 강화
// ----------------------------------------------------

// ---------- 재질/윤곽선 ----------
function makeStandardMaterial() {
  return new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
}

function withEdges(mesh: THREE.Mesh, color = 0x222222) {
  const group = new THREE.Group();
  group.add(mesh);
  if (mesh.geometry) {
    const edges = new THREE.EdgesGeometry(mesh.geometry as THREE.BufferGeometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color, linewidth: 1 })
    );
    (line as any).name = "__edges__"; // 윤곽선 토글용 식별자
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    line.scale.copy(mesh.scale);
    group.add(line);
  }
  return group;
}

// ---------- 커스텀 지오메트리 ----------
function buildDiagonalRidgeBlock(ox = 1.8, oy = 1.0, oz = 1.0, drop = 0.45) {
  // 직육면체 상부가 대각선(앞왼 -> 뒤오) 능선으로 접히는 형태
  const x0 = -ox / 2, x1 = ox / 2;
  const z0 = -oz / 2, z1 = oz / 2;
  const yb = -oy / 2;                // 바닥 높이
  const yh = oy / 2;                 // 상단 기준 높이(능선 꼭짓점)
  const yl = yh - drop;              // 낮은 꼭짓점 높이

  // 정점 8개 (바닥 4 + 상단 4)
  const positions = new Float32Array([
    // 바닥: 0..3 (시계)
    x0, yb, z0,   // 0 bottom FL
    x1, yb, z0,   // 1 bottom FR
    x1, yb, z1,   // 2 bottom BR
    x0, yb, z1,   // 3 bottom BL
    // 상단: 4..7
    x0, yh, z0,   // 4 top FL (능선 높음)
    x1, yl, z0,   // 5 top FR (낮음)
    x1, yh, z1,   // 6 top BR (능선 높음)
    x0, yl, z1,   // 7 top BL (낮음)
  ]);

  const indices = [
    // bottom
    0, 1, 2,  0, 2, 3,
    // front (z0)
    0, 1, 5,  0, 5, 4,
    // back (z1)
    3, 2, 6,  3, 6, 7,
    // left (x0)
    0, 4, 7,  0, 7, 3,
    // right (x1)
    1, 2, 6,  1, 6, 5,
    // top (두 삼각으로 능선 형성: 4-6)
    4, 5, 6,  4, 6, 7,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildCornerChamferBlock(
  ox = 1.8, oy = 1.0, oz = 1.0,
  cutX = 0.6, // 윗면 앞가장자리에서 x 방향으로 잘라낼 길이
  cutZ = 0.6, // 윗면 왼가장자리에서 z 방향으로 잘라낼 길이
  cutY = 0.5  // 앞-왼 모서리에서 아래로 잘라낼 길이
) {
  // 직육면체의 앞-왼-윗 모서리를 한 평면으로 절삭한 형태
  const x0 = -ox / 2, x1 = ox / 2;
  const z0 = -oz / 2, z1 = oz / 2;
  const y0 = -oy / 2, y1 = oy / 2;

  // 원래 상단 코너(v001)를 대체하는 절삭 평면의 3점
  const A = new THREE.Vector3(x0 + cutX, y1, z0); // top front 에서 x로 안쪽
  const B = new THREE.Vector3(x0, y1, z0 + cutZ); // top left  에서 z로 안쪽
  const C = new THREE.Vector3(x0, y1 - cutY, z0); // front left 에서 y로 아래

  // 나머지 꼭짓점들
  const v000 = new THREE.Vector3(x0, y0, z0);
  const v100 = new THREE.Vector3(x1, y0, z0);
  const v110 = new THREE.Vector3(x1, y0, z1);
  const v010 = new THREE.Vector3(x0, y0, z1);
  const v101 = new THREE.Vector3(x1, y1, z0);
  const v111 = new THREE.Vector3(x1, y1, z1);
  const v011 = new THREE.Vector3(x0, y1, z1);

  const verts = [v000, v100, v110, v010, v101, v111, v011, A, B, C];
  const positions: number[] = [];
  verts.forEach(v => positions.push(v.x, v.y, v.z));

  // 삼각형 인덱스(반시계, 외부를 바라보도록; DoubleSide 재질이라 민감도 낮음)
  const indices = [
    // bottom (y=y0)
    0, 1, 2,  0, 2, 3,
    // back (z=z1)
    3, 2, 5,  3, 5, 6,
    // right (x=x1)
    1, 2, 5,  1, 5, 4,
    // top (A, v101, v111, v011, B)
    7, 4, 5,  7, 5, 6,  7, 6, 8,
    // front (z=z0) -> (v000, v100, v101, A, C)
    0, 1, 4,  0, 4, 7,  0, 7, 9,
    // left (x=x0) -> (v000, C, B, v011, v010)
    0, 9, 8,  0, 8, 6,  0, 6, 3,
    // chamfer face (A,B,C)
    7, 8, 9,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---------- 도형 팩토리 ----------
function createShape(kind: string) {
  const mat = makeStandardMaterial();

  switch (kind) {
    case "cube": {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "box": {
      const geo = new THREE.BoxGeometry(1.2, 0.8, 0.6);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "cylinder": {
      const geo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 48);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "cone": {
      const geo = new THREE.ConeGeometry(0.6, 1.2, 48);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "sphere": {
      const geo = new THREE.SphereGeometry(0.7, 40, 32);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "torus": {
      const geo = new THREE.TorusGeometry(0.6, 0.2, 24, 64);
      const mesh = new THREE.Mesh(geo, mat);
      return mesh; // 윤곽선 생략(과도 방지)
    }
    case "triangularPrism": {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(1.2, 0);
      shape.lineTo(0, 0.8);
      shape.lineTo(0, 0);
      const extrude = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false });
      extrude.center();
      const mesh = new THREE.Mesh(extrude, mat);
      return withEdges(mesh);
    }
    case "uBlock": {
      // ㅜ자(U) 블록: 세 박스 조합(겹침 없음)
      const bar = new THREE.BoxGeometry(1.2, 0.3, 0.8);
      const leg = new THREE.BoxGeometry(0.3, 1.0, 0.8);
      const mBar = new THREE.Mesh(bar, mat);
      const mL = new THREE.Mesh(leg, mat);
      const mR = new THREE.Mesh(leg, mat);
      mBar.position.set(0, -0.35, 0);
      mL.position.set(-0.45, 0.15, 0);
      mR.position.set(0.45, 0.15, 0);
      const group = new THREE.Group();
      [mBar, mL, mR].forEach((m) => group.add(withEdges(m)));
      return group;
    }
    case "stepBlock": {
      // 계단형 블록: 두 박스 겹침
      const g1 = new THREE.BoxGeometry(1.0, 0.5, 0.8);
      const g2 = new THREE.BoxGeometry(0.5, 1.0, 0.8);
      const m1 = new THREE.Mesh(g1, mat);
      const m2 = new THREE.Mesh(g2, mat);
      m1.position.set(0.25, -0.25, 0);
      m2.position.set(-0.25, 0.0, 0);
      const group = new THREE.Group();
      group.add(withEdges(m1));
      group.add(withEdges(m2));
      return group;
    }
    case "rectPocket": {
      // 사각 포켓(상부 개방) 블록 – 윗면만 뚫림
      const ox = 1.8, oy = 1.0, oz = 1.0;   // 전체
      const px = 1.0, py = 0.5, pz = 0.6;   // 포켓
      const tx = (ox - px) / 2;             // 좌우 벽 두께
      const tz = (oz - pz) / 2;             // 앞뒤 벽 두께
      const hb = oy - py;                   // 바닥 두께

      const group = new THREE.Group();

      const bottom = new THREE.Mesh(new THREE.BoxGeometry(ox, hb, oz), mat);
      bottom.position.set(0, -oy / 2 + hb / 2, 0);
      group.add(withEdges(bottom));

      const wallY = py;
      const cy = -oy / 2 + hb + wallY / 2;
      const left = new THREE.Mesh(new THREE.BoxGeometry(tx, wallY, oz), mat);
      left.position.set(-(px / 2 + tx / 2), cy, 0);
      const right = new THREE.Mesh(new THREE.BoxGeometry(tx, wallY, oz), mat);
      right.position.set(px / 2 + tx / 2, cy, 0);
      const front = new THREE.Mesh(new THREE.BoxGeometry(px, wallY, tz), mat);
      front.position.set(0, cy, pz / 2 + tz / 2);
      const back = new THREE.Mesh(new THREE.BoxGeometry(px, wallY, tz), mat);
      back.position.set(0, cy, -(pz / 2 + tz / 2));
      [left, right, front, back].forEach((m) => group.add(withEdges(m)));

      return group;
    }
    case "rectPocketFrontOpen": {
      // 사각 포켓(상부 + 전면 개방) – 앞벽 없음(바닥·좌·우·뒤만)
      const ox = 1.8, oy = 1.0, oz = 1.0;
      const px = 1.0, py = 0.5, pz = 0.6;
      const tx = (ox - px) / 2;
      const tz = (oz - pz) / 2;
      const hb = oy - py;

      const group = new THREE.Group();
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(ox, hb, oz), mat);
      bottom.position.set(0, -oy / 2 + hb / 2, 0);
      group.add(withEdges(bottom));

      const wallY = py;
      const cy = -oy / 2 + hb + wallY / 2;
      const left = new THREE.Mesh(new THREE.BoxGeometry(tx, wallY, oz), mat);
      left.position.set(-(px / 2 + tx / 2), cy, 0);
      const right = new THREE.Mesh(new THREE.BoxGeometry(tx, wallY, oz), mat);
      right.position.set(px / 2 + tx / 2, cy, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(px, wallY, tz), mat);
      back.position.set(0, cy, -(pz / 2 + tz / 2));
      [left, right, back].forEach((m) => group.add(withEdges(m)));

      return group;
    }
    case "diagRidgeBlock": {
      const geo = buildDiagonalRidgeBlock(1.8, 1.0, 1.0, 0.45);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    case "cornerChamfer": {
      const geo = buildCornerChamferBlock(1.8, 1.0, 1.0, 0.7, 0.6, 0.5);
      const mesh = new THREE.Mesh(geo, mat);
      return withEdges(mesh);
    }
    default:
      return new THREE.Group();
  }
}

const SHAPES = [
  { key: "cube", label: "정육면체" },
  { key: "box", label: "직육면체" },
  { key: "cylinder", label: "원기둥" },
  { key: "cone", label: "원뿔" },
  { key: "sphere", label: "구" },
  { key: "torus", label: "도넛" },
  { key: "triangularPrism", label: "삼각기둥" },
  { key: "uBlock", label: "ㅜ자 블록(조합)" },
  { key: "stepBlock", label: "계단 블록(조합)" },
  { key: "rectPocket", label: "사각 포켓 블록(상부 개방)" },
  { key: "rectPocketFrontOpen", label: "사각 포켓 블록(상부+전면 개방)" },
  { key: "diagRidgeBlock", label: "대각 능선 블록(상부 대각 접힘)" },
  { key: "cornerChamfer", label: "코너 삼각 절삭 블록" },
];

export default function SolidModelLab() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<any>(null);
  const objectRef = useRef<THREE.Object3D | null>(null);

  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);

  const [shapeKey, setShapeKey] = useState("cube");
  const [scale, setScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showEdges, setShowEdges] = useState(false); // 기본 꺼짐: 면에 불필요한 선 제거
  const [shadows, setShadows] = useState(true);
  const [testText, setTestText] = useState("");

  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f7fb);
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = shadows;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(3.5, 2.2, 4.2);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 0.8);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 7, 4);
    dir.castShadow = shadows;
    dir.shadow.mapSize.set(1024, 1024);
    scene.add(dir);
    dirLightRef.current = dir;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.ShadowMaterial({ opacity: 0.15 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;
    ground.receiveShadow = shadows;
    scene.add(ground);
    groundRef.current = ground as any;

    const grid = new THREE.GridHelper(20, 20, 0x000000, 0x000000);
    (grid.material as any).opacity = 0.08;
    (grid.material as any).transparent = true;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(1.4);
    scene.add(axes);
    axesRef.current = axes;

    const initial = createShape(shapeKey);
    initial.traverse((obj: any) => {
      if (obj.isMesh) obj.castShadow = shadows;
      if (obj.name === "__edges__") obj.visible = showEdges;
    });
    scene.add(initial);
    objectRef.current = initial;

    const onResize = () => {
      if (!mount || !rendererRef.current || !cameraRef.current) return;
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      rendererRef.current!.setSize(w, h);
      cameraRef.current!.aspect = w / h;
      cameraRef.current!.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  // 도형 변경
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (objectRef.current) {
      scene.remove(objectRef.current);
      try {
        objectRef.current.traverse((c: any) => {
          if (c.isMesh) {
            c.geometry?.dispose?.();
            c.material?.dispose?.();
          }
        });
      } catch {}
      objectRef.current = null;
    }
    const next = createShape(shapeKey);
    next.scale.setScalar(scale);
    next.traverse((obj: any) => {
      if (obj.isMesh) obj.castShadow = shadows;
      if (obj.name === "__edges__") obj.visible = showEdges;
    });
    scene.add(next);
    objectRef.current = next;
  }, [shapeKey]);

  // 스케일 변경
  useEffect(() => {
    if (objectRef.current) objectRef.current.scale.setScalar(scale);
  }, [scale]);

  // 토글들
  useEffect(() => { if (gridRef.current) (gridRef.current as any).visible = showGrid; }, [showGrid]);
  useEffect(() => { if (axesRef.current) (axesRef.current as any).visible = showAxes; }, [showAxes]);
  useEffect(() => {
    if (!objectRef.current) return;
    objectRef.current.traverse((obj: any) => { if (obj.name === "__edges__") obj.visible = showEdges; });
  }, [showEdges]);
  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.shadowMap.enabled = shadows;
    if (dirLightRef.current) dirLightRef.current.castShadow = shadows;
    if (groundRef.current) (groundRef.current as any).receiveShadow = shadows;
    if (objectRef.current) objectRef.current.traverse((obj: any) => { if (obj.isMesh) obj.castShadow = shadows; });
  }, [shadows]);

  const resetView = () => {
    const cam = cameraRef.current!;
    const controls = controlsRef.current!;
    if (!cam || !controls) return;
    cam.position.set(3.5, 2.2, 4.2);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  // -------------------- 셀프 테스트 --------------------
  const runSelfTests = () => {
    const results: { shape: string; pass: boolean; msg: string }[] = [];
    const box3 = new THREE.Box3();
    const vec = new THREE.Vector3();

    for (const s of SHAPES) {
      try {
        const obj = createShape(s.key);
        // 1) 바운딩 박스 검증
        box3.setFromObject(obj);
        const size = box3.getSize(vec);
        let pass = size.x > 0 && size.y > 0 && size.z > 0;
        let msg = pass ? "bbox ok" : `invalid bbox ${size.x.toFixed(3)},${size.y.toFixed(3)},${size.z.toFixed(3)}`;

        // 2) 메쉬 수 검증 (Edges 제외)
        let meshCount = 0; let edgeCount = 0;
        obj.traverse((o: any) => {
          if (o.isMesh) meshCount += 1;
          if (o.name === "__edges__") edgeCount += 1;
        });
        if (s.key === "uBlock" && meshCount !== 3) { pass = false; msg = `uBlock expects 3 meshes, got ${meshCount}`; }
        if (s.key === "stepBlock" && meshCount !== 2) { pass = false; msg = `stepBlock expects 2 meshes, got ${meshCount}`; }
        if (s.key === "rectPocket" && meshCount !== 5) { pass = false; msg = `rectPocket expects 5 meshes, got ${meshCount}`; }
        if (s.key === "rectPocketFrontOpen" && meshCount !== 4) { pass = false; msg = `rectPocketFrontOpen expects 4 meshes, got ${meshCount}`; }
        if (s.key === "diagRidgeBlock" && meshCount !== 1) { pass = false; msg = `diagRidgeBlock expects 1 mesh, got ${meshCount}`; }
        if (s.key === "cornerChamfer" && meshCount !== 1) { pass = false; msg = `cornerChamfer expects 1 mesh, got ${meshCount}`; }

        // 3) 토러스는 edge helper가 0이어야 함
        if (s.key === "torus" && edgeCount !== 0) { pass = false; msg = `torus should have 0 edge helpers, got ${edgeCount}`; }

        results.push({ shape: s.key, pass, msg });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({ shape: s.key, pass: false, msg: err });
      }
    }

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    const lines = [
      `Self-tests: ${passed}/${total} passed`,
      ...results.map((r) => `- ${r.shape}: ${r.pass ? "PASS" : "FAIL"}${r.pass ? "" : " — " + r.msg}`),
    ];
    setTestText(lines.join("\n"));
  };

  return (
    <div className="relative w-full h-screen min-h-[640px]">
      <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur rounded-2xl shadow p-4 flex flex-col gap-3 min-w-[320px]">
        <div>
          <h1 className="text-xl font-semibold">3D 투상도 시뮬레이터</h1>
          <p className="text-sm text-gray-600">도형을 선택하고 마우스로 돌려보세요.</p>
        </div>

        <label className="text-sm">도형</label>
        <select className="border rounded-xl p-2 text-sm" value={shapeKey} onChange={(e) => setShapeKey(e.target.value)}>
          {SHAPES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        <label className="text-sm">전체 스케일: {scale.toFixed(2)}</label>
        <input type="range" min={0.5} max={2} step={0.01} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} />

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> 그리드
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} /> 좌표축
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} /> 윤곽선
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} /> 그림자
          </label>
          <button onClick={resetView} className="ml-auto px-3 py-1.5 rounded-xl bg-black text-white text-sm shadow">뷰 리셋</button>
        </div>

        <div className="flex gap-2">
          <button onClick={runSelfTests} className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-sm shadow">셀프 테스트</button>
          <span className="text-xs text-gray-600 self-center">(바운딩 박스·메쉬 수·토러스 엣지 검증)</span>
        </div>

        {testText && (
          <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded-xl p-2 max-h-40 overflow-auto">{testText}</pre>
        )}
      </div>

      {/* 렌더 타겟 */}
      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}
