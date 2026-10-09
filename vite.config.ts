import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { port: 5186, strictPort: true }, preview: { port: 4186, strictPort: true }, build: { rollupOptions: { output: { manualChunks: { three: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/loaders/STLLoader.js', 'three/addons/utils/BufferGeometryUtils.js'] } } } } });
