/**
 * AR Navigation Service
 * 擴增實境導航服務
 * 
 * 功能：
 * - 使用裝置感測器計算方向
 * - 計算目標位置的相對方向
 * - 產生 AR 導航指示
 * - 支援室內/室外導航
 */

import { Platform } from "react-native";

// AR Navigation types
export interface Location {
  latitude: number;
  longitude: number;
  altitude?: number;
  floor?: number;
}

export interface ARNavigationStep {
  id: string;
  instruction: string;
  distance: number;
  direction: DirectionType;
  bearing: number;
  landmark?: string;
  floor?: number;
  isIndoor?: boolean;
}

export type DirectionType = 
  | "straight" 
  | "slight_left" 
  | "left" 
  | "sharp_left"
  | "slight_right" 
  | "right" 
  | "sharp_right"
  | "u_turn"
  | "up_stairs"
  | "down_stairs"
  | "elevator_up"
  | "elevator_down"
  | "destination";

export interface DeviceOrientation {
  heading: number;
  pitch: number;
  roll: number;
}

export interface AROverlay {
  type: "arrow" | "destination" | "poi" | "warning";
  position: { x: number; y: number };
  rotation: number;
  scale: number;
  color: string;
  label?: string;
}

// Constants
const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// Direction thresholds (in degrees)
const DIRECTION_THRESHOLDS = {
  straight: 15,
  slight: 45,
  normal: 90,
  sharp: 135,
};

/**
 * Calculate distance between two coordinates using Haversine formula
 */
export function calculateDistance(
  from: Location,
  to: Location
): number {
  const dLat = (to.latitude - from.latitude) * DEG_TO_RAD;
  const dLon = (to.longitude - from.longitude) * DEG_TO_RAD;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(from.latitude * DEG_TO_RAD) * 
    Math.cos(to.latitude * DEG_TO_RAD) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return EARTH_RADIUS_M * c;
}

/**
 * Calculate bearing from one point to another
 */
export function calculateBearing(
  from: Location,
  to: Location
): number {
  const fromLat = from.latitude * DEG_TO_RAD;
  const toLat = to.latitude * DEG_TO_RAD;
  const dLon = (to.longitude - from.longitude) * DEG_TO_RAD;
  
  const x = Math.cos(toLat) * Math.sin(dLon);
  const y = Math.cos(fromLat) * Math.sin(toLat) - 
            Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLon);
  
  let bearing = Math.atan2(x, y) * RAD_TO_DEG;
  
  // Normalize to 0-360
  bearing = (bearing + 360) % 360;
  
  return bearing;
}

/**
 * Calculate relative angle considering device heading
 */
export function calculateRelativeAngle(
  bearing: number,
  deviceHeading: number
): number {
  let relative = bearing - deviceHeading;
  
  // Normalize to -180 to 180
  while (relative > 180) relative -= 360;
  while (relative < -180) relative += 360;
  
  return relative;
}

/**
 * Determine direction type based on angle
 */
export function getDirectionType(angle: number): DirectionType {
  const absAngle = Math.abs(angle);
  
  if (absAngle <= DIRECTION_THRESHOLDS.straight) {
    return "straight";
  } else if (absAngle <= DIRECTION_THRESHOLDS.slight) {
    return angle > 0 ? "slight_right" : "slight_left";
  } else if (absAngle <= DIRECTION_THRESHOLDS.normal) {
    return angle > 0 ? "right" : "left";
  } else if (absAngle <= DIRECTION_THRESHOLDS.sharp) {
    return angle > 0 ? "sharp_right" : "sharp_left";
  } else {
    return "u_turn";
  }
}

/**
 * Get instruction text for direction
 */
export function getDirectionInstruction(
  direction: DirectionType,
  distance: number,
  landmark?: string
): string {
  const distanceText = distance > 0 ? `約 ${Math.round(distance)} 公尺` : "";
  
  const instructions: Record<DirectionType, string> = {
    straight: `直走${distanceText}`,
    slight_left: `稍微左轉${distanceText ? `後${distanceText}` : ""}`,
    left: `左轉${distanceText ? `後${distanceText}` : ""}`,
    sharp_left: `大幅度左轉`,
    slight_right: `稍微右轉${distanceText ? `後${distanceText}` : ""}`,
    right: `右轉${distanceText ? `後${distanceText}` : ""}`,
    sharp_right: `大幅度右轉`,
    u_turn: `迴轉`,
    up_stairs: `上樓梯`,
    down_stairs: `下樓梯`,
    elevator_up: `搭乘電梯向上`,
    elevator_down: `搭乘電梯向下`,
    destination: `抵達目的地`,
  };
  
  let instruction = instructions[direction];
  
  if (landmark) {
    instruction += `（${landmark}）`;
  }
  
  return instruction;
}

/**
 * Get direction icon name
 */
export function getDirectionIcon(direction: DirectionType): string {
  const icons: Record<DirectionType, string> = {
    straight: "arrow-up",
    slight_left: "arrow-up-left",
    left: "arrow-back",
    sharp_left: "return-down-back",
    slight_right: "arrow-up-right",
    right: "arrow-forward",
    sharp_right: "return-down-forward",
    u_turn: "return-up-back",
    up_stairs: "chevron-up-circle",
    down_stairs: "chevron-down-circle",
    elevator_up: "caret-up-circle",
    elevator_down: "caret-down-circle",
    destination: "flag",
  };
  
  return icons[direction] ?? "navigate";
}

/**
 * Get direction color
 */
export function getDirectionColor(direction: DirectionType): string {
  const colors: Record<DirectionType, string> = {
    straight: "#3B82F6",
    slight_left: "#3B82F6",
    left: "#F59E0B",
    sharp_left: "#F59E0B",
    slight_right: "#3B82F6",
    right: "#F59E0B",
    sharp_right: "#F59E0B",
    u_turn: "#EF4444",
    up_stairs: "#8B5CF6",
    down_stairs: "#8B5CF6",
    elevator_up: "#8B5CF6",
    elevator_down: "#8B5CF6",
    destination: "#22C55E",
  };
  
  return colors[direction] ?? "#3B82F6";
}

/**
 * Calculate AR overlay position based on relative angle and device pitch
 */
export function calculateAROverlayPosition(
  relativeAngle: number,
  distance: number,
  devicePitch: number,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number; scale: number } {
  // Field of view (approximate for mobile devices)
  const horizontalFOV = 60;
  const verticalFOV = 45;
  
  // Calculate horizontal position
  const horizontalOffset = (relativeAngle / horizontalFOV) * screenWidth;
  const x = screenWidth / 2 + horizontalOffset;
  
  // Calculate vertical position based on distance and pitch
  const verticalAngle = devicePitch - Math.atan(1 / distance) * RAD_TO_DEG;
  const verticalOffset = (verticalAngle / verticalFOV) * screenHeight;
  const y = screenHeight / 2 - verticalOffset;
  
  // Calculate scale based on distance (closer = larger)
  const baseScale = 1;
  const maxDistance = 100; // meters
  const minScale = 0.3;
  const scale = Math.max(minScale, baseScale * (1 - distance / maxDistance));
  
  return { x, y, scale };
}

/**
 * Generate AR overlays for current navigation state
 */
export function generateAROverlays(
  currentLocation: Location,
  targetLocation: Location,
  deviceOrientation: DeviceOrientation,
  screenDimensions: { width: number; height: number },
  currentStep: ARNavigationStep
): AROverlay[] {
  const overlays: AROverlay[] = [];
  
  const distance = calculateDistance(currentLocation, targetLocation);
  const bearing = calculateBearing(currentLocation, targetLocation);
  const relativeAngle = calculateRelativeAngle(bearing, deviceOrientation.heading);
  
  // Main direction arrow
  const position = calculateAROverlayPosition(
    relativeAngle,
    distance,
    deviceOrientation.pitch,
    screenDimensions.width,
    screenDimensions.height
  );
  
  overlays.push({
    type: "arrow",
    position: { x: position.x, y: position.y },
    rotation: relativeAngle,
    scale: position.scale,
    color: getDirectionColor(currentStep.direction),
    label: currentStep.instruction,
  });
  
  // Destination marker (if close enough)
  if (distance < 50) {
    overlays.push({
      type: "destination",
      position: { x: position.x, y: position.y },
      rotation: 0,
      scale: position.scale * 1.5,
      color: "#22C55E",
      label: "目的地",
    });
  }
  
  return overlays;
}

/**
 * AR Navigation Session Manager
 */
export class ARNavigationSession {
  private steps: ARNavigationStep[] = [];
  private waypoints: Location[] = [];
  private currentStepIndex: number = 0;
  private isActive: boolean = false;
  private onStepChange?: (step: ARNavigationStep, index: number) => void;
  private onArrival?: () => void;
  private onError?: (error: Error) => void;
  private onOffRoute?: (deviation: { distance: number; action: string }) => void;
  private lastKnownLocation?: Location;

  constructor(options: {
    onStepChange?: (step: ARNavigationStep, index: number) => void;
    onArrival?: () => void;
    onError?: (error: Error) => void;
    onOffRoute?: (deviation: { distance: number; action: string }) => void;
  }) {
    this.onStepChange = options.onStepChange;
    this.onArrival = options.onArrival;
    this.onError = options.onError;
    this.onOffRoute = options.onOffRoute;
  }

  /**
   * Start navigation with given steps and waypoints
   */
  start(steps: ARNavigationStep[], waypoints?: Location[]): void {
    if (steps.length === 0) {
      this.onError?.(new Error("No navigation steps provided"));
      return;
    }
    
    this.steps = steps;
    this.waypoints = waypoints ?? [];
    this.currentStepIndex = 0;
    this.isActive = true;
    
    this.onStepChange?.(this.steps[0], 0);
  }
  
  /**
   * Set waypoints separately (useful when fetching route data)
   */
  setWaypoints(waypoints: Location[]): void {
    this.waypoints = waypoints;
  }

  /**
   * Update current position and check for step advancement
   */
  updatePosition(currentLocation: Location): void {
    if (!this.isActive || this.steps.length === 0) return;
    
    const currentStep = this.steps[this.currentStepIndex];
    
    // Check if we've reached the waypoint for the current step
    if (this.checkStepCompletion(currentLocation, currentStep)) {
      this.nextStep();
    }
  }
  
  /**
   * Check if current step is completed based on location
   */
  private checkStepCompletion(
    currentLocation: Location,
    step: ARNavigationStep
  ): boolean {
    // Get the target location for this step from waypoints
    const targetWaypoint = this.waypoints[this.currentStepIndex];
    if (!targetWaypoint) return false;
    
    const distance = calculateDistance(currentLocation, targetWaypoint);
    
    // Dynamic threshold based on step type
    const threshold = this.getCompletionThreshold(step);
    
    // Check distance threshold
    if (distance > threshold) return false;
    
    // For floor changes, verify floor if available
    if (step.floor !== undefined && currentLocation.floor !== undefined) {
      if (currentLocation.floor !== step.floor) return false;
    }
    
    return true;
  }
  
  /**
   * Get distance threshold for step completion based on step type
   */
  private getCompletionThreshold(step: ARNavigationStep): number {
    // Different thresholds for different step types
    switch (step.direction) {
      case "destination":
        return 5; // 5 meters for destination
      case "up_stairs":
      case "down_stairs":
      case "elevator_up":
      case "elevator_down":
        return 8; // 8 meters for vertical transitions
      case "u_turn":
        return 3; // 3 meters for u-turns (need more precision)
      default:
        return 10; // 10 meters for normal waypoints
    }
  }
  
  /**
   * Check if user has deviated from the route
   */
  checkRouteDeviation(currentLocation: Location): {
    isOffRoute: boolean;
    deviationDistance: number;
    suggestedAction: "continue" | "recalculate" | "return";
  } {
    if (!this.isActive || this.waypoints.length === 0) {
      return { isOffRoute: false, deviationDistance: 0, suggestedAction: "continue" };
    }
    
    // Find the closest point on the route
    let minDistance = Infinity;
    
    for (const waypoint of this.waypoints) {
      const distance = calculateDistance(currentLocation, waypoint);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    
    // Determine if off route and suggest action
    const OFF_ROUTE_THRESHOLD = 50; // meters
    const RECALCULATE_THRESHOLD = 100; // meters
    
    if (minDistance > RECALCULATE_THRESHOLD) {
      return {
        isOffRoute: true,
        deviationDistance: minDistance,
        suggestedAction: "recalculate",
      };
    } else if (minDistance > OFF_ROUTE_THRESHOLD) {
      return {
        isOffRoute: true,
        deviationDistance: minDistance,
        suggestedAction: "return",
      };
    }
    
    return {
      isOffRoute: false,
      deviationDistance: minDistance,
      suggestedAction: "continue",
    };
  }
  
  /**
   * Calculate estimated time of arrival
   */
  calculateETA(
    currentLocation: Location,
    walkingSpeedMps: number = 1.4 // Average walking speed ~5 km/h
  ): {
    remainingDistance: number;
    estimatedSeconds: number;
    estimatedMinutes: number;
  } {
    if (!this.isActive || this.waypoints.length === 0) {
      return { remainingDistance: 0, estimatedSeconds: 0, estimatedMinutes: 0 };
    }
    
    // Calculate remaining distance from current position
    let remainingDistance = 0;
    
    // Distance from current position to next waypoint
    if (this.currentStepIndex < this.waypoints.length) {
      const nextWaypoint = this.waypoints[this.currentStepIndex];
      remainingDistance += calculateDistance(currentLocation, nextWaypoint);
    }
    
    // Add distances for remaining waypoints
    for (let i = this.currentStepIndex; i < this.waypoints.length - 1; i++) {
      remainingDistance += calculateDistance(
        this.waypoints[i],
        this.waypoints[i + 1]
      );
    }
    
    // Add extra time for floor changes
    const floorChanges = this.steps
      .slice(this.currentStepIndex)
      .filter(s => 
        s.direction === "up_stairs" || 
        s.direction === "down_stairs" ||
        s.direction === "elevator_up" ||
        s.direction === "elevator_down"
      ).length;
    
    const estimatedSeconds = 
      (remainingDistance / walkingSpeedMps) + 
      (floorChanges * 30); // 30 seconds per floor change
    
    return {
      remainingDistance: Math.round(remainingDistance),
      estimatedSeconds: Math.round(estimatedSeconds),
      estimatedMinutes: Math.round(estimatedSeconds / 60),
    };
  }

  /**
   * Manually advance to next step
   */
  nextStep(): void {
    if (!this.isActive) return;
    
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
      this.onStepChange?.(this.steps[this.currentStepIndex], this.currentStepIndex);
    } else {
      this.arrive();
    }
  }

  /**
   * Go back to previous step
   */
  previousStep(): void {
    if (!this.isActive || this.currentStepIndex === 0) return;
    
    this.currentStepIndex--;
    this.onStepChange?.(this.steps[this.currentStepIndex], this.currentStepIndex);
  }

  /**
   * Mark as arrived
   */
  arrive(): void {
    this.isActive = false;
    this.onArrival?.();
  }

  /**
   * Stop navigation
   */
  stop(): void {
    this.isActive = false;
    this.steps = [];
    this.currentStepIndex = 0;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isActive: this.isActive,
      currentStep: this.steps[this.currentStepIndex],
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      progress: this.steps.length > 0 
        ? this.currentStepIndex / (this.steps.length - 1) 
        : 0,
      lastKnownLocation: this.lastKnownLocation,
    };
  }
  
  /**
   * Get remaining steps
   */
  getRemainingSteps(): ARNavigationStep[] {
    return this.steps.slice(this.currentStepIndex);
  }
  
  /**
   * Get completed steps
   */
  getCompletedSteps(): ARNavigationStep[] {
    return this.steps.slice(0, this.currentStepIndex);
  }
  
  /**
   * Check if navigation is near completion
   */
  isNearDestination(): boolean {
    return this.currentStepIndex >= this.steps.length - 2;
  }
}

/**
 * Create mock navigation steps for testing
 */
export function createMockNavigationSteps(
  destination: string
): ARNavigationStep[] {
  return [
    {
      id: "1",
      instruction: "直走約 50 公尺",
      distance: 50,
      direction: "straight",
      bearing: 0,
      landmark: "穿過中央走廊",
    },
    {
      id: "2",
      instruction: "右轉",
      distance: 0,
      direction: "right",
      bearing: 90,
      landmark: "在飲水機處",
    },
    {
      id: "3",
      instruction: "直走約 30 公尺",
      distance: 30,
      direction: "straight",
      bearing: 90,
    },
    {
      id: "4",
      instruction: "左轉上樓梯",
      distance: 0,
      direction: "up_stairs",
      bearing: 0,
      landmark: "使用樓梯",
      floor: 2,
    },
    {
      id: "5",
      instruction: "直走約 20 公尺",
      distance: 20,
      direction: "straight",
      bearing: 0,
    },
    {
      id: "6",
      instruction: `抵達${destination}`,
      distance: 0,
      direction: "destination",
      bearing: 0,
      landmark: `${destination}在右手邊`,
    },
  ];
}

/**
 * Check if device supports AR navigation
 */
export function isARNavigationSupported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

/**
 * AR Capabilities state
 */
let cachedCapabilities: {
  hasCamera: boolean;
  hasCompass: boolean;
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
  isARKitSupported: boolean;
  isARCoreSupported: boolean;
} | null = null;

/**
 * Get AR navigation capabilities
 * Returns cached values or defaults
 */
export function getARCapabilities(): {
  hasCamera: boolean;
  hasCompass: boolean;
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
  isARKitSupported: boolean;
  isARCoreSupported: boolean;
} {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }
  
  return {
    hasCamera: true,
    hasCompass: true,
    hasAccelerometer: true,
    hasGyroscope: true,
    isARKitSupported: Platform.OS === "ios",
    isARCoreSupported: Platform.OS === "android",
  };
}

/**
 * Update AR capabilities after checking sensors
 * Call this after checking actual device capabilities
 */
export function updateARCapabilities(capabilities: Partial<{
  hasCamera: boolean;
  hasCompass: boolean;
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
}>): void {
  cachedCapabilities = {
    ...getARCapabilities(),
    ...capabilities,
  };
}

/**
 * Path finding utilities for indoor navigation
 */
export interface NavigationNode {
  id: string;
  location: Location;
  connectedTo: string[];
  type: "waypoint" | "junction" | "stairs" | "elevator" | "entrance" | "destination";
  floor: number;
  accessible?: boolean;
}

export interface NavigationGraph {
  nodes: Map<string, NavigationNode>;
  edges: Map<string, { from: string; to: string; distance: number; accessible: boolean }>;
}

export function calculateRouteDistance(route: Location[]): number {
  if (route.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    total += calculateDistance(route[i], route[i + 1]);
  }
  return total;
}

function lineDistanceMeters(point: Location, start: Location, end: Location): number {
  const lat0 = ((start.latitude + end.latitude + point.latitude) / 3) * DEG_TO_RAD;
  const px = point.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
  const py = point.latitude * DEG_TO_RAD * EARTH_RADIUS_M;
  const sx = start.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
  const sy = start.latitude * DEG_TO_RAD * EARTH_RADIUS_M;
  const ex = end.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
  const ey = end.latitude * DEG_TO_RAD * EARTH_RADIUS_M;

  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - sx, py - sy);

  const tRaw = ((px - sx) * dx + (py - sy) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, tRaw));
  const projX = sx + t * dx;
  const projY = sy + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export function buildOutdoorRoute(
  start: Location,
  destination: Location,
  campusNodes: Location[],
  options?: {
    maxDetourRatio?: number;
    minNodeDistanceMeters?: number;
    lineCorridorMeters?: number;
  }
): Location[] {
  if (campusNodes.length === 0) return [start, destination];

  const maxDetourRatio = options?.maxDetourRatio ?? 1.35;
  const minNodeDistanceMeters = options?.minNodeDistanceMeters ?? 20;
  const lineCorridorMeters = options?.lineCorridorMeters ?? 60;
  const directDistance = calculateDistance(start, destination);

  let bestNode: Location | null = null;
  let bestRouteDistance = directDistance;

  for (const node of campusNodes) {
    const toStart = calculateDistance(start, node);
    const toDestination = calculateDistance(node, destination);

    if (toStart < minNodeDistanceMeters || toDestination < minNodeDistanceMeters) {
      continue;
    }
    const corridorDistance = lineDistanceMeters(node, start, destination);
    if (corridorDistance > lineCorridorMeters) {
      continue;
    }

    const routeDistance = toStart + toDestination;
    if (routeDistance <= directDistance * maxDetourRatio && routeDistance < bestRouteDistance) {
      bestNode = node;
      bestRouteDistance = routeDistance;
    }
  }

  if (!bestNode) return [start, destination];
  return [start, bestNode, destination];
}

export function getRouteProgress(
  current: Location,
  route: Location[]
): {
  snappedLocation: Location;
  deviationDistance: number;
  remainingDistance: number;
  nextTarget: Location;
  segmentIndex: number;
} {
  if (route.length < 2) {
    return {
      snappedLocation: current,
      deviationDistance: 0,
      remainingDistance: 0,
      nextTarget: route[0] ?? current,
      segmentIndex: 0,
    };
  }

  let bestDistance = Infinity;
  let bestSegmentIndex = 0;
  let bestT = 0;
  let bestSnapped: Location = route[0];

  for (let i = 0; i < route.length - 1; i += 1) {
    const start = route[i];
    const end = route[i + 1];
    const lat0 = ((start.latitude + end.latitude + current.latitude) / 3) * DEG_TO_RAD;

    const px = current.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
    const py = current.latitude * DEG_TO_RAD * EARTH_RADIUS_M;
    const sx = start.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
    const sy = start.latitude * DEG_TO_RAD * EARTH_RADIUS_M;
    const ex = end.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_M;
    const ey = end.latitude * DEG_TO_RAD * EARTH_RADIUS_M;

    const dx = ex - sx;
    const dy = ey - sy;
    const lenSq = dx * dx + dy * dy;
    const tRaw = lenSq === 0 ? 0 : ((px - sx) * dx + (py - sy) * dy) / lenSq;
    const t = Math.max(0, Math.min(1, tRaw));
    const projX = sx + t * dx;
    const projY = sy + t * dy;
    const dist = Math.hypot(px - projX, py - projY);

    if (dist < bestDistance) {
      bestDistance = dist;
      bestSegmentIndex = i;
      bestT = t;

      const snappedLat = (projY / EARTH_RADIUS_M) * RAD_TO_DEG;
      const snappedLng = ((projX / EARTH_RADIUS_M) * RAD_TO_DEG) / Math.cos(lat0);
      bestSnapped = { latitude: snappedLat, longitude: snappedLng };
    }
  }

  let remaining = 0;
  const segmentEnd = route[bestSegmentIndex + 1];
  remaining += calculateDistance(bestSnapped, segmentEnd);
  for (let i = bestSegmentIndex + 1; i < route.length - 1; i += 1) {
    remaining += calculateDistance(route[i], route[i + 1]);
  }

  const nextTarget = bestT >= 0.9
    ? route[Math.min(bestSegmentIndex + 2, route.length - 1)]
    : segmentEnd;

  return {
    snappedLocation: bestSnapped,
    deviationDistance: bestDistance,
    remainingDistance: remaining,
    nextTarget,
    segmentIndex: bestSegmentIndex,
  };
}

/**
 * Find shortest path using Dijkstra's algorithm
 */
export function findShortestPath(
  graph: NavigationGraph,
  startId: string,
  endId: string,
  requireAccessible: boolean = false
): string[] | null {
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();
  
  for (const nodeId of graph.nodes.keys()) {
    distances.set(nodeId, Infinity);
    previous.set(nodeId, null);
    unvisited.add(nodeId);
  }
  distances.set(startId, 0);
  
  while (unvisited.size > 0) {
    let minDistance = Infinity;
    let current: string | null = null;
    
    for (const nodeId of unvisited) {
      const dist = distances.get(nodeId) ?? Infinity;
      if (dist < minDistance) {
        minDistance = dist;
        current = nodeId;
      }
    }
    
    if (current === null || minDistance === Infinity) break;
    if (current === endId) break;
    
    unvisited.delete(current);
    
    const node = graph.nodes.get(current);
    if (!node) continue;
    
    for (const neighborId of node.connectedTo) {
      if (!unvisited.has(neighborId)) continue;
      
      const edgeKey = `${current}-${neighborId}`;
      const reverseEdgeKey = `${neighborId}-${current}`;
      const edge = graph.edges.get(edgeKey) ?? graph.edges.get(reverseEdgeKey);
      
      if (!edge) continue;
      if (requireAccessible && !edge.accessible) continue;
      
      const newDist = (distances.get(current) ?? Infinity) + edge.distance;
      if (newDist < (distances.get(neighborId) ?? Infinity)) {
        distances.set(neighborId, newDist);
        previous.set(neighborId, current);
      }
    }
  }
  
  if (previous.get(endId) === null && startId !== endId) {
    return null;
  }
  
  const path: string[] = [];
  let current: string | null = endId;
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current) ?? null;
  }
  
  return path;
}

/**
 * Convert path to navigation steps
 */
export function pathToNavigationSteps(
  graph: NavigationGraph,
  path: string[]
): ARNavigationStep[] {
  const steps: ARNavigationStep[] = [];
  
  for (let i = 0; i < path.length - 1; i++) {
    const currentNode = graph.nodes.get(path[i]);
    const nextNode = graph.nodes.get(path[i + 1]);
    
    if (!currentNode || !nextNode) continue;
    
    const distance = calculateDistance(currentNode.location, nextNode.location);
    const bearing = calculateBearing(currentNode.location, nextNode.location);
    
    let direction: DirectionType = "straight";
    let instruction = "";
    
    if (i > 0) {
      const prevNode = graph.nodes.get(path[i - 1]);
      if (prevNode) {
        const prevBearing = calculateBearing(prevNode.location, currentNode.location);
        const turnAngle = calculateRelativeAngle(bearing, prevBearing);
        direction = getDirectionType(turnAngle);
      }
    }
    
    if (currentNode.floor !== nextNode.floor) {
      if (nextNode.type === "stairs" || currentNode.type === "stairs") {
        direction = nextNode.floor > currentNode.floor ? "up_stairs" : "down_stairs";
      } else if (nextNode.type === "elevator" || currentNode.type === "elevator") {
        direction = nextNode.floor > currentNode.floor ? "elevator_up" : "elevator_down";
      }
    }
    
    instruction = getDirectionInstruction(direction, Math.round(distance));
    
    steps.push({
      id: `step_${i}`,
      instruction,
      distance: Math.round(distance),
      direction,
      bearing,
      floor: nextNode.floor,
      isIndoor: true,
    });
  }
  
  const lastNode = graph.nodes.get(path[path.length - 1]);
  if (lastNode) {
    steps.push({
      id: `step_${path.length - 1}`,
      instruction: "抵達目的地",
      distance: 0,
      direction: "destination",
      bearing: 0,
      floor: lastNode.floor,
      isIndoor: true,
    });
  }
  
  return steps;
}

/**
 * Voice guidance for navigation
 */
export interface VoiceGuidanceConfig {
  enabled: boolean;
  language: string;
  rate: number;
  pitch: number;
  announceDistance: number[];
}

const defaultVoiceConfig: VoiceGuidanceConfig = {
  enabled: true,
  language: "zh-TW",
  rate: 1.0,
  pitch: 1.0,
  announceDistance: [50, 20, 10, 5],
};

/**
 * Generate voice guidance text for a step
 */
export function generateVoiceGuidance(
  step: ARNavigationStep,
  distanceToStep: number,
  config: VoiceGuidanceConfig = defaultVoiceConfig
): string | null {
  if (!config.enabled) return null;
  
  if (step.direction === "destination") {
    if (distanceToStep <= 5) {
      return "您已抵達目的地";
    } else if (distanceToStep <= 10) {
      return "目的地就在前方";
    }
    return null;
  }
  
  const nearestThreshold = config.announceDistance.find(d => distanceToStep <= d + 2 && distanceToStep >= d - 2);
  if (nearestThreshold === undefined) return null;
  
  const directionTexts: Record<DirectionType, string> = {
    straight: "繼續直走",
    slight_left: "稍微向左",
    left: "左轉",
    sharp_left: "大幅度左轉",
    slight_right: "稍微向右",
    right: "右轉",
    sharp_right: "大幅度右轉",
    u_turn: "迴轉",
    up_stairs: "上樓梯",
    down_stairs: "下樓梯",
    elevator_up: "搭電梯上樓",
    elevator_down: "搭電梯下樓",
    destination: "抵達目的地",
  };
  
  const text = directionTexts[step.direction];
  
  if (nearestThreshold === 50) {
    return `${nearestThreshold} 公尺後 ${text}`;
  } else if (nearestThreshold === 20) {
    return `即將 ${text}`;
  } else if (nearestThreshold <= 10) {
    return `現在 ${text}`;
  }
  
  return null;
}

/**
 * Calibration utilities for compass
 */
export interface CalibrationState {
  isCalibrated: boolean;
  accuracy: "low" | "medium" | "high";
  lastCalibrated: Date | null;
  magneticDeclination: number;
}

let calibrationState: CalibrationState = {
  isCalibrated: false,
  accuracy: "low",
  lastCalibrated: null,
  magneticDeclination: 0,
};

export function getCalibrationState(): CalibrationState {
  return { ...calibrationState };
}

export function updateCalibration(updates: Partial<CalibrationState>): void {
  calibrationState = { ...calibrationState, ...updates };
}

/**
 * Apply magnetic declination correction to heading
 */
export function correctHeading(magneticHeading: number, declination?: number): number {
  const dec = declination ?? calibrationState.magneticDeclination;
  return (magneticHeading + dec + 360) % 360;
}

/**
 * Smooth heading values to reduce jitter
 */
export class HeadingSmoother {
  private readings: number[] = [];
  private readonly maxReadings: number;
  
  constructor(maxReadings: number = 10) {
    this.maxReadings = maxReadings;
  }
  
  addReading(heading: number): number {
    this.readings.push(heading);
    if (this.readings.length > this.maxReadings) {
      this.readings.shift();
    }
    return this.getSmoothedHeading();
  }
  
  getSmoothedHeading(): number {
    if (this.readings.length === 0) return 0;
    
    let sinSum = 0;
    let cosSum = 0;
    
    for (const heading of this.readings) {
      sinSum += Math.sin(heading * DEG_TO_RAD);
      cosSum += Math.cos(heading * DEG_TO_RAD);
    }
    
    let avgHeading = Math.atan2(sinSum, cosSum) * RAD_TO_DEG;
    if (avgHeading < 0) avgHeading += 360;
    
    return avgHeading;
  }
  
  reset(): void {
    this.readings = [];
  }
}
