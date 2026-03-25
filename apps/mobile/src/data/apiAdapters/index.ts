export type {
  ApiConfig,
  ApiResponse,
  AuthCredentials,
  SchoolApiAdapter,
  AdapterCapabilities,
  RawAnnouncementData,
  RawEventData,
  RawCourseData,
  RawMenuData,
  RawPoiData,
} from "./types";

export {
  normalizeAnnouncement,
  normalizeEvent,
  normalizeCourse,
  normalizeMenuItem,
  normalizePoi,
} from "./types";

export { BaseApiAdapter, type RequestOptions } from "./BaseAdapter";

export { GenericRestAdapter, type GenericRestConfig } from "./GenericRestAdapter";

export {
  registerCustomAdapter,
  registerSchoolConfig,
  getAdapter,
  hasAdapter,
  getAdapterCapabilities,
  clearAdapter,
  clearAllAdapters,
  listRegisteredSchools,
  checkAdapterHealth,
  checkAllAdaptersHealth,
  type AdapterFactory,
  type SchoolApiConfig,
} from "./AdapterRegistry";

export { NCHUAdapter, createNCHUAdapter } from "./NCHUAdapter";

export { PUAdapter, createPUAdapter } from "./PUAdapter";
