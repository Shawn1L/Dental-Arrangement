import * as THREE from 'three';

// Screen-facing reference grid: one minor cell is one model coordinate unit.
// Rendered after the model, matching the reference UI without altering geometry.
export function createReferenceGrid() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      resolution: { value: new THREE.Vector2() },
      spacing: { value: 10 },
      origin: { value: new THREE.Vector2() },
    },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `
      uniform vec2 resolution;
      uniform float spacing;
      uniform vec2 origin;
      float lines(float stepSize) {
        vec2 p = gl_FragCoord.xy - origin;
        vec2 distanceToLine = abs(mod(p + stepSize * 0.5, stepSize) - stepSize * 0.5);
        return 1.0 - smoothstep(0.0, 1.0, min(distanceToLine.x, distanceToLine.y));
      }
      void main() {
        float minor = lines(spacing);
        float major = lines(spacing * 10.0);
        // Fade dense minor lines rather than allowing moire at distant zooms.
        float minorAlpha = minor * 0.14 * smoothstep(3.0, 7.0, spacing);
        gl_FragColor = vec4(mix(vec3(0.48), vec3(0.92,0.48,0.48), major),
          max(minorAlpha, major * 0.28));
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const screenOrigin = new THREE.Vector3();
  return {
    render(renderer: THREE.WebGLRenderer, view: THREE.OrthographicCamera) {
      const size = renderer.getDrawingBufferSize(material.uniforms.resolution.value);
      material.uniforms.spacing.value = size.y * view.zoom / (view.top - view.bottom);
      screenOrigin.set(0, 0, 0).project(view);
      material.uniforms.origin.value.set((screenOrigin.x + 1) * size.x / 2, (screenOrigin.y + 1) * size.y / 2);
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
  };
}
