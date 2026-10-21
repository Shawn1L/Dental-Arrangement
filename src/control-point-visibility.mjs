import { Vector2, Vector3 } from 'three';

// Decide visibility at the anchor, then draw its entire editing marker. Testing
// the disc's fragments against the surface cuts circles in half on sloped teeth.
export function isControlPointVisible(raycaster, mesh, camera, anchor, tolerance = .02) {
  const projected = anchor.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) return false;
  raycaster.setFromCamera(new Vector2(projected.x, projected.y), camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit) return true; // An exact silhouette vertex can miss both adjacent faces.
  const distance = new Vector3().subVectors(anchor, raycaster.ray.origin).dot(raycaster.ray.direction);
  return distance <= hit.distance + tolerance;
}
