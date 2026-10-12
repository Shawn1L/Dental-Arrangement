export type LocalEntry = { file: File; result?: File; jaw: 'upper' | 'lower' };
export type LocalCase = { id: string; name: string; entries: LocalEntry[] };
export function discoverCases(files: File[]): LocalCase[];
