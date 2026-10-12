"""Surface-projected segmentation interfaces; original coordinates preserved."""
from collections import defaultdict
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

def clean_enclosed_islands(vertices, faces, labels, max_area):
    """Relabel only small components enclosed by exactly one other label.

    Components touching open/nonmanifold edges are protected. Area is the
    sum of per-vertex one-third incident triangle areas, in scan units squared.
    No data-driven anatomical correction is claimed.
    """
    result = labels.copy()
    if max_area <= 0:
        return result, []
    edges, counts = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0, return_counts=True)
    protected = np.zeros(len(vertices), dtype=bool)
    protected[edges[counts != 2].ravel()] = True
    tri = vertices[faces]
    area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 6
    weights = np.bincount(faces.ravel(), weights=np.repeat(area, 3), minlength=len(vertices))
    changes = []
    for pass_id in range(2):
        pending = []
        # All components in a pass use the same label state.
        for label in np.unique(result):
            ids = np.flatnonzero(result == label)
            remap = np.full(len(vertices), -1, dtype=int)
            remap[ids] = np.arange(len(ids))
            selected = np.all(result[edges] == label, axis=1)
            e = remap[edges[selected]]
            graph = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(ids), len(ids))).tocsr()
            n, comp = connected_components(graph, directed=False)
            component_area = np.bincount(comp, weights=weights[ids], minlength=n)
            crossing = edges[np.sum(result[edges] == label, axis=1) == 1]
            if not len(crossing):
                continue
            inside = np.where(result[crossing[:, 0]] == label, crossing[:, 0], crossing[:, 1])
            outside = np.where(result[crossing[:, 0]] == label, crossing[:, 1], crossing[:, 0])
            touching_component = comp[remap[inside]]
            for component in np.flatnonzero(component_area <= max_area):
                part = ids[comp == component]
                if np.any(protected[part]):
                    continue
                neighbor_labels = np.unique(result[outside[touching_component == component]])
                if len(neighbor_labels) == 1:
                    pending.append((part, int(label), int(neighbor_labels[0]), float(component_area[component])))
        if not pending:
            break
        # Avoid simultaneous swaps of two tiny components into each other.
        changing = set(int(x) for part, _, _, _ in pending for x in part)
        for part, before, after, part_area in pending:
            crossing = edges[np.isin(edges[:, 0], part) ^ np.isin(edges[:, 1], part)]
            neighbors = set(int(x) for x in crossing.ravel()) - set(int(x) for x in part)
            if neighbors & changing:
                continue
            result[part] = after
            changes.append({'pass': pass_id, 'vertex_ids': part.tolist(), 'before': before, 'after': after,
                            'area': part_area, 'reason': 'small enclosed single-neighbor-label component'})
    return result, changes


def extract_interfaces(vertices, faces, labels):
    """Barycentric dual partition: edge midpoint and triple-label face center.

    Each unique node carries exact source-face barycentric coordinates. Shared
    label-pair interfaces are stored once, including fixed triple junctions.
    """
    nodes, sources, lookup = [], [], {}
    segments = defaultdict(list)

    def node(key, face_id, bary):
        if key not in lookup:
            lookup[key] = len(nodes)
            nodes.append(np.asarray(bary) @ vertices[faces[face_id]])
            sources.append({"face_id": int(face_id), "barycentric": list(bary)})
        return lookup[key]

    mixed = np.flatnonzero(np.any(labels[faces] != labels[faces[:, :1]], axis=1))
    for face_id in mixed:
        f = faces[face_id]
        lab = labels[f]
        transitions = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if lab[a] == lab[b]:
                continue
            bary = [0.0, 0.0, 0.0]
            bary[a] = bary[b] = 0.5
            key = ("edge", *sorted((int(f[a]), int(f[b]))))
            transitions.append((tuple(sorted((int(lab[a]), int(lab[b])))), node(key, face_id, bary)))
        if len(transitions) == 2:
            pair = transitions[0][0]
            segments[pair].append((transitions[0][1], transitions[1][1]))
        elif len(transitions) == 3:
            center = node(("face", int(face_id)), face_id, [1 / 3] * 3)
            for pair, edge_node in transitions:
                segments[pair].append((edge_node, center))
    return np.asarray(nodes).reshape(-1, 3), sources, segments


def trace_chains(edges):
    """Split at branch/end nodes; never invent connections or discard islands."""
    adjacency = defaultdict(list)
    for i, (a, b) in enumerate(edges):
        adjacency[a].append((b, i))
        adjacency[b].append((a, i))
    visited, chains = set(), []

    def walk(start, edge_id):
        path, current = [start], start
        while edge_id not in visited:
            visited.add(edge_id)
            a, b = edges[edge_id]
            current = b if current == a else a
            path.append(current)
            if current == start or len(adjacency[current]) != 2:
                break
            edge_id = next(i for _, i in adjacency[current] if i not in visited)
        chains.append(path)

    for vertex, incident in adjacency.items():
        if len(incident) != 2:
            for _, edge_id in incident:
                if edge_id not in visited:
                    walk(vertex, edge_id)
    for edge_id, (a, _) in enumerate(edges):
        if edge_id not in visited:
            walk(a, edge_id)
    return chains, {int(k): len(v) for k, v in adjacency.items() if len(v) > 2}


def project(mesh, points):
    """Exact closest points on the original triangles (R-tree broad phase)."""
    if not len(points):
        return points.copy(), np.empty(0, dtype=int), np.empty((0, 3))
    closest, _, face_ids = trimesh.proximity.closest_point(mesh, points)
    bary = trimesh.triangles.points_to_barycentric(mesh.triangles[face_ids], closest)
    return closest, face_ids, bary


def smooth_chain(mesh, raw, closed, iterations, cap):
    # Subdivide on the original piecewise-linear contour before smoothing.
    dense = [raw[0]]
    for a, b in zip(raw[:-1], raw[1:]):
        count = max(1, int(np.ceil(np.linalg.norm(b - a) / 0.25)))
        dense.extend(a + (b - a) * i / count for i in range(1, count + 1))
    anchor = np.asarray(dense[:-1] if closed else dense)
    points = anchor.copy()
    for _ in range(iterations):
        proposal = 0.5 * points + 0.25 * (np.roll(points, 1, axis=0) + np.roll(points, -1, axis=0))
        if not closed:
            proposal[[0, -1]] = anchor[[0, -1]]
        projected, _, _ = project(mesh, proposal)
        # Reject excessive moves rather than clipping off the source surface.
        allowed = np.linalg.norm(projected - anchor, axis=1) <= cap
        points[allowed] = projected[allowed]
    points, face_ids, bary = project(mesh, points)
    if not closed:
        points[[0, -1]] = anchor[[0, -1]]
    if closed:
        points = np.vstack((points, points[0]))
        face_ids = np.r_[face_ids, face_ids[0]]
        bary = np.vstack((bary, bary[0]))
        anchor = np.vstack((anchor, anchor[0]))
    return points, face_ids, bary, float(np.linalg.norm(points - anchor, axis=1).max(initial=0))


