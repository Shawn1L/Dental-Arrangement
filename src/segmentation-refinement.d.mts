import type { BufferGeometry } from 'three';
type Topology = { vertices: Float32Array; faces: Uint32Array };
export function objTopology(buffer: ArrayBuffer): Topology;
export function expandedGeometry(topology: Topology): BufferGeometry;
export function packRefinement(positions: Float32Array, result: unknown, topology?: Topology): Blob;
export function decodeRefinement(buffer: ArrayBuffer): { geometry: BufferGeometry; teeth: { id:number; center:number[] }[]; report: unknown };
export function refineSegmentation(positions: Float32Array, result: unknown, topology?: Topology, signal?: AbortSignal): Promise<ReturnType<typeof decodeRefinement>>;
