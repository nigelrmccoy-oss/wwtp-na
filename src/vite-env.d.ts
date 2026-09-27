/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_CESIUM_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
