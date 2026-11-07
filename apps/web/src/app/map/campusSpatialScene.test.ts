import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Camera, InstancedMesh, Material, Matrix4, Scene, Vector3 } from 'three';
import { buildCampusSpatialModel } from './campusSpatialModel';
import { createCampusSpatialScene, type CampusSpatialScene } from './campusSpatialScene';
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

function setup(source = model) {
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
  const scene = createCampusSpatialScene(container, source, { onSelect, onError });
  scenes.push(scene);
  return { scene, container, bounds, onSelect, onError, renderer: webgl.renderers.at(-1)! };
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

  it.each([{ width: 480, height: 800 }, { width: 500, height: 500 }])(
    'fits every corner of an oblique overview in a $width × $height viewport', (size) => {
      const square = buildCampusSpatialModel([
        { ...locations[0], id: 'nw', lat: 24.004, lng: 119.9956 },
        { ...locations[0], id: 'ne', lat: 24.004, lng: 120.0044 },
        { ...locations[0], id: 'sw', lat: 23.996, lng: 119.9956 },
        { ...locations[0], id: 'se', lat: 23.996, lng: 120.0044 },
      ]);
      const { renderer, bounds } = setup(square);
      Object.assign(bounds, size);
      window.dispatchEvent(new Event('resize'));
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
