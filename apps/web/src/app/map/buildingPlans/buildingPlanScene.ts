import {
  BoxGeometry, BufferGeometry, Color, DirectionalLight, EdgesGeometry, ExtrudeGeometry,
  Group, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Shape, ShapeGeometry, ShapeUtils, Vector2, Vector3,
  WebGLRenderer, type Material,
} from 'three';
import { normalizeSpatialCamera, spatialCameraDirection } from '../campusSpatialCamera';
import type { BuildingPlan, PlanPoint } from './buildingPlan';

export type BuildingPlanView = {
  floorId: string | null;
  roomId: string | null;
  exploded: boolean;
  overhead: boolean;
  bearing: number;
  zoom: number;
  dark: boolean;
};
export type BuildingPlanScene = {
  setView(view: BuildingPlanView): void;
  setActive(active: boolean): void;
  dispose(): void;
};

const COLORS = {
  light: {
    background: '#eeebe4', slab: '#f8f5ec', wall: '#d6d4c8', edge: '#aaa99c',
    room: '#91aaa0', alternate: '#afbeb0', selected: '#c67d50',
    label: '#fffdf7', text: '#303a34', border: '#b8bcb0', selectedLabel: '#fff0e2',
  },
  dark: {
    background: '#191f1e', slab: '#39433d', wall: '#6c786c', edge: '#85918a',
    room: '#587c6e', alternate: '#708676', selected: '#d59a70',
    label: '#27342e', text: '#f0f2ec', border: '#76867a', selectedLabel: '#63432f',
  },
};

// A triangle centroid stays within a concave polygon, unlike its bounding-box centre.
function labelAnchor(points: PlanPoint[]): PlanPoint {
  const vertices = points.map(([x, z]) => new Vector2(x, z));
  let largest = -1;
  let anchor = points[0];
  for (const [ia, ib, ic] of ShapeUtils.triangulateShape(vertices, [])) {
    const a = points[ia], b = points[ib], c = points[ic];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area > largest) {
      largest = area;
      anchor = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    }
  }
  return anchor;
}

export function createBuildingPlanScene(
  host: HTMLElement,
  plan: BuildingPlan,
  options: { onSelect: (roomId: string) => void; onError: () => void },
): BuildingPlanScene {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
  const canvas = doc.createElement('canvas');
  canvas.dataset.buildingPlanCanvas = 'true';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
  const labelLayer = doc.createElement('div');
  Object.assign(labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.append(canvas, labelLayer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 10000);
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const listeners: (() => void)[] = [];
  const floors: { id: string; group: Group; elevation: number; wallHeight: number; index: number }[] = [];
  const rooms: {
    id: string; floorId: string; button: HTMLButtonElement; anchor: Vector3;
    group: Group; material: MeshStandardMaterial; alternate: boolean;
  }[] = [];
  let renderer: WebGLRenderer | null = null;
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;
  let width = 0, height = 0;
  let disposed = false, failed = false, active = true;
  let view: BuildingPlanView = {
    floorId: null, roomId: null, exploded: false, overhead: false,
    ...normalizeSpatialCamera(), dark: false,
  };
  const allPoints = plan.floors.flatMap(floor => floor.outline);
  const minX = Math.min(...allPoints.map(point => point[0])) - 0.5;
  const maxX = Math.max(...allPoints.map(point => point[0])) + 0.5;
  const minZ = Math.min(...allPoints.map(point => point[1])) - 0.5;
  const maxZ = Math.max(...allPoints.map(point => point[1])) + 0.5;
  const centreX = (minX + maxX) / 2, centreZ = (minZ + maxZ) / 2;
  const separation = Math.max(3, Math.max(maxX - minX, maxZ - minZ) * 0.32);
  const slabDepth = 0.18;
  const slabMaterial = new MeshStandardMaterial({ roughness: 1 });
  const wallMaterial = new MeshStandardMaterial({ roughness: 1 });
  const edgeMaterial = new LineBasicMaterial();
  materials.push(slabMaterial, wallMaterial, edgeMaterial);

  function keep<T extends BufferGeometry>(geometry: T): T {
    geometries.push(geometry);
    return geometry;
  }
  function shape(points: PlanPoint[]) {
    const result = new Shape(points.map(([x, z]) => new Vector2(x - centreX, -(z - centreZ))));
    result.closePath();
    return result;
  }
  function cancelFrame() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    observer?.disconnect();
    for (const remove of listeners) remove();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.clear();
    renderer?.dispose();
    renderer?.forceContextLoss();
    if (host.isConnected && root.contains(doc.activeElement)) host.focus({ preventScroll: true });
    root.remove();
  }
  function fail() {
    if (failed || disposed) return;
    failed = true;
    dispose();
    options.onError();
  }
  function draw() {
    frame = null;
    if (disposed || !active || !renderer || !width || !height) return;
    try {
      const visible = floors.filter(floor => floor.group.visible);
      if (!visible.length) return;
      const low = Math.min(...visible.map(floor => floor.group.position.y - slabDepth));
      const high = Math.max(...visible.map(floor => floor.group.position.y + floor.wallHeight));
      const target = new Vector3(0, (low + high) / 2, 0);
      const offset = spatialCameraDirection(view.bearing, view.overhead);
      const direction = new Vector3(offset.x, offset.y, offset.z);
      const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
      const up = new Vector3().crossVectors(direction, right);
      const tangent = Math.tan(38 * Math.PI / 360) * 0.78;
      let distance = 1;
      // Fit every corner of the full visible stack, including exploded vertical spacing.
      for (const x of [minX - centreX, maxX - centreX])
        for (const z of [minZ - centreZ, maxZ - centreZ])
          for (const y of [low, high]) {
            const point = new Vector3(x, y, z).sub(target);
            const near = point.dot(direction);
            distance = Math.max(distance, near + Math.abs(point.dot(right)) / (tangent * camera.aspect),
              near + Math.abs(point.dot(up)) / tangent);
          }
      camera.position.copy(direction).multiplyScalar(distance / view.zoom).add(target);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);

      const topFloor = visible.reduce((top, floor) => floor.group.position.y > top.group.position.y ? floor : top);
      const occupied: { x: number; y: number; w: number; h: number }[] = [];
      const ordered = [...rooms].sort((a, b) => Number(b.id === view.roomId) - Number(a.id === view.roomId));
      for (const room of ordered) {
        const point = room.anchor.clone();
        room.group.localToWorld(point);
        point.project(camera);
        const selected = room.id === view.roomId;
        // In a closed stack only the uppermost slab is exposed; the room list remains available.
        const exposed = view.exploded || view.floorId !== null || room.floorId === topFloor.id;
        const x = (point.x * 0.5 + 0.5) * width;
        const y = (-point.y * 0.5 + 0.5) * height;
        room.button.hidden = !room.group.visible || !exposed || point.z < -1 || point.z > 1 ||
          x < 0 || x > width || y < 0 || y > height;
        if (room.button.hidden) continue;
        const w = Math.min(190, width - 16, room.button.offsetWidth || 150);
        const h = room.button.offsetHeight || 44;
        const box = { x: Math.max(8, Math.min(width - w - 8, x - w / 2)),
          y: Math.max(8, Math.min(height - h - 8, y - h / 2)), w, h };
        const overlaps = occupied.some(other => box.x < other.x + other.w + 6 &&
          box.x + w + 6 > other.x && box.y < other.y + other.h + 6 && box.y + h + 6 > other.y);
        if (overlaps && !selected && doc.activeElement !== room.button) {
          room.button.hidden = true;
          continue;
        }
        occupied.push(box);
        Object.assign(room.button.style, { left: `${box.x}px`, top: `${box.y}px`,
          maxWidth: `${Math.max(1, Math.min(190, width - 16))}px`, zIndex: selected ? '2' : '1' });
      }
    } catch { fail(); }
  }
  function requestDraw() {
    if (!disposed && active && frame === null) frame = window.requestAnimationFrame(draw);
  }
  function updateView() {
    const colors = COLORS[view.dark ? 'dark' : 'light'];
    scene.background = new Color(colors.background);
    slabMaterial.color.set(colors.slab);
    wallMaterial.color.set(colors.wall);
    edgeMaterial.color.set(colors.edge);
    for (const floor of floors) {
      floor.group.visible = view.floorId === null || view.floorId === floor.id;
      floor.group.position.y = floor.elevation + (view.exploded ? floor.index * separation : 0);
    }
    for (const room of rooms) {
      const selected = room.id === view.roomId;
      room.material.color.set(selected ? colors.selected : room.alternate ? colors.alternate : colors.room);
      room.button.setAttribute('aria-pressed', String(selected));
      Object.assign(room.button.style, { background: selected ? colors.selectedLabel : colors.label,
        color: colors.text, borderColor: selected ? colors.selected : colors.border });
    }
    requestDraw();
  }
  function resize() {
    if (disposed || !active || !renderer) return;
    const bounds = host.getBoundingClientRect();
    width = Math.floor(bounds.width); height = Math.floor(bounds.height);
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(1_200_000 / (width * height)));
    renderer.setSize(Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio)), false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestDraw();
  }

  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    const onContextLost = (event: Event) => { event.preventDefault(); fail(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    listeners.push(() => canvas.removeEventListener('webglcontextlost', onContextLost));
    scene.add(new HemisphereLight('#fffdf4', '#8b958b', 2.5));
    const sunlight = new DirectionalLight('#ffffff', 2.6);
    sunlight.position.set(-40, 80, 50);
    scene.add(sunlight);
    for (const [index, floor] of plan.floors.entries()) {
      const group = new Group();
      // Cutaway walls expose the drawing; their displayed height is deliberately capped.
      const wallHeight = Math.min(1.2, floor.height * 0.45);
      floors.push({ id: floor.id, group, elevation: floor.elevation, wallHeight, index });
      scene.add(group);
      const geometry = keep(new ExtrudeGeometry(shape(floor.outline), { depth: slabDepth, bevelEnabled: false, steps: 1 }));
      const slab = new Mesh(geometry, slabMaterial);
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = -slabDepth;
      group.add(slab);
      const outline = new LineSegments(keep(new EdgesGeometry(geometry)), edgeMaterial);
      outline.rotation.copy(slab.rotation);
      outline.position.copy(slab.position);
      group.add(outline);
      for (const wall of floor.walls) {
        const dx = wall.end[0] - wall.start[0], dz = wall.end[1] - wall.start[1];
        const mesh = new Mesh(keep(new BoxGeometry(Math.hypot(dx, dz), wallHeight, wall.thickness)), wallMaterial);
        mesh.position.set((wall.start[0] + wall.end[0]) / 2 - centreX, wallHeight / 2,
          (wall.start[1] + wall.end[1]) / 2 - centreZ);
        mesh.rotation.y = -Math.atan2(dz, dx);
        group.add(mesh);
      }
      for (const [roomIndex, room] of floor.rooms.entries()) {
        const material = new MeshStandardMaterial({ roughness: 1 });
        materials.push(material);
        const mesh = new Mesh(keep(new ShapeGeometry(shape(room.polygon))), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.025;
        group.add(mesh);
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.buildingRoomId = room.id;
        button.textContent = `${floor.label} · ${room.name}`;
        button.title = `${floor.label} · ${room.name}`;
        Object.assign(button.style, { position: 'absolute', minHeight: '44px', padding: '7px 10px',
          border: '1px solid', borderRadius: '8px', font: 'inherit', fontSize: '12px', fontWeight: '600',
          lineHeight: '1.4', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden',
          maxWidth: '190px', pointerEvents: 'auto', cursor: 'pointer', outlineOffset: '3px',
          boxShadow: '0 2px 9px rgb(0 0 0 / 12%)' });
        const onClick = () => { if (!disposed && active) options.onSelect(room.id); };
        button.addEventListener('click', onClick);
        listeners.push(() => button.removeEventListener('click', onClick));
        labelLayer.append(button);
        const [x, z] = labelAnchor(room.polygon);
        rooms.push({ id: room.id, floorId: floor.id, button, group, material, alternate: roomIndex % 2 === 1,
          anchor: new Vector3(x - centreX, wallHeight + 0.15, z - centreZ) });
      }
    }
    host.append(root);
    updateView();
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    }
    window.addEventListener('resize', resize);
    listeners.push(() => window.removeEventListener('resize', resize));
  } catch { fail(); }

  return {
    setView(next) {
      if (disposed) return;
      view = { ...next, ...normalizeSpatialCamera(next) };
      updateView();
    },
    setActive(next) {
      if (disposed || active === next) return;
      active = next;
      root.inert = !active;
      root.style.visibility = active ? 'visible' : 'hidden';
      if (active) resize(); else cancelFrame();
    },
    dispose,
  };
}
