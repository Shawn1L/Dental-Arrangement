import type { Group, Mesh, BufferGeometry, MeshStandardMaterial } from 'three';
export function clearModels(group: Group, models: { mesh: Mesh<BufferGeometry, MeshStandardMaterial> }[]): void;
export function createModelImporter(callbacks: {
  clear: () => void;
  add: (buffer: ArrayBuffer, name: string) => void;
  onStart: () => void;
  onFinish: (added: number) => void;
  onError: (message: string) => void;
}): (files: File[]) => Promise<void>;
