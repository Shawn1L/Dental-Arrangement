"""In-memory strong refinement. No remote inference or patient-file IO."""
import json
import struct
import time
import numpy as np
import trimesh
from .curves import clean_enclosed_islands, extract_interfaces, trace_chains, smooth_chain
from .partition import guided_fields, partition

STRONG = dict(width=1.2, smoothness=6., guide_weight=16., curve_iterations=48,
              curve_cap=.55, island_area=1.)


def decode_mesh(data, with_report=False):
    if len(data) < 12:
        raise ValueError('修正数据头不完整')
    version, nv, nf = struct.unpack_from('<III', data)
    if version != 1 or not nv or not nf or len(data) != 12 + nv*14 + nf*12:
        raise ValueError('修正数据版本或数量不匹配')
    vertices = np.frombuffer(data, '<f4', nv*3, 12).reshape(-1, 3).astype(float)
    faces = np.frombuffer(data, '<u4', nf*3, 12+nv*12).reshape(-1, 3)
    labels = np.frombuffer(data, '<u2', nv, 12+nv*12+nf*12)
    if not np.isfinite(vertices).all() or faces.max() >= nv:
        raise ValueError('模型坐标或面片索引无效')
    valid = (labels == 0) | ((labels >= 11) & (labels <= 48) & (labels % 10 >= 1) & (labels % 10 <= 8))
    if not valid.all() or not np.any(labels != 0):
        raise ValueError('需要 FDI 牙齿标签，牙龈标签为 0')
    tri = vertices[faces]
    edges = tri[:, [1, 2, 0]] - tri
    # Match the field solver's minimum edge length as well as zero-area faces.
    usable = (np.linalg.norm(np.cross(edges[:, 0], -edges[:, 2]), axis=1) > 1e-15)
    usable &= np.all(np.linalg.norm(edges, axis=2) > 1e-12, axis=1)
    kept_faces = faces[usable]
    if not len(kept_faces):
        raise ValueError('过滤退化面片后没有有效面片，请修复模型后重试')
    used, inverse = np.unique(kept_faces, return_inverse=True)
    kept_labels = labels[used]
    missing_teeth = sorted(set(labels[labels != 0].tolist()) - set(kept_labels.tolist()))
    if missing_teeth:
        raise ValueError('过滤退化面片后牙号丢失：' + '、'.join(map(str, missing_teeth)) + '，请修复模型后重试')
    report = dict(input_faces=int(nf), filtered_degenerate_faces=int(nf-len(kept_faces)),
                  input_vertices=int(nv), removed_unreferenced_vertices=int(nv-len(used)))
    decoded = vertices[used], inverse.reshape(-1, 3), kept_labels
    return (*decoded, report) if with_report else decoded


def refine(vertices, faces, labels):
    start = time.perf_counter()
    original_ids = set(labels.tolist())
    labels, changes = clean_enclosed_islands(vertices, faces, labels, STRONG['island_area'])
    if set(labels.tolist()) != original_ids:
        raise ValueError('孤岛清理会丢失标签，已阻止展示')
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    points, _, pairs = extract_interfaces(vertices, faces, labels)
    curves = []
    for pair, edges in sorted(pairs.items()):
        chains, _ = trace_chains(edges)
        for chain in chains:
            smooth, face_ids, bary, _ = smooth_chain(mesh, points[chain], chain[0] == chain[-1],
                                                    STRONG['curve_iterations'], STRONG['curve_cap'])
            curves.append(dict(labels=pair, smooth=smooth, smooth_face_ids=face_ids, smooth_barycentric=bary))
    ids, fields, band, field_report = guided_fields(vertices, faces, labels, curves,
        STRONG['width'], STRONG['smoothness'], STRONG['guide_weight'])
    result = partition(vertices, faces, ids, fields)
    positions, normals, region_labels, _, _, _, report = result
    if not np.isfinite(positions).all() or not np.isfinite(normals).all() or report['max_source_reconstruction_error'] > 1e-8:
        raise ValueError('修正几何未通过源面重建检查')
    if set(region_labels.tolist()) != original_ids:
        raise ValueError('强平滑丢失标签，已阻止展示')
    if not np.array_equal(fields[~band], (labels[:, None] == ids)[~band]):
        raise ValueError('修正超出边界带')
    report.update(field_report, preset='strong', settings=STRONG, source_faces=len(faces),
                  cleaned_components=len(changes), elapsed_seconds=time.perf_counter()-start)
    return positions, normals, region_labels, report


def process(data):
    vertices, faces, input_labels, cleanup_report = decode_mesh(data, with_report=True)
    positions, normals, labels, report = refine(vertices, faces, input_labels)
    report.update(cleanup_report)
    header = json.dumps(dict(version=1, faces=len(labels), report=report), ensure_ascii=False).encode()
    header += b' ' * (-len(header) % 4)
    return (struct.pack('<I', len(header)) + header + positions.astype('<f4').tobytes()
            + normals.astype('<f4').tobytes() + labels.astype('<u2').tobytes())
