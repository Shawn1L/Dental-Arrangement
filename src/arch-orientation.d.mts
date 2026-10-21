export type ArchFrame = {front:number[];up:number[];right:number[]};
export function sampleSurface(positions:ArrayLike<number>,limit?:number):{points:number[][];normal:number[];total:number}|null;
export function estimateArchFrame(surfaces:{positions:ArrayLike<number>;jaw:string}[]):{frame:ArchFrame|null;reason:string};
