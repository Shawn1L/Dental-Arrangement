import type { BufferGeometry } from 'three';
export const GUM_COLOR: string;
export function isTooth(id: number): boolean;
export function toothColor(id: number): string;
export type SourceMap = { count: number; indices: Uint32Array };
export type Tooth = { id: number; center: number[] };
export function objVertexMap(buffer: ArrayBuffer): SourceMap;
export function labelGeometry(geometry: BufferGeometry, result: unknown, sourceMap?: SourceMap): Tooth[];
