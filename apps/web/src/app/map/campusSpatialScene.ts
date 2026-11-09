import {
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
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
  Shape,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { CampusSpatialModel, CampusSpatialPoint } from './campusSpatialModel';
import type { ProvidenceFootprint } from './providenceFootprints';
import {
  normalizeSpatialCamera,
  spatialCameraDirection,
  SPATIAL_ROTATION_STEP,
  SPATIAL_ZOOM_FACTOR,
  type CampusSpatialCamera,
} from './campusSpatialCamera';

export type CampusSpatialView = {
  selectedId: string | null;
  overhead: boolean;
  motion: boolean;
  dark: boolean;
  bearing?: number;
  zoom?: number;
};

export type CampusSpatialScene = {
  setView: (view: CampusSpatialView) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

type Options = {
  onSelect: (id: string) => void;
  onError: () => void;
  onCameraChange?: (camera: CampusSpatialCamera) => void;
  footprints?: readonly ProvidenceFootprint[];
};
type Pose = { position: Vector3; target: Vector3 };
type Transition = { from: Pose; to: Pose; start: number };
type Label = { point: CampusSpatialPoint; button: HTMLButtonElement };
type Rectangle = { left: number; top: number; width: number; height: number };
type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  bearing: number;
  zoom: number;
  claimed: boolean;
  captured: boolean;
};

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
  const buildingHeightById = new Map((options.footprints ?? [])
    .filter((footprint) => pointsById.has(footprint.poiId))
    .map((footprint) => [footprint.poiId, footprint.heightMeters]));
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const instances: InstancedMesh[] = [];
  const buildingMaterials: Array<{ id: string; material: MeshStandardMaterial }> = [];
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
  let view: CampusSpatialView & CampusSpatialCamera = {
    selectedId: null, overhead: false, motion: false, dark: false, ...normalizeSpatialCamera(),
  };
  let requestedCamera: CampusSpatialCamera = normalizeSpatialCamera(view);
  let drag: Drag | null = null;
  let suppressDragClick = false;
  let caps: InstancedMesh | null = null;
  let ring: Mesh | null = null;
  let groundMaterial: MeshStandardMaterial | null = null;
  let stemMaterial: MeshStandardMaterial | null = null;
  let gridMaterial: LineBasicMaterial | null = null;
  let ringMaterial: MeshStandardMaterial | null = null;
  const pinRadius = Math.max(3, Math.min(9, model.radius * 0.018));
  const pinHeight = pinRadius * 3.3;
  const tallestBuilding = Math.max(0, ...(options.footprints ?? []).map((item) => item.heightMeters));
  const groundWidth = Math.max(180, model.extent.width + pinRadius * 12);
  const groundDepth = Math.max(160, model.extent.depth + pinRadius * 12);

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
  function cancelDrag() {
    const current = drag;
    drag = null;
    if (current?.captured && container.hasPointerCapture?.(current.pointerId)) {
      try { container.releasePointerCapture(current.pointerId); } catch {
        // Capture may already have been released by the browser after cancellation.
      }
    }
  }
  function emitCamera(next: CampusSpatialCamera) {
    if (disposed || !active || !options.onCameraChange) return;
    const normalized = normalizeSpatialCamera(next);
    if (normalized.bearing === requestedCamera.bearing && normalized.zoom === requestedCamera.zoom) return;
    requestedCamera = normalized;
    options.onCameraChange(normalized);
  }
  function onKeyDown(event: KeyboardEvent) {
    if (disposed || !active || !options.onCameraChange || event.target !== container ||
      container.ownerDocument.activeElement !== container || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: CampusSpatialCamera;
    switch (event.key) {
      case 'ArrowLeft': next = { ...requestedCamera, bearing: requestedCamera.bearing - SPATIAL_ROTATION_STEP }; break;
      case 'ArrowRight': next = { ...requestedCamera, bearing: requestedCamera.bearing + SPATIAL_ROTATION_STEP }; break;
      case '+':
      case '=': next = { ...requestedCamera, zoom: requestedCamera.zoom * SPATIAL_ZOOM_FACTOR }; break;
      case '-':
      case '_': next = { ...requestedCamera, zoom: requestedCamera.zoom / SPATIAL_ZOOM_FACTOR }; break;
      case 'Home': next = { bearing: 0, zoom: 1 }; break;
      default: return;
    }
    event.preventDefault();
    cancelDrag();
    emitCamera(next);
  }
  function onPointerDown(event: PointerEvent) {
    suppressDragClick = false;
    if (disposed || !active || !options.onCameraChange) return;
    if (event.isPrimary === false || (drag && drag.pointerId !== event.pointerId)) {
      cancelDrag();
      return;
    }
    if (event.button !== 0 || !width) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, select, textarea, [contenteditable]')) return;
    drag = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width,
      bearing: requestedCamera.bearing, zoom: requestedCamera.zoom, claimed: false, captured: false,
    };
  }
  function onPointerMove(event: PointerEvent) {
    if (disposed || !active || !drag || drag.pointerId !== event.pointerId) return;
    if (event.type === 'pointermove' && event.pointerType === 'mouse' && event.buttons === 0) {
      cancelDrag();
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.claimed) {
      if (Math.abs(dy) >= 8 && Math.abs(dy) >= Math.abs(dx)) { cancelDrag(); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      drag.claimed = true;
      suppressDragClick = true;
      finishTransition();
      try {
        container.setPointerCapture(event.pointerId);
        drag.captured = true;
      } catch {
        // Without capture, pointerleave cancels the drag instead of tracking outside the scene.
      }
    }
    event.preventDefault();
    emitCamera({ bearing: drag.bearing + dx / drag.width * 180, zoom: drag.zoom });
  }
  function onPointerUp(event: PointerEvent) {
    if (drag?.pointerId !== event.pointerId) return;
    // The final position can differ from the most recently delivered pointermove.
    if (drag.claimed) onPointerMove(event);
    cancelDrag();
  }
  function onPointerCancel(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId) cancelDrag();
  }
  function onPointerLeave() {
    if (drag && !drag.captured) cancelDrag();
  }
  function suppressClick(event: MouseEvent) {
    if (suppressDragClick && event.detail > 0) {
      suppressDragClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    cancelDrag();
    transition = null;
    resizeObserver?.disconnect();
    for (const remove of listeners) remove();
    for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.clear();
    renderer?.dispose();
    renderer?.forceContextLoss();
    // A rebuild or context loss must not remove the keyboard's current position.
    // A detached host belongs to an unmounted dialog and must not reclaim focus.
    if (container.isConnected && root.contains(container.ownerDocument.activeElement)) {
      container.focus({ preventScroll: true });
    }
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
    const focusSpan = point && buildingHeightById.has(point.id)
      ? Math.max(140, Math.min(260, model.radius * 0.32))
      : Math.max(180, Math.min(450, model.radius * 0.85));
    const offset = spatialCameraDirection(view.bearing, view.overhead);
    const direction = new Vector3(offset.x, offset.y, offset.z);
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
        for (const y of [0, Math.max(pinHeight + pinRadius, tallestBuilding + pinRadius * 2)]) {
          const corner = new Vector3(x, y, z);
          const nearOffset = corner.dot(direction);
          distance = Math.max(distance,
            nearOffset + Math.abs(corner.dot(right)) / (tangent * aspect),
            nearOffset + Math.abs(corner.dot(up)) / tangent);
        }
      }
    }
    return { target, position: direction.multiplyScalar(distance / view.zoom).add(target) };
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
    if (changed) {
      cancelDrag();
      moveCamera(false);
    }
    requestFrame();
  }
  function updateAppearance() {
    const palette = view.dark ? palettes.dark : palettes.light;
    scene.background = new Color(palette.background);
    groundMaterial?.color.set(palette.ground);
    stemMaterial?.color.set(palette.stem);
    gridMaterial?.color.set(palette.grid);
    ringMaterial?.color.set(palette.accent);
    for (const item of buildingMaterials) {
      item.material.color.set(item.id === view.selectedId ? palette.accent :
        view.dark ? '#53645f' : '#abbab2');
    }
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
  }
  function projectLabels() {
    const selected = view.selectedId ? pointsById.get(view.selectedId) : undefined;
    const focusedButton = labels.find(({ button }) => button === container.ownerDocument.activeElement)?.button;
    const projected = labels.map((label) => ({
      ...label,
      screen: new Vector3(
        label.point.x,
        buildingHeightById.has(label.point.id)
          ? buildingHeightById.get(label.point.id)! + pinRadius * 2
          : pinHeight + pinRadius,
        label.point.z,
      ).project(camera),
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
      ...normalizeSpatialCamera(next),
      selectedId: next.selectedId && pointsById.has(next.selectedId) ? next.selectedId : null,
    };
    const targetChanged = view.selectedId !== normalized.selectedId || view.overhead !== normalized.overhead;
    const controlsChanged = view.bearing !== normalized.bearing || view.zoom !== normalized.zoom;
    const cameraChanged = targetChanged || controlsChanged;
    const appearanceChanged = view.dark !== normalized.dark || view.selectedId !== normalized.selectedId;
    const motionChanged = view.motion !== normalized.motion;
    requestedCamera = normalizeSpatialCamera(normalized);
    if (!cameraChanged && !appearanceChanged && !motionChanged) return;
    if (targetChanged) cancelDrag();
    view = normalized;
    if (!view.motion) finishTransition();
    if (cameraChanged) moveCamera(targetChanged && view.motion);
    if (appearanceChanged) updateAppearance();
    requestFrame();
  }
  function setActive(next: boolean) {
    if (disposed || active === next) return;
    active = next;
    if (!active) {
      cancelFrame();
      cancelDrag();
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

    // Only published OSM way outlines that passed the Providence source whitelist are extruded.
    // The shape is geographic; without a recorded OSM height the 12 m volume is illustrative.
    const anchor = model.points[0];
    const longitudeScale = 6_371_008.8 * Math.PI / 180 *
      Math.cos(anchor.location.lat * Math.PI / 180);
    const latitudeScale = 6_371_008.8 * Math.PI / 180;
    for (const footprint of options.footprints ?? []) {
      if (!pointsById.has(footprint.poiId)) continue;
      const shape = new Shape();
      footprint.outline.forEach(([longitude, latitude], index) => {
        const x = anchor.x + (longitude - anchor.location.lng) * longitudeScale;
        const z = anchor.z - (latitude - anchor.location.lat) * latitudeScale;
        if (index === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();
      const material = ownMaterial(new MeshStandardMaterial({
        color: '#abbab2', roughness: 0.93, metalness: 0,
      }));
      const geometry = ownGeometry(new ExtrudeGeometry(shape, {
        depth: footprint.heightMeters, bevelEnabled: false, steps: 1, curveSegments: 1,
      }));
      const building = new Mesh(geometry, material);
      building.rotation.x = -Math.PI / 2;
      building.position.y = 0.2;
      scene.add(building);
      buildingMaterials.push({ id: footprint.poiId, material });
    }

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
      const roof = buildingHeightById.get(point.id);
      if (roof === undefined) {
        stems.setMatrixAt(index, matrix.makeTranslation(point.x, pinHeight / 2, point.z));
        feet.setMatrixAt(index, matrix.makeTranslation(point.x, 0.1, point.z).multiply(flat));
        caps!.setMatrixAt(index, matrix.makeTranslation(point.x, pinHeight, point.z));
      } else {
        // Keep an accessible marker above the roof without covering the whole
        // geographic building footprint with the original oversized pin.
        const roofStemHeight = pinRadius * 0.9;
        stems.setMatrixAt(index, matrix.makeTranslation(point.x, roof + roofStemHeight / 2, point.z)
          .scale(new Vector3(0.35, roofStemHeight / pinHeight, 0.35)));
        feet.setMatrixAt(index, matrix.makeTranslation(point.x, roof + 0.15, point.z)
          .multiply(flat).scale(new Vector3(0.32, 0.32, 0.32)));
        caps!.setMatrixAt(index, matrix.makeTranslation(point.x, roof + roofStemHeight, point.z)
          .scale(new Vector3(0.36, 0.36, 0.36)));
      }
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

    container.append(root);
    updateAppearance();
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', resize);
    listeners.push(() => window.removeEventListener('resize', resize));
    if (options.onCameraChange) {
      const previousTouchAction = container.style.touchAction;
      container.style.touchAction = 'pan-y pinch-zoom';
      container.addEventListener('keydown', onKeyDown);
      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerCancel);
      container.addEventListener('lostpointercapture', onPointerCancel);
      container.addEventListener('pointerleave', onPointerLeave);
      container.addEventListener('click', suppressClick, true);
      window.addEventListener('blur', cancelDrag);
      listeners.push(() => {
        container.style.touchAction = previousTouchAction;
        container.removeEventListener('keydown', onKeyDown);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerCancel);
        container.removeEventListener('lostpointercapture', onPointerCancel);
        container.removeEventListener('pointerleave', onPointerLeave);
        container.removeEventListener('click', suppressClick, true);
        window.removeEventListener('blur', cancelDrag);
      });
    }
  } catch {
    fail();
  }

  return { setView, setActive, dispose };
}
