import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Camera, ExtrudeGeometry, InstancedMesh, Material, Matrix4, Mesh, PlaneGeometry, Scene, Vector3 } from 'three';
import { buildCampusSpatialModel } from './campusSpatialModel';
import { PROVIDENCE_CAMPUS_PLACES } from './providenceCampus';
import { parseProvidenceOsmFootprints, parseProvidenceFootprintResponse, type ProvidenceFootprint } from './providenceFootprints';
import { createCampusSpatialScene, type CampusSpatialScene, type CampusSpatialView } from './campusSpatialScene';
import {
  DEFAULT_SPATIAL_BEARING,
  MAX_SPATIAL_ZOOM,
  MIN_SPATIAL_ZOOM,
  SPATIAL_ROTATION_STEP,
  SPATIAL_ZOOM_FACTOR,
  normalizeSpatialCamera,
  spatialNorthRotationDegrees,
  type CampusSpatialCamera,
} from './campusSpatialCamera';
import type { MapLocation } from './mapService';

const webgl = vi.hoisted(() => ({
  failConstruction: false,
  failRender: false,
  renderers: [] as Array<{
    domElement: HTMLCanvasElement;
    render: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    forceContextLoss: ReturnType<typeof vi.fn>;
  }>,
}));

// Only the GPU boundary is replaced. Geometry, camera matrices and label projection use Three.js.
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  class Renderer {
    domElement: HTMLCanvasElement;
    render = vi.fn((scene: Scene, camera: Camera) => {
      if (webgl.failRender) throw new Error('driver unavailable');
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
    });
    setSize = vi.fn((width: number, height: number) => {
      this.domElement.width = width;
      this.domElement.height = height;
    });
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      if (webgl.failConstruction) throw new Error('WebGL2 unavailable');
      this.domElement = canvas;
      webgl.renderers.push(this);
    }
  }
  return { ...actual, WebGLRenderer: Renderer };
});

const locations: MapLocation[] = [
  { id: 'library', name: '圖書館', category: '圖書館', description: '', lat: 24, lng: 120 },
  { id: 'hall', name: '教學大樓', category: '教學', description: '', lat: 24.002, lng: 120.002 },
];
const model = buildCampusSpatialModel(locations);
let time: number;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
let scenes: CampusSpatialScene[];
let observers: Array<{ callback: ResizeObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  webgl.failConstruction = false;
  webgl.failRender = false;
  webgl.renderers = [];
  time = 0;
  frameId = 0;
  frames = new Map();
  scenes = [];
  observers = [];
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  });
});

afterEach(() => {
  for (const scene of scenes) scene.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function drawFrame(elapsed = 16) {
  time += elapsed;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
}

function setup(source = model, onCameraChange?: (camera: CampusSpatialCamera) => void,
  footprints: readonly ProvidenceFootprint[] = []) {
  const container = document.createElement('div');
  container.tabIndex = -1;
  const bounds = { width: 800, height: 480 };
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: bounds.width, bottom: bounds.height,
    width: bounds.width, height: bounds.height, toJSON: () => ({}),
  }));
  document.body.append(container);
  const onSelect = vi.fn();
  const onError = vi.fn();
  const scene = createCampusSpatialScene(container, source, { onSelect, onError, onCameraChange, footprints });
  scenes.push(scene);
  return { scene, container, bounds, onSelect, onError, renderer: webgl.renderers.at(-1)! };
}

function setupControlled(source = model) {
  let current: CampusSpatialView = {
    selectedId: null, overhead: false, motion: true, dark: false, ...normalizeSpatialCamera(),
  };
  const onCameraChange = vi.fn((camera: CampusSpatialCamera) => {
    current = { ...current, ...camera };
    result.scene.setView(current);
  });
  const result = setup(source, onCameraChange);
  result.container.tabIndex = 0;
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((id: number) => captured.add(id));
  const releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  Object.assign(result.container, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture: (id: number) => captured.has(id),
  });
  result.scene.setView(current);
  return {
    ...result, onCameraChange, captured, setPointerCapture, releasePointerCapture,
    setView(next: Partial<CampusSpatialView>) {
      current = { ...current, ...next };
      result.scene.setView(current);
    },
  };
}

function pointer(target: EventTarget, type: string, init: Partial<PointerEvent> = {}) {
  // jsdom does not implement browser pointer capture. Event dispatch is real; capture is a boundary stub.
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
    clientX: 100, clientY: 100, ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function keyboard(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function lastCamera(renderer: (typeof webgl.renderers)[number]) {
  return renderer.render.mock.calls.at(-1)![1] as Camera;
}

function focusOnGround(camera: Camera) {
  const direction = camera.getWorldDirection(new Vector3());
  return camera.position.clone().addScaledVector(direction, -camera.position.y / direction.y);
}

describe('optional spatial canvas lifecycle', () => {
  it('renders once on arrival and leaves no idle animation loop', () => {
    const { scene, renderer } = setup();
    expect(frames.size).toBe(1);
    drawFrame();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    scene.setView({ selectedId: null, overhead: false, motion: false, dark: false });
    drawFrame(1000);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    scene.setView({ selectedId: null, overhead: false, motion: false, dark: true });
    drawFrame();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('flies to a real selected point, then stops drawing', () => {
    const { scene, renderer } = setup();
    drawFrame();
    scene.setView({ selectedId: 'hall', overhead: false, motion: true, dark: false });
    drawFrame(100);
    expect(frames.size).toBe(1);
    drawFrame(500);
    expect(frames.size).toBe(0);
    const camera = renderer.render.mock.calls.at(-1)![1] as Camera;
    const target = focusOnGround(camera);
    expect(target.x).toBeCloseTo(model.points[1].x, 6);
    expect(target.z).toBeCloseTo(model.points[1].z, 6);
  });

  it('applies a reduced-motion change during flight and does not restart it', () => {
    const { scene, renderer } = setup();
    drawFrame();
    scene.setView({ selectedId: 'hall', overhead: true, motion: true, dark: false });
    drawFrame(100);
    scene.setView({ selectedId: 'hall', overhead: true, motion: false, dark: false });
    drawFrame();
    const count = renderer.render.mock.calls.length;
    expect(frames.size).toBe(0);
    drawFrame(1000);
    expect(renderer.render).toHaveBeenCalledTimes(count);
    const camera = renderer.render.mock.calls.at(-1)![1] as Camera;
    const target = focusOnGround(camera);
    expect(target.x).toBeCloseTo(model.points[1].x, 6);
    expect(target.z).toBeCloseTo(model.points[1].z, 6);
  });

  it('cancels background frames and resumes at the destination without replaying a flight', () => {
    const { scene, renderer } = setup();
    drawFrame();
    scene.setView({ selectedId: 'library', overhead: false, motion: true, dark: false });
    drawFrame(100);
    scene.setActive(false);
    expect(frames.size).toBe(0);
    const count = renderer.render.mock.calls.length;
    drawFrame(2000);
    expect(renderer.render).toHaveBeenCalledTimes(count);
    scene.setActive(true);
    drawFrame();
    expect(renderer.render).toHaveBeenCalledTimes(count + 1);
    expect(frames.size).toBe(0);
    const target = focusOnGround(renderer.render.mock.calls.at(-1)![1] as Camera);
    expect(target.x).toBeCloseTo(model.points[0].x, 6);
    expect(target.z).toBeCloseTo(model.points[0].z, 6);
  });

  it('bounds DPR and total GPU pixels while preserving the displayed camera aspect', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const { renderer, bounds } = setup();
    expect(renderer.domElement.width).toBe(1200);
    expect(renderer.domElement.height).toBe(720);
    bounds.width = 4000;
    bounds.height = 2000;
    window.dispatchEvent(new Event('resize'));
    drawFrame();
    const canvas = renderer.domElement;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(1_200_000);
    expect(canvas.width / canvas.height).toBeCloseTo(2, 2);
    const camera = renderer.render.mock.calls.at(-1)![1] as Camera & { aspect: number };
    expect(camera.aspect).toBe(2);
    expect(frames.size).toBe(0);
  });

  it.each(
    [{ width: 480, height: 800 }, { width: 500, height: 500 }].flatMap((size) =>
      [0, DEFAULT_SPATIAL_BEARING, 90, 135, 225, 315].flatMap((bearing) =>
        [false, true].map((overhead) => ({ ...size, bearing, overhead }))),
    ),
  )(
    'fits every overview corner at bearing $bearing, overhead=$overhead in $width × $height', (size) => {
      const square = buildCampusSpatialModel([
        { ...locations[0], id: 'nw', lat: 24.004, lng: 119.9956 },
        { ...locations[0], id: 'ne', lat: 24.004, lng: 120.0044 },
        { ...locations[0], id: 'sw', lat: 23.996, lng: 119.9956 },
        { ...locations[0], id: 'se', lat: 23.996, lng: 120.0044 },
      ]);
      const { scene, renderer, bounds } = setup(square);
      Object.assign(bounds, size);
      window.dispatchEvent(new Event('resize'));
      scene.setView({
        selectedId: null, overhead: size.overhead, bearing: size.bearing,
        motion: false, dark: false, zoom: 1,
      });
      drawFrame();
      const [renderedScene, camera] = renderer.render.mock.calls.at(-1)! as [Scene, Camera];
      const caps = renderedScene.children.find((child): child is InstancedMesh =>
        child instanceof InstancedMesh && child.geometry.type === 'SphereGeometry',
      )!;
      expect(caps.count).toBe(4);
      for (let index = 0; index < caps.count; index += 1) {
        const matrix = new Matrix4();
        caps.getMatrixAt(index, matrix);
        const projected = new Vector3().setFromMatrixPosition(matrix).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(0.88);
        expect(Math.abs(projected.y)).toBeLessThan(0.88);
        expect(projected.z).toBeGreaterThan(-1);
        expect(projected.z).toBeLessThan(1);
      }
    },
  );

  it.each([false, true])('projects compass north consistently with the actual overhead=%s camera', (overhead) => {
    const { scene, renderer, bounds } = setup();
    for (const bearing of [0, 45, 90, 135, 210, 270, 315]) {
      scene.setView({ selectedId: null, overhead, motion: false, dark: false, bearing, zoom: 1 });
      drawFrame();
      const camera = lastCamera(renderer);
      const target = focusOnGround(camera);
      const center = target.clone().project(camera);
      const north = target.clone().add(new Vector3(0, 0, -10)).project(camera);
      const screenX = (north.x - center.x) * bounds.width;
      const screenUp = (north.y - center.y) * bounds.height;
      const rotation = normalizeSpatialCamera({ bearing: Math.atan2(screenX, screenUp) * 180 / Math.PI }).bearing;
      const expected = spatialNorthRotationDegrees(bearing, overhead);
      const shortestDifference = (rotation - expected + 540) % 360 - 180;
      expect(shortestDifference).toBeCloseTo(0, 7);
      if (bearing === 0) {
        expect(north.y).toBeGreaterThan(center.y);
        expect(north.x).toBeCloseTo(center.x, 10);
      }
    }
    expect(frames.size).toBe(0);
  });

  it('applies rotation and bounded zoom immediately even when flight animation is enabled', () => {
    const { renderer, setView } = setupControlled();
    drawFrame();
    const originalDistance = lastCamera(renderer).position.length();
    setView({ zoom: 2 });
    drawFrame();
    expect(lastCamera(renderer).position.length()).toBeCloseTo(originalDistance / 2, 8);
    expect(frames.size).toBe(0);
    setView({ bearing: 90 });
    drawFrame();
    const camera = lastCamera(renderer);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.z).toBeCloseTo(0, 8);
    expect(focusOnGround(camera).length()).toBeCloseTo(0, 8);
    expect(frames.size).toBe(0);
    setView({ zoom: 100 });
    drawFrame();
    const maximumZoomDistance = camera.position.length();
    setView({ zoom: MAX_SPATIAL_ZOOM });
    expect(frames.size).toBe(0);
    expect(camera.position.length()).toBe(maximumZoomDistance);
    setView({ selectedId: 'hall', zoom: 1 });
    drawFrame(100);
    expect(frames.size).toBe(1);
    setView({ bearing: 0 });
    drawFrame();
    expect(frames.size).toBe(0);
    expect(focusOnGround(camera).x).toBeCloseTo(model.points[1].x, 8);
    expect(focusOnGround(camera).z).toBeCloseTo(model.points[1].z, 8);
  });

  it('treats names as text and lets native buttons select their real source id', () => {
    const namedPlace = { ...locations[0], name: '<img src=x onerror=alert(1)>' };
    const { scene, container, onSelect } = setup(buildCampusSpatialModel([namedPlace]));
    drawFrame();
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe(namedPlace.name);
    expect(button.getAttribute('aria-label')).toBe(`聚焦${namedPlace.name}`);
    expect(container.querySelector('img')).toBeNull();
    expect(button.hidden).toBe(false);
    button.click();
    expect(onSelect).toHaveBeenCalledWith(namedPlace.id);
    scene.dispose();
    button.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the focused on-screen label ahead of competing co-located labels', () => {
    const coLocated = buildCampusSpatialModel([
      locations[0], { ...locations[0], id: 'printer', name: '列印區' },
    ]);
    const { scene, container } = setup(coLocated);
    drawFrame();
    const library = container.querySelector<HTMLButtonElement>('[data-spatial-marker="library"]')!;
    expect(library.hidden).toBe(false);
    library.focus();
    expect(document.activeElement).toBe(library);
    scene.setView({ selectedId: 'printer', overhead: false, motion: false, dark: false });
    drawFrame();
    expect(document.activeElement).toBe(library);
    expect(library.hidden).toBe(false);
    expect(library.style.display).not.toBe('none');
  });

  it('returns focus to the scene when a focused place leaves the actual camera view', () => {
    const separated = buildCampusSpatialModel([
      locations[0], { ...locations[1], lat: 24.02, lng: 120.02 },
    ]);
    const { scene, container } = setup(separated);
    drawFrame();
    const library = container.querySelector<HTMLButtonElement>('[data-spatial-marker="library"]')!;
    expect(library.hidden).toBe(false);
    library.focus();
    scene.setView({ selectedId: 'hall', overhead: true, motion: false, dark: false });
    drawFrame();
    expect(library.hidden).toBe(true);
    expect(library.style.display).toBe('none');
    expect(document.activeElement).toBe(container);
  });

  it('keeps a focused label usable after a narrow viewport resize', () => {
    const { scene, container, bounds } = setup();
    drawFrame();
    scene.setView({ selectedId: 'hall', overhead: false, motion: false, dark: false });
    drawFrame();
    const hall = container.querySelector<HTMLButtonElement>('[data-spatial-marker="hall"]')!;
    expect(hall.hidden).toBe(false);
    hall.focus();
    Object.assign(bounds, { width: 240, height: 600 });
    window.dispatchEvent(new Event('resize'));
    drawFrame();
    expect(document.activeElement).toBe(hall);
    expect(hall.hidden).toBe(false);
    expect(hall.style.display).not.toBe('none');
  });

  it('does not take focus from an external selector during a camera change or resize', () => {
    const { scene, bounds } = setup();
    drawFrame();
    const selector = document.createElement('select');
    document.body.append(selector);
    selector.focus();
    scene.setView({ selectedId: 'hall', overhead: true, motion: false, dark: false });
    drawFrame();
    expect(document.activeElement).toBe(selector);
    Object.assign(bounds, { width: 240, height: 600 });
    window.dispatchEvent(new Event('resize'));
    drawFrame();
    expect(document.activeElement).toBe(selector);
  });

  it('returns focused labels to the host when a scene is rebuilt from changed source data', () => {
    const { scene, container, onSelect, onError } = setup();
    container.tabIndex = 0;
    drawFrame();
    const label = [...container.querySelectorAll('button')].find((button) => !button.hidden)!;
    label.focus();
    expect(document.activeElement).toBe(label);
    scene.dispose();
    expect(label.isConnected).toBe(false);
    expect(document.activeElement).toBe(container);
    const replacement = createCampusSpatialScene(container, buildCampusSpatialModel([locations[1]]), {
      onSelect, onError,
    });
    scenes.push(replacement);
    drawFrame();
    expect(document.activeElement).toBe(container);
    expect(container.querySelector('button')?.hidden).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('preserves a keyboard continuation point when context loss removes the focused label', () => {
    const { container, renderer, onError } = setup();
    container.tabIndex = 0;
    drawFrame();
    const label = [...container.querySelectorAll('button')].find((button) => !button.hidden)!;
    label.focus();
    renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(label.isConnected).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(container);
    expect(frames.size).toBe(0);
  });

  it.each(['select', 'button'])('leaves focus on an external %s when disposing a scene', (tag) => {
    const { scene, container } = setup();
    drawFrame();
    const external = document.createElement(tag);
    document.body.append(external);
    external.focus();
    const focusHost = vi.spyOn(container, 'focus');
    scene.dispose();
    expect(document.activeElement).toBe(external);
    expect(focusHost).not.toHaveBeenCalled();
  });

  it('does not restore focus to a host that React has already unmounted', () => {
    const { scene, container } = setup();
    drawFrame();
    const label = [...container.querySelectorAll('button')].find((button) => !button.hidden)!;
    label.focus();
    const opener = document.createElement('button');
    document.body.append(opener);
    container.remove();
    opener.focus();
    const focusHost = vi.spyOn(container, 'focus');
    scene.dispose();
    expect(container.isConnected).toBe(false);
    expect(focusHost).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    expect(frames.size).toBe(0);
  });

  it('cleans up GPU resources, event handlers and the canvas exactly once', () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const instanceDispose = vi.spyOn(InstancedMesh.prototype, 'dispose');
    const { scene, container, renderer } = setup();
    drawFrame();
    scene.setView({ selectedId: 'hall', overhead: false, motion: true, dark: false });
    scene.dispose();
    scene.dispose();
    expect(frames.size).toBe(0);
    expect(container.childElementCount).toBe(0);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(6);
    expect(materialDispose).toHaveBeenCalledTimes(6);
    expect(instanceDispose).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(0);
  });

  it('reports context loss once, frees the scene and leaves no live animation work', () => {
    const { container, onError, renderer, scene } = setup();
    const canvas = renderer.domElement;
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(container.childElementCount).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    scene.setView({ selectedId: 'hall', overhead: false, motion: true, dark: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('returns a recoverable error when WebGL creation or rendering fails', () => {
    webgl.failConstruction = true;
    const first = setup();
    expect(first.onError).toHaveBeenCalledTimes(1);
    expect(first.container.childElementCount).toBe(0);
    expect(frames.size).toBe(0);
    webgl.failConstruction = false;
    const second = setup();
    webgl.failRender = true;
    drawFrame();
    expect(second.onError).toHaveBeenCalledTimes(1);
    expect(second.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(second.container.childElementCount).toBe(0);
    expect(frames.size).toBe(0);
  });
});

describe('controlled spatial camera input', () => {
  it('emits camera intent without moving until the owner supplies the controlled view', () => {
    const onCameraChange = vi.fn();
    const { container, scene, renderer } = setup(model, onCameraChange);
    container.tabIndex = 0;
    container.focus();
    drawFrame();
    const previous = lastCamera(renderer).position.clone();
    expect(keyboard(container, 'ArrowRight').defaultPrevented).toBe(true);
    const requested = onCameraChange.mock.calls[0][0] as CampusSpatialCamera;
    expect(requested.bearing).toBeCloseTo(DEFAULT_SPATIAL_BEARING + SPATIAL_ROTATION_STEP, 8);
    expect(requested.zoom).toBe(1);
    expect(lastCamera(renderer).position.equals(previous)).toBe(true);
    expect(frames.size).toBe(0);
    scene.setView({ selectedId: null, overhead: false, motion: true, dark: false, ...requested });
    drawFrame();
    expect(lastCamera(renderer).position.equals(previous)).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('supports host keyboard rotation, bounded zoom and a north-up reset', () => {
    const { container, onCameraChange } = setupControlled();
    drawFrame();
    container.focus();
    keyboard(container, 'ArrowLeft');
    expect(onCameraChange).toHaveBeenLastCalledWith({
      bearing: normalizeSpatialCamera({ bearing: DEFAULT_SPATIAL_BEARING - SPATIAL_ROTATION_STEP }).bearing,
      zoom: 1,
    });
    keyboard(container, '+');
    expect(onCameraChange.mock.calls.at(-1)![0].zoom).toBe(SPATIAL_ZOOM_FACTOR);
    for (let index = 0; index < 20; index += 1) keyboard(container, '+');
    expect(onCameraChange.mock.calls.at(-1)![0].zoom).toBe(MAX_SPATIAL_ZOOM);
    const maximumCalls = onCameraChange.mock.calls.length;
    keyboard(container, '+');
    expect(onCameraChange).toHaveBeenCalledTimes(maximumCalls);
    for (let index = 0; index < 20; index += 1) keyboard(container, '-');
    expect(onCameraChange.mock.calls.at(-1)![0].zoom).toBe(MIN_SPATIAL_ZOOM);
    keyboard(container, 'Home');
    expect(onCameraChange).toHaveBeenLastCalledWith({ bearing: 0, zoom: 1 });
    drawFrame();
    expect(frames.size).toBe(0);
    expect(document.activeElement).toBe(container);
  });

  it('leaves label buttons, selectors, ranges and browser shortcuts in control of their own keys', () => {
    const { container, onCameraChange, onSelect } = setupControlled();
    drawFrame();
    const button = [...container.querySelectorAll('button')].find((label) => !label.hidden)!;
    button.focus();
    for (const key of ['ArrowLeft', '+', 'Home']) expect(keyboard(button, key).defaultPrevented).toBe(false);
    button.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const select = document.createElement('select');
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(select, range);
    for (const input of [select, range]) {
      input.focus();
      expect(keyboard(input, 'ArrowRight').defaultPrevented).toBe(false);
      expect(keyboard(container, 'Home').defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    container.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keyboard(container, '+', init).defaultPrevented).toBe(false);
    }
    for (const key of ['ArrowUp', 'ArrowDown', 'Escape', 'Tab']) {
      expect(keyboard(container, key).defaultPrevented).toBe(false);
    }
    expect(onCameraChange).not.toHaveBeenCalled();
  });

  it('rotates only after horizontal intent and preserves the final mouse-up position', () => {
    const { container, onCameraChange, setPointerCapture, releasePointerCapture, captured, renderer } = setupControlled();
    drawFrame();
    const original = lastCamera(renderer).position.clone();
    expect(pointer(container, 'pointerdown', { pointerType: 'mouse' }).defaultPrevented).toBe(false);
    expect(pointer(container, 'pointermove', { clientX: 105, pointerType: 'mouse' }).defaultPrevented).toBe(false);
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(pointer(container, 'pointermove', {
      clientX: 300, clientY: 105, pointerType: 'mouse',
    }).defaultPrevented).toBe(true);
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(captured.has(1)).toBe(true);
    expect(onCameraChange.mock.calls.at(-1)![0].bearing).toBeCloseTo(DEFAULT_SPATIAL_BEARING + 45, 8);
    pointer(container, 'pointerup', { clientX: 500, clientY: 105, pointerType: 'mouse', buttons: 0 });
    expect(onCameraChange.mock.calls.at(-1)![0].bearing).toBeCloseTo(DEFAULT_SPATIAL_BEARING + 90, 8);
    expect(onCameraChange.mock.calls.at(-1)![0].zoom).toBe(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(captured.size).toBe(0);
    drawFrame();
    expect(lastCamera(renderer).position.equals(original)).toBe(false);
    expect(frames.size).toBe(0);
    pointer(container, 'pointermove', { clientX: 700 });
    expect(onCameraChange).toHaveBeenCalledTimes(2);
  });

  it('allows vertical scrolling, browser pinch zoom and wheel input without camera changes', () => {
    const { container, onCameraChange, setPointerCapture } = setupControlled();
    drawFrame();
    expect(container.style.touchAction).toBe('pan-y pinch-zoom');
    pointer(container, 'pointerdown');
    expect(pointer(container, 'pointermove', { clientX: 104, clientY: 120 }).defaultPrevented).toBe(false);
    expect(pointer(container, 'pointermove', { clientX: 400, clientY: 120 }).defaultPrevented).toBe(false);
    pointer(container, 'pointerup');
    pointer(container, 'pointerdown');
    expect(pointer(container, 'pointerdown', { pointerId: 2, isPrimary: false }).defaultPrevented).toBe(false);
    pointer(container, 'pointermove', { clientX: 500 });
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    container.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('keeps label taps native and suppresses the synthetic click following a drag', () => {
    const { container, onSelect, onCameraChange } = setupControlled();
    drawFrame();
    const button = [...container.querySelectorAll('button')].find((label) => !label.hidden)!;
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 300 });
    pointer(button, 'pointerup', { clientX: 300 });
    button.click();
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 300 });
    pointer(container, 'pointerup', { clientX: 300 });
    const dragClick = new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true });
    button.dispatchEvent(dragClick);
    expect(dragClick.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup');
    button.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'second-touch', 'resize', 'selection']) (
    'ends pointer tracking after %s', (reason) => {
      const { container, bounds, onCameraChange, setView, captured } = setupControlled();
      drawFrame();
      pointer(container, 'pointerdown');
      pointer(container, 'pointermove', { clientX: 300 });
      expect(captured.has(1)).toBe(true);
      switch (reason) {
        case 'blur': window.dispatchEvent(new Event('blur')); break;
        case 'second-touch': pointer(container, 'pointerdown', { pointerId: 2, isPrimary: false }); break;
        case 'resize': bounds.width = 400; window.dispatchEvent(new Event('resize')); break;
        case 'selection': setView({ selectedId: 'hall' }); break;
        default: pointer(container, reason);
      }
      expect(captured.size).toBe(0);
      onCameraChange.mockClear();
      pointer(container, 'pointermove', { clientX: 700 });
      pointer(container, 'pointerup', { clientX: 700 });
      expect(onCameraChange).not.toHaveBeenCalled();
      drawFrame(500);
      expect(frames.size).toBe(0);
    },
  );

  it('stops tracking on pointer leave when pointer capture is unavailable', () => {
    const { container, onCameraChange } = setupControlled();
    container.setPointerCapture = () => { throw new Error('capture unavailable'); };
    drawFrame();
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 300 });
    expect(onCameraChange).toHaveBeenCalledTimes(1);
    pointer(container, 'pointerleave');
    pointer(container, 'pointermove', { clientX: 700 });
    expect(onCameraChange).toHaveBeenCalledTimes(1);
  });

  it('releases capture while inactive and removes all input behavior on disposal', () => {
    const { container, scene, onCameraChange, captured } = setupControlled();
    container.focus();
    drawFrame();
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 300 });
    scene.setActive(false);
    expect(captured.size).toBe(0);
    expect(frames.size).toBe(0);
    onCameraChange.mockClear();
    expect(keyboard(container, 'Home').defaultPrevented).toBe(false);
    pointer(container, 'pointermove', { clientX: 700 });
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 500 });
    expect(onCameraChange).not.toHaveBeenCalled();
    scene.setActive(true);
    drawFrame();
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 300 });
    expect(captured.size).toBe(1);
    scene.dispose();
    expect(captured.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(container.style.touchAction || '').toBe('');
    onCameraChange.mockClear();
    pointer(container, 'pointerdown');
    pointer(container, 'pointermove', { clientX: 500 });
    keyboard(container, 'Home');
    window.dispatchEvent(new Event('blur'));
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});

it('extrudes OSM footprints in geographically aligned meters only for known spatial points', () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const campus = buildCampusSpatialModel([library]);
  const outlines = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  const { renderer } = setup(campus, undefined, outlines);
  drawFrame();
  const graph = renderer.render.mock.calls.at(-1)?.[0] as Scene;
  const volumes: Mesh[] = [];
  graph.traverse((object) => {
    if (object instanceof Mesh && object.geometry instanceof ExtrudeGeometry) volumes.push(object);
  });
  expect(volumes).toHaveLength(1);
  const volume = volumes[0];
  volume.geometry.computeBoundingBox();
  const bounds = volume.geometry.boundingBox!;
  expect(bounds.max.z - bounds.min.z).toBeCloseTo(12, 6); // not a measured building height
  expect(bounds.max.x - bounds.min.x).toBeGreaterThan(10); // geographic longitude span in meters
  expect(bounds.max.y - bounds.min.y).toBeGreaterThan(10); // geographic latitude span in meters
  const otherSchool = buildCampusSpatialModel(locations);
  const other = setup(otherSchool, undefined, outlines);
  drawFrame();
  const otherGraph = other.renderer.render.mock.calls.at(-1)?.[0] as Scene;
  let otherVolumes = 0;
  otherGraph.traverse((object) => {
    if (object instanceof Mesh && object.geometry instanceof ExtrudeGeometry) otherVolumes += 1;
  });
  expect(otherVolumes).toBe(0);
});


it('does not zoom out for a tall building whose POI is absent from the current campus view', () => {
  // A filtering change can keep an older API footprint in memory. It must not
  // make an unrelated map look tiny despite that building never being drawn.
  const unrelated: ProvidenceFootprint = {
    poiId: 'pu-library', name: '測試用建築', sourceUrl: 'https://www.openstreetmap.org/way/255784049',
    outline: [[120.58131, 24.22624], [120.58143, 24.22624],
      [120.58143, 24.22634], [120.58131, 24.22634]],
    heightMeters: 100, heightBasis: 'osm-tag',
  };
  const without = setup(model);
  drawFrame();
  const expected = lastCamera(without.renderer).position.clone();
  const withUnrelated = setup(model, undefined, [unrelated]);
  drawFrame();
  const actual = lastCamera(withUnrelated.renderer).position;
  expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
  const graph = withUnrelated.renderer.render.mock.calls.at(-1)?.[0] as Scene;
  let volumes = 0;
  graph.traverse((object) => {
    if (object instanceof Mesh && object.geometry instanceof ExtrudeGeometry) volumes += 1;
  });
  expect(volumes).toBe(0);
});

it('frames an explicitly selected short building without zooming out for a different tall campus building', () => {
  // Both POIs remain visible in the model. Heights and outlines here are
  // synthetic renderer fixtures, not observed Providence building dimensions.
  const footprintAt = (point: (typeof model.points)[number], heightMeters: number): ProvidenceFootprint => ({
    poiId: point.id,
    name: point.name,
    sourceUrl: 'https://www.openstreetmap.org/way/255784049',
    outline: [
      [point.location.lng - 0.00003, point.location.lat - 0.00003],
      [point.location.lng + 0.00003, point.location.lat - 0.00003],
      [point.location.lng + 0.00003, point.location.lat + 0.00003],
      [point.location.lng - 0.00003, point.location.lat + 0.00003],
    ],
    heightMeters,
    heightBasis: 'osm-tag',
  });
  const selectedBuilding = footprintAt(model.points[0], 12);
  const otherTallBuilding = footprintAt(model.points[1], 100);
  const shortOnly = setup(model, undefined, [selectedBuilding]);
  const withTall = setup(model, undefined, [selectedBuilding, otherTallBuilding]);

  const selectedView = { selectedId: model.points[0].id, overhead: false, motion: false, dark: false };
  shortOnly.scene.setView(selectedView);
  withTall.scene.setView(selectedView);
  drawFrame();
  const focusedShortOnly = lastCamera(shortOnly.renderer).position.clone();
  const focusedWithTall = lastCamera(withTall.renderer).position.clone();
  expect(focusedWithTall.distanceTo(focusedShortOnly)).toBeLessThan(1e-6);

  // The overview must still fit the taller *visible* building; only the
  // explicitly focused camera should be independent of other building heights.
  const overview = { ...selectedView, selectedId: null };
  shortOnly.scene.setView(overview);
  withTall.scene.setView(overview);
  drawFrame();
  expect(lastCamera(withTall.renderer).position.length())
    .toBeGreaterThan(lastCamera(shortOnly.renderer).position.length());
});


it('fits an elongated OSM building when its selected POI is near an end', () => {
  // Synthetic footprint, not a claimed Providence measurement. The old
  // fixed 140-260 m framing clipped this outline on narrow viewports.
  const point = model.points[0];
  const footprintAt = (halfLongitude: number): ProvidenceFootprint => ({
    poiId: point.id,
    name: point.name,
    sourceUrl: 'https://www.openstreetmap.org/way/255784049',
    outline: [
      [point.location.lng - 0.00002, point.location.lat - 0.00003],
      [point.location.lng + halfLongitude, point.location.lat - 0.00003],
      [point.location.lng + halfLongitude, point.location.lat + 0.00003],
      [point.location.lng - 0.00002, point.location.lat + 0.00003],
    ],
    heightMeters: 12,
    heightBasis: 'illustrative',
  });
  const compact = setup(model, undefined, [footprintAt(0.00004)]);
  const elongated = setup(model, undefined, [footprintAt(0.0024)]);
  compact.bounds.width = 320;
  elongated.bounds.width = 320;
  for (const resize of observers) resize.callback([], resize as unknown as ResizeObserver);
  const selectedView = { selectedId: point.id, overhead: false, motion: false, dark: false };
  compact.scene.setView(selectedView);
  elongated.scene.setView(selectedView);
  drawFrame();
  const poi = new Vector3(point.x, 0, point.z);
  const compactDistance = lastCamera(compact.renderer).position.distanceTo(poi);
  const elongatedDistance = lastCamera(elongated.renderer).position.distanceTo(poi);
  expect(elongatedDistance).toBeGreaterThan(compactDistance * 1.5);
});

it('fits a long accepted OSM footprint in the campus overview and ground plane', () => {
  // Synthetic outline deliberately extends well past its POI; it is NOT a
  // measured Providence building. The overview previously used only POIs
  // to size the ground and camera, clipping long source-checked footprints.
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const campus = buildCampusSpatialModel([library]);
  const point = campus.points[0];
  const longOutline: ProvidenceFootprint = {
    poiId: point.id,
    name: point.name,
    sourceUrl: library.sourceUrl,
    outline: [
      [point.location.lng - 0.00002, point.location.lat - 0.00003],
      [point.location.lng + 0.0024, point.location.lat - 0.00003],
      [point.location.lng + 0.0024, point.location.lat + 0.00003],
      [point.location.lng - 0.00002, point.location.lat + 0.00003],
    ],
    heightMeters: 12,
    heightBasis: 'illustrative',
  };
  const without = setup(campus);
  const withLongOutline = setup(campus, undefined, [longOutline]);
  without.bounds.width = 320;
  withLongOutline.bounds.width = 320;
  for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver);
  drawFrame();

  const groundWidth = (renderer: (typeof webgl.renderers)[number]) => {
    const graph = renderer.render.mock.calls.at(-1)?.[0] as Scene;
    let width = 0;
    graph.traverse((object) => {
      if (object instanceof Mesh && object.geometry instanceof PlaneGeometry) {
        width = Math.max(width, object.geometry.parameters.width);
      }
    });
    return width;
  };
  // Include both ends of the footprint without inventing a new POI, ground
  // polygon, or a building dimension for any actual Providence campus block.
  expect(groundWidth(withLongOutline.renderer))
    .toBeGreaterThan(groundWidth(without.renderer) + 250);
  expect(lastCamera(withLongOutline.renderer).position.length())
    .toBeGreaterThan(lastCamera(without.renderer).position.length() * 1.5);
});

it('keeps a nearby but off-outline POI on the ground instead of inventing a rooftop marker', () => {
  // A cross-checked POI may be up to 30m from the verified OSM ring.
  // The following geometry is deliberately synthetic, not a surveyed building.
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const campus = buildCampusSpatialModel([library]);
  const [inside] = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes', height: '18 m' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(inside).toBeDefined();
  const exterior: ProvidenceFootprint = {
    ...inside,
    // Moving the outline 22m north leaves the POI about 18m outside.
    // It remains a permitted proximity match, not a proven roof/entrance.
    outline: inside.outline.map(([lon, lat]) => [lon, lat + 0.0002] as [number, number]),
  };
  expect(parseProvidenceFootprintResponse({
    schoolId: 'pu', buildings: [exterior],
  })).toHaveLength(1);

  const markerHeight = (footprint: ProvidenceFootprint) => {
    const { renderer } = setup(campus, undefined, [footprint]);
    drawFrame();
    const graph = renderer.render.mock.calls.at(-1)![0] as Scene;
    const caps = graph.children.find((item): item is InstancedMesh =>
      item instanceof InstancedMesh && item.geometry.type === 'SphereGeometry')!;
    const matrix = new Matrix4();
    caps.getMatrixAt(0, matrix);
    let buildingVolumes = 0;
    graph.traverse((item) => {
      if (item instanceof Mesh && item.geometry instanceof ExtrudeGeometry) buildingVolumes += 1;
    });
    return { y: new Vector3().setFromMatrixPosition(matrix).y, buildingVolumes };
  };

  const onRoof = markerHeight(inside);
  const onGround = markerHeight(exterior);
  const illustrative = markerHeight({
    ...inside,
    heightMeters: 12,
    heightBasis: 'illustrative',
  });
  expect(onRoof.y).toBeGreaterThan(inside.heightMeters);
  expect(onGround.y).toBeLessThan(inside.heightMeters);
  // A POI inside an OSM polygon is not proof of a 12m roof elevation.
  // Missing height tags may extrude an explicitly illustrative volume, but
  // the POI must not be lifted onto that invented roof.
  expect(illustrative.y).toBeCloseTo(onGround.y, 6);
  // The accepted sourced/illustrative outline is still drawn; only the
  // misleading floating POI is corrected, never moving it to a guessed entrance.
  expect(onRoof.buildingVolumes).toBe(1);
  expect(onGround.buildingVolumes).toBe(1);
  expect(illustrative.buildingVolumes).toBe(1);
});
