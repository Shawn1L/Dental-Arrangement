import type { ImportFile } from './model-import.mjs';
export type LocalEntry = { file: ImportFile; result?: ImportFile; refinementUrl?: string; jaw: 'upper' | 'lower' };
export type LocalCase = { id: string; name: string; entries: LocalEntry[] };
export function discoverCases(files: File[]): LocalCase[];
