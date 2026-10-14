"""Bake compressed strong-refinement assets for the local preloaded cases.
Run again after changing source models, labels, or the refinement implementation.
"""
import gzip
import hashlib
import json
from pathlib import Path
import struct
import sys
import time
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from refinement.service import process, source_revision


def mesh_payload(path, result):
    vertices, faces = [], []
    for line in path.read_text(encoding='utf-8').splitlines():
        parts = line.split('#')[0].split()
        if not parts:
            continue
        if parts[0] == 'v':
            vertices.append([float(v) for v in parts[1:4]])
        elif parts[0] == 'f':
            ids = [int(v.split('/')[0]) for v in parts[1:]]
            ids = [v - 1 if v > 0 else len(vertices) + v for v in ids]
            faces.extend([[ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1)])
    labels = json.loads(result.read_text(encoding='utf-8'))['labels']
    if len(labels) != len(vertices):
        raise ValueError(f'{path.name}: label count mismatch')
    return (struct.pack('<III', 1, len(vertices), len(faces))
            + np.asarray(vertices, dtype='<f4').tobytes()
            + np.asarray(faces, dtype='<u4').tobytes()
            + np.asarray(labels, dtype='<u2').tobytes())


def main():
    revision = source_revision()
    catalog = json.loads((ROOT / 'src/preloaded-cases.json').read_text(encoding='utf-8'))
    for item in catalog:
        for entry in item['entries']:
            folder = ROOT / 'public/preloaded' / item['id']
            model, labels = folder / entry['model'], folder / entry['result']
            output = folder / (Path(entry['model']).stem + '.refined.bin.gz')
            meta = output.with_suffix('.meta.json')
            fingerprint = hashlib.sha256(model.read_bytes() + labels.read_bytes() + revision.encode()).hexdigest()
            if output.exists() and meta.exists():
                previous = json.loads(meta.read_text(encoding='utf-8'))
                if previous.get('fingerprint') == fingerprint and previous.get('asset_sha256') == hashlib.sha256(output.read_bytes()).hexdigest():
                    print(f'{item["name"]} {entry["jaw"]}: cached', flush=True)
                    continue
            start = time.perf_counter()
            data = process(mesh_payload(model, labels))
            compressed = gzip.compress(data, compresslevel=6, mtime=0)
            temporary = output.with_suffix('.tmp')
            temporary.write_bytes(compressed)
            temporary.replace(output)
            meta.write_text(json.dumps(dict(fingerprint=fingerprint, revision=revision,
                asset_sha256=hashlib.sha256(compressed).hexdigest(), bytes=len(compressed), decoded_bytes=len(data)), indent=2), encoding='utf-8')
            print(f'{item["name"]} {entry["jaw"]}: {time.perf_counter()-start:.1f}s, {len(compressed)/1024/1024:.1f} MiB', flush=True)


if __name__ == '__main__':
    main()
