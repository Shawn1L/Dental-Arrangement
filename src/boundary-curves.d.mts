import type { EditableJaw, BoundaryLoop } from './segmentation-editor.mjs';
export function buildBoundaryCurves(jaw:EditableJaw,entries:{key:number;loop:BoundaryLoop}[],controls:Set<number>,project:(point:number[])=>number[]):{keys:number[];points:number[][]}[];
