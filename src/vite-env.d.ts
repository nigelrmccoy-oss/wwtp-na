/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_CESIUM_ENABLED?: string;
  readonly VITE_ORTHO_ENABLED?: string;
  readonly VITE_IMAGERY_URL?: string;
  readonly VITE_IMAGERY_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
