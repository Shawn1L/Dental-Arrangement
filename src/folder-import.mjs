// Pair only original single-jaw surfaces with their adjacent label files.
export function discoverCases(files) {
  const pathOf = file => (file.webkitRelativePath || file.name).replaceAll('\\', '/');
  const paths = new Map(files.map(file => [pathOf(file).toLowerCase(), file]));
  const cases = new Map();
  for (const file of files) {
    const path = pathOf(file);
    const match = path.match(/^(.*\/)?([^/]+)_(upper|lower)\.(obj|stl)$/i);
    if (!match) continue;
    const directory = (match[1] || '').replace(/(?:obj|stl)\/$/i, '');
    const key = directory + match[2];
    const jaw = match[3].toLowerCase();
    const result = paths.get(path.replace(/\.(obj|stl)$/i, '.json').toLowerCase());
    if (!cases.has(key)) cases.set(key, { id: key, name: match[2], entries: [] });
    const entries = cases.get(key).entries;
    const previous = entries.findIndex(entry => entry.jaw === jaw);
    const candidate = { file, result, jaw };
    // A complete pair wins over a missing result; OBJ wins between equal pairs.
    if (previous < 0) entries.push(candidate);
    else {
      const old = entries[previous];
      if ((!!result && !old.result) || (!!result === !!old.result && /\.obj$/i.test(file.name))) entries[previous] = candidate;
    }
  }
  return [...cases.values()].sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ ...item, entries: item.entries.sort((a, b) => a.jaw === b.jaw ? 0 : a.jaw === 'upper' ? -1 : 1) }));
}
