import { defineConfig } from 'vite';
const proxy = { '/api': { target: process.env.DENTAL_API_TARGET || 'http://127.0.0.1:5187', timeout: 0, proxyTimeout: 0 } };
export default defineConfig({ base: './', server: { port: 5186, strictPort: true, proxy }, preview: { port: 4186, strictPort: true, proxy }, build: { rollupOptions: { output: { manualChunks: { three: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/loaders/STLLoader.js', 'three/addons/utils/BufferGeometryUtils.js'] } } } } });
