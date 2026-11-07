import {
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { CampusSpatialModel, CampusSpatialPoint } from './campusSpatialModel';

export type CampusSpatialView = {
  selectedId: string | null;
  overhead: boolean;
  motion: boolean;
  dark: boolean;
};

export type CampusSpatialScene = {
  setView: (view: CampusSpatialView) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

type Options = { onSelect: (id: string) => void; onError: () => void };
type Pose = { position: Vector3; target: Vector3 };
type Transition = { from: Pose; to: Pose; start: number };
type Label = { point: CampusSpatialPoint; button: HTMLButtonElement };
type Rectangle = { left: number; top: number; width: number; height: number };

const TRANSITION_MS = 420;
const MAX_BUFFER_PIXELS = 1_200_000;
const FIELD_OF_VIEW = 38;
const palettes = {
  light: {
    background: '#eeebe4', ground: '#f9f7f0', grid: '#b5afa1', pin: '#65736d',
    stem: '#b0ada3', accent: '#ad4f2c', label: '#fffdf7', text: '#303a34',
    border: '#bdb9af', selectedLabel: '#fff4e7', selectedText: '#763212',
  },
  dark: {
    background: '#191d1e', ground: '#272d2e', grid: '#627071', pin: '#bdc8c3',
    stem: '#78847e', accent: '#e7a17b', label: '#252c2d', text: '#f0f2ec',
    border: '#65716d', selectedLabel: '#3c3027', selectedText: '#ffceac',
  },
};

function overlaps(first: Rectangle, second: Rectangle) {
  const gap = 8;
  return first.left < second.left + second.width + gap &&
    first.left + first.width + gap > second.left &&
    first.top < second.top + second.height + gap &&
    first.top + first.height + gap > second.top;
}

/** This owns a single, optional canvas. No render loop runs while the view is still. */
export function createCampusSpatialScene(
  container: HTMLElement,
  model: CampusSpatialModel,
  options: Options,
): CampusSpatialScene {
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.spatialCanvas = 'true';
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    pointerEvents: 'none',
  });
  const labelLayer = document.createElement('div');
  Object.assign(labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  root.append(canvas, labelLayer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, Math.max(10_000, model.radius * 20));
  const lookAt = new Vector3();
  const pointsById = new Map(model.points.map((point) => [point.id, point]));
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const instances: InstancedMesh[] = [];
  const labels: Label[] = [];
  const listeners: Array<() => void> = [];
  let renderer: WebGLRenderer | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;
  let failed = false;
  let active = true;
  let frame: number | null = null;
  let transition: Transition | null = null;
  let width = 0;
  let height = 0;
  let view: CampusSpatialView = { selectedId: null, overhead: false, motion: false, dark: false };
  let caps: InstancedMesh | null = null;
  let ring: Mesh | null = null;
  let groundMaterial: MeshStandardMaterial | null = null;
  let stemMaterial: MeshStandardMaterial | null = null;
  let gridMaterial: LineBasicMaterial | null = null;
  let ringMaterial: MeshStandardMaterial | null = null;
  let northLabel: HTMLSpanElement | null = null;
  const pinRadius = Math.max(3, Math.min(9, model.radius * 0.018));
  const pinHeight = pinRadius * 3.3;
  const groundWidth = Math.max(180, model.extent.width + pinRadius * 12);
  const groundDepth = Math.max(160, model.extent.depth + pinRadius * 12);
  const northPosition = new Vector3(-groundWidth / 2 + pinRadius * 3, 1, -groundDepth / 2 + pinRadius * 3);

  function ownGeometry<T extends BufferGeometry>(geometry: T): T {
    geometries.push(geometry);
    return geometry;
  }
  function ownMaterial<T extends Material>(material: T): T {
    materials.push(material);
    return material;
  }
  function cancelFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    transition = null;
    resizeObserver?.disconnect();
    for (const remove of listeners) remove();
    for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.clear();
    renderer?.dispose();
    renderer?.forceContextLoss();
    root.remove();
  }
  function fail() {
    if (failed || disposed) return;
    failed = true;
    dispose();
    options.onError();
  }
  function requestFrame() {
    if (!disposed && active && frame === null) frame = requestAnimationFrame(draw);
  }
  function poseForView(): Pose {
    const point = view.selectedId ? pointsById.get(view.selectedId) : undefined;
    const target = new Vector3(point?.x ?? 0, 0, point?.z ?? 0);
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const focusSpan = Math.max(180, Math.min(450, model.radius * 0.85));
    const direction = view.overhead
      ? new Vector3(0, 1, 0.001).normalize()
      : new Vector3(0.5, 0.94, 1).normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
    const up = new Vector3().crossVectors(direction, right);
    const halfWidth = (point ? focusSpan : groundWidth) / 2;
    const halfDepth = (point ? focusSpan : groundDepth) / 2;
    const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360) * 0.82;
    let distance = 80;
    // An oblique camera needs room for both the rotated footprint and its near edge.
    // Fit the whole volume, including marker tops, rather than only its 2D width.
    for (const x of [-halfWidth, halfWidth]) {
      for (const z of [-halfDepth, halfDepth]) {
        for (const y of [0, pinHeight + pinRadius]) {
          const corner = new Vector3(x, y, z);
          const nearOffset = corner.dot(direction);
          distance = Math.max(distance,
            nearOffset + Math.abs(corner.dot(right)) / (tangent * aspect),
            nearOffset + Math.abs(corner.dot(up)) / tangent);
        }
      }
    }
    return { target, position: direction.multiplyScalar(distance).add(target) };
  }
  function applyPose(pose: Pose) {
    camera.position.copy(pose.position);
    lookAt.copy(pose.target);
    camera.lookAt(lookAt);
  }
  function finishTransition() {
    if (transition) applyPose(transition.to);
    transition = null;
  }
  function moveCamera(animate: boolean) {
    const to = poseForView();
    if (animate && active) {
      transition = {
        from: { position: camera.position.clone(), target: lookAt.clone() },
        to,
        start: performance.now(),
      };
    } else {
      transition = null;
      applyPose(to);
    }
  }
  function resize() {
    if (disposed || !renderer) return;
    const bounds = container.getBoundingClientRect();
    const nextWidth = Math.floor(bounds.width);
    const nextHeight = Math.floor(bounds.height);
    if (nextWidth <= 0 || nextHeight <= 0) return;
    const changed = width !== nextWidth || height !== nextHeight;
    width = nextWidth;
    height = nextHeight;
    const ratio = Math.min(1.5, window.devicePixelRatio || 1,
      Math.sqrt(MAX_BUFFER_PIXELS / (width * height)));
    const bufferWidth = Math.max(1, Math.floor(width * ratio));
    const bufferHeight = Math.max(1, Math.floor(height * ratio));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      renderer.setSize(bufferWidth, bufferHeight, false);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (changed) moveCamera(false);
    requestFrame();
  }
  function updateAppearance() {
    const palette = view.dark ? palettes.dark : palettes.light;
    scene.background = new Color(palette.background);
    groundMaterial?.color.set(palette.ground);
    stemMaterial?.color.set(palette.stem);
    gridMaterial?.color.set(palette.grid);
    ringMaterial?.color.set(palette.accent);
    const neutral = new Color(palette.pin);
    const accent = new Color(palette.accent);
    for (let index = 0; index < model.points.length; index += 1) {
      caps?.setColorAt(index, model.points[index].id === view.selectedId ? accent : neutral);
    }
    if (caps?.instanceColor) caps.instanceColor.needsUpdate = true;
    const selected = view.selectedId ? pointsById.get(view.selectedId) : undefined;
    if (ring) {
      ring.visible = Boolean(selected);
      if (selected) ring.position.set(selected.x, 0.4, selected.z);
    }
    for (const { point, button } of labels) {
      const chosen = point.id === view.selectedId;
      button.setAttribute('aria-pressed', String(chosen));
      button.style.backgroundColor = chosen ? palette.selectedLabel : palette.label;
      button.style.color = chosen ? palette.selectedText : palette.text;
      button.style.borderColor = chosen ? palette.accent : palette.border;
      button.style.fontWeight = chosen ? '650' : '500';
    }
    if (northLabel) northLabel.style.color = palette.text;
  }
  function projectLabels() {
    const selected = view.selectedId ? pointsById.get(view.selectedId) : undefined;
    const focusedButton = labels.find(({ button }) => button === container.ownerDocument.activeElement)?.button;
    const projected = labels.map((label) => ({
      ...label,
      screen: new Vector3(label.point.x, pinHeight + pinRadius, label.point.z).project(camera),
    }));
    projected.sort((a, b) => {
      if (a.button === focusedButton) return -1;
      if (b.button === focusedButton) return 1;
      if (a.point.id === view.selectedId) return -1;
      if (b.point.id === view.selectedId) return 1;
      return Math.hypot(a.point.x - (selected?.x ?? 0), a.point.z - (selected?.z ?? 0)) -
        Math.hypot(b.point.x - (selected?.x ?? 0), b.point.z - (selected?.z ?? 0));
    });
    const candidates = projected.filter(({ button, screen }) => {
      const edge = button === focusedButton ? 1 : 0.95;
      return screen.z >= -1 && screen.z <= 1 && Math.abs(screen.x) <= edge && Math.abs(screen.y) <= edge;
    }).slice(0, 24);
    const candidateButtons = new Set(candidates.map(({ button }) => button));
    // Keep keyboard focus on a visible label. When its real point leaves the camera,
    // return to the focusable scene before hiding it rather than pinning a false label.
    if (focusedButton && !candidateButtons.has(focusedButton)) {
      container.focus({ preventScroll: true });
    }
    for (const { button } of labels) {
      if (!candidateButtons.has(button)) {
        button.hidden = true;
        button.style.display = 'none';
      }
    }
    for (const { button } of candidates) {
      button.hidden = false;
      button.style.display = 'block';
      button.style.maxWidth = `${Math.max(1, Math.min(180, width - 16))}px`;
    }
    // Batch layout reads; tightly clustered places must not cause a layout per label per frame.
    const measured = candidates.map((candidate) => ({
      ...candidate,
      labelWidth: candidate.button.offsetWidth || Math.min(180, width - 16),
      labelHeight: candidate.button.offsetHeight || 44,
    }));
    const occupied: Rectangle[] = [];
    const maximum = width < 500 ? 4 : 7;
    for (const { button, screen, labelWidth, labelHeight } of measured) {
      const left = Math.max(8, Math.min(width - labelWidth - 8,
        (screen.x + 1) * width / 2 - labelWidth / 2));
      const top = Math.max(8, Math.min(height - labelHeight - 8,
        (1 - screen.y) * height / 2 - labelHeight - 7));
      const rectangle = { left, top, width: labelWidth, height: labelHeight };
      if (occupied.length >= maximum || occupied.some((other) => overlaps(rectangle, other))) {
        button.hidden = true;
        button.style.display = 'none';
        continue;
      }
      occupied.push(rectangle);
      button.style.transform = `translate(${left}px, ${top}px)`;
    }
    if (northLabel) {
      const screen = northPosition.clone().project(camera);
      northLabel.hidden = screen.z < -1 || screen.z > 1 ||
        Math.abs(screen.x) > 0.9 || Math.abs(screen.y) > 0.9;
      northLabel.style.transform = `translate(${(screen.x + 1) * width / 2}px, ${(1 - screen.y) * height / 2}px)`;
    }
  }
  function draw(time: number) {
    frame = null;
    if (disposed || !active || !renderer || !width || !height) return;
    try {
      if (transition) {
        const progress = Math.max(0, Math.min(1, (time - transition.start) / TRANSITION_MS));
        const eased = 1 - (1 - progress) ** 3;
        camera.position.lerpVectors(transition.from.position, transition.to.position, eased);
        lookAt.lerpVectors(transition.from.target, transition.to.target, eased);
        camera.lookAt(lookAt);
        if (progress === 1) transition = null;
      }
      renderer.render(scene, camera);
      // render() updates the real camera matrices before projecting the HTML labels.
      projectLabels();
      if (transition) requestFrame();
    } catch {
      fail();
    }
  }
  function setView(next: CampusSpatialView) {
    if (disposed) return;
    const normalized = {
      ...next,
      selectedId: next.selectedId && pointsById.has(next.selectedId) ? next.selectedId : null,
    };
    const cameraChanged = view.selectedId !== normalized.selectedId || view.overhead !== normalized.overhead;
    const appearanceChanged = view.dark !== normalized.dark || view.selectedId !== normalized.selectedId;
    const motionChanged = view.motion !== normalized.motion;
    if (!cameraChanged && !appearanceChanged && !motionChanged) return;
    view = normalized;
    if (!view.motion) finishTransition();
    if (cameraChanged) moveCamera(view.motion);
    if (appearanceChanged) updateAppearance();
    requestFrame();
  }
  function setActive(next: boolean) {
    if (disposed || active === next) return;
    active = next;
    if (!active) {
      cancelFrame();
      finishTransition();
    } else {
      resize();
    }
  }

  try {
    if (!model.points.length || model.unavailableReason) {
      fail();
      return { setView, setActive, dispose };
    }
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    const onContextLost = (event: Event) => { event.preventDefault(); fail(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    listeners.push(() => canvas.removeEventListener('webglcontextlost', onContextLost));

    scene.add(new HemisphereLight('#ffffff', '#777e78', 2.1));
    const light = new DirectionalLight('#ffffff', 2.4);
    light.position.set(-200, 600, 300);
    scene.add(light);

    groundMaterial = ownMaterial(new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    const ground = new Mesh(ownGeometry(new PlaneGeometry(groundWidth, groundDepth)), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    scene.add(ground);

    const gridPoints: Vector3[] = [];
    const step = 10 ** Math.floor(Math.log10(Math.max(groundWidth, groundDepth) / 6));
    for (let x = Math.ceil(-groundWidth / 2 / step) * step; x <= groundWidth / 2; x += step) {
      gridPoints.push(new Vector3(x, 0, -groundDepth / 2), new Vector3(x, 0, groundDepth / 2));
    }
    for (let z = Math.ceil(-groundDepth / 2 / step) * step; z <= groundDepth / 2; z += step) {
      gridPoints.push(new Vector3(-groundWidth / 2, 0, z), new Vector3(groundWidth / 2, 0, z));
    }
    gridMaterial = ownMaterial(new LineBasicMaterial({ transparent: true, opacity: 0.38 }));
    scene.add(new LineSegments(ownGeometry(new BufferGeometry().setFromPoints(gridPoints)), gridMaterial));

    stemMaterial = ownMaterial(new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    const stems = new InstancedMesh(
      ownGeometry(new CylinderGeometry(pinRadius * 0.15, pinRadius * 0.15, pinHeight, 6)),
      stemMaterial,
      model.points.length,
    );
    const feet = new InstancedMesh(
      ownGeometry(new CircleGeometry(pinRadius * 1.8, 24)),
      ownMaterial(new MeshStandardMaterial({ color: '#888888', transparent: true, opacity: 0.2 })),
      model.points.length,
    );
    caps = new InstancedMesh(
      ownGeometry(new SphereGeometry(pinRadius, 12, 8)),
      ownMaterial(new MeshStandardMaterial({ roughness: 0.65, metalness: 0 })),
      model.points.length,
    );
    instances.push(stems, feet, caps);
    const matrix = new Matrix4();
    const flat = new Matrix4().makeRotationX(-Math.PI / 2);
    model.points.forEach((point, index) => {
      stems.setMatrixAt(index, matrix.makeTranslation(point.x, pinHeight / 2, point.z));
      feet.setMatrixAt(index, matrix.makeTranslation(point.x, 0.1, point.z).multiply(flat));
      caps!.setMatrixAt(index, matrix.makeTranslation(point.x, pinHeight, point.z));
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = point.name;
      button.title = point.name;
      button.setAttribute('aria-label', `聚焦${point.name}`);
      button.dataset.spatialMarker = point.id;
      Object.assign(button.style, {
        position: 'absolute', left: '0', top: '0', minHeight: '44px', boxSizing: 'border-box',
        padding: '8px 12px', border: '1px solid', borderRadius: '7px', font: 'inherit',
        fontSize: '0.8125rem', lineHeight: '1.4', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        overflow: 'hidden', pointerEvents: 'auto', cursor: 'pointer', outlineOffset: '3px',
        boxShadow: '0 2px 8px rgb(0 0 0 / 9%)',
      });
      button.hidden = true;
      button.style.display = 'none';
      const select = () => { if (!disposed && active) options.onSelect(point.id); };
      button.addEventListener('click', select);
      listeners.push(() => button.removeEventListener('click', select));
      labelLayer.append(button);
      labels.push({ point, button });
    });
    scene.add(stems, feet, caps);
    ringMaterial = ownMaterial(new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    ring = new Mesh(ownGeometry(new RingGeometry(pinRadius * 2, pinRadius * 2.45, 32)), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    northLabel = document.createElement('span');
    northLabel.textContent = '北 N';
    northLabel.setAttribute('aria-hidden', 'true');
    Object.assign(northLabel.style, {
      position: 'absolute', left: '0', top: '0', font: '600 0.75rem system-ui, sans-serif',
      whiteSpace: 'nowrap',
    });
    labelLayer.append(northLabel);
    container.append(root);
    updateAppearance();
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', resize);
    listeners.push(() => window.removeEventListener('resize', resize));
  } catch {
    fail();
  }

  return { setView, setActive, dispose };
}
