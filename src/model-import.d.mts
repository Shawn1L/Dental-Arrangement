import type { Group, Mesh, BufferGeometry, MeshStandardMaterial } from 'three';
export type ImportFile = Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>;
export function clearModels(group: Group, models: { mesh: Mesh<BufferGeometry, MeshStandardMaterial> }[]): void;
export function createModelImporter(callbacks: {
  clear: () => void;
  add: (buffer: ArrayBuffer, name: string, result?: unknown, refinementUrl?: string) => void;
  onStart: () => void;
  onFinish: (added: number) => void;
  onError: (message: string) => void;
}): (files: ImportFile[], companions?: Map<ImportFile, ImportFile | undefined>, refinements?: Map<ImportFile, string | undefined>) => Promise<void>;
