import type { LocalCase } from './folder-import.mjs';
export type PreloadedCase = { id: string; name: string; entries: { jaw: string; model: string; result: string; size: number }[] };
export function createPreloadedCases(catalog: PreloadedCase[], baseUrl: string, request?: typeof fetch): LocalCase[];

export function loadPreloadedRefinement(url: string, signal?: AbortSignal, request?: typeof fetch): Promise<ReturnType<typeof import('./segmentation-refinement.mjs').decodeRefinement>>;
