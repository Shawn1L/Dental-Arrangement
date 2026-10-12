"""Curve-guided narrow-band fields and affine source-face partition."""
import numpy as np
import trimesh
from scipy.sparse import coo_matrix, diags
from scipy.sparse.csgraph import dijkstra
from scipy.sparse.linalg import splu

def guided_fields(vertices, faces, labels, curves, width=.65, smoothness=.35, guide_weight=8.):
    ids = np.unique(labels)
    original = (labels[:, None] == ids).astype(float)
    edges = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    lengths = np.linalg.norm(vertices[edges[:, 0]] - vertices[edges[:, 1]], axis=1)
    if np.any(lengths <= 1e-12):
        raise ValueError('Zero-length mesh edge; repair input topology before refinement.')
    rows = np.r_[edges[:, 0], edges[:, 1]]
    cols = np.r_[edges[:, 1], edges[:, 0]]
    graph = coo_matrix((np.tile(lengths, 2), (rows, cols)), shape=(len(vertices),)*2).tocsr()
    seeds = np.unique(edges[labels[edges[:, 0]] != labels[edges[:, 1]]])
    if not len(seeds):
        return ids, original, np.zeros(len(vertices), dtype=bool), {'guide_samples': 0}
    distance = dijkstra(graph, directed=False, indices=seeds, min_only=True, limit=width)
    band = distance <= width

    cr, cc, cv, targets = [], [], [], []
    for curve in curves:
        # Arc-length weighting prevents dense sampling from dominating the fit.
        points = np.asarray(curve['smooth'])
        arc = np.linalg.norm(np.diff(points, axis=0), axis=1)
        weights = np.r_[arc[0]/2, (arc[:-1]+arc[1:])/2, arc[-1]/2] if len(arc) else np.ones(len(points))
        for face_id, bary, weight in zip(curve['smooth_face_ids'], curve['smooth_barycentric'], weights):
            if weight <= 1e-12:
                continue
            row = len(targets)
            scale = np.sqrt(weight / .25)
            f = faces[face_id]
            band[f] = True
            cr.extend([row]*3); cc.extend(f); cv.extend(np.asarray(bary)*scale)
            target = np.zeros(len(ids))
            for label in curve['labels']:
                target[np.flatnonzero(ids == label)[0]] = .5*scale
            targets.append(target)
    constraints = coo_matrix((cv, (cr, cc)), shape=(len(targets), len(vertices))).tocsr()
    weights = np.median(lengths) / lengths
    adjacency = coo_matrix((np.tile(weights, 2), (rows, cols)), shape=graph.shape).tocsr()
    laplacian = diags(np.asarray(adjacency.sum(axis=1)).ravel()) - adjacency
    active = np.flatnonzero(band)
    lb = laplacian[active][:, active]
    cb = constraints[:, active]
    # Solve for increments, fixing every vertex outside the band exactly.
    matrix = (diags(np.ones(len(active))) + smoothness*lb + guide_weight*(cb.T @ cb)).tocsc()
    rhs = -smoothness*(laplacian @ original)[active]
    if len(targets):
        rhs += guide_weight*(cb.T @ (np.asarray(targets) - constraints @ original))
    fields = original.copy()
    fields[active] += splu(matrix).solve(np.asarray(rhs))
    fields[active] = np.maximum(fields[active], 0)
    fields[active] /= fields[active].sum(axis=1, keepdims=True)
    residual = constraints @ fields - np.asarray(targets).reshape(-1,len(ids))
    return ids, fields, band, {'guide_samples': len(targets), 'guide_rms_field_residual': float(np.sqrt(np.mean(residual**2))) if len(targets) else 0}


def clip_polygon(polygon, values, tolerance=1e-12):
    """Clip a barycentric polygon against an affine halfplane values >= 0."""
    result = []
    for a, b in zip(polygon, np.roll(polygon, -1, axis=0)):
        da, db = float(a @ values), float(b @ values)
        if da >= -tolerance:
            result.append(a)
        if (da > tolerance and db < -tolerance) or (da < -tolerance and db > tolerance):
            result.append(a + (b-a)*(da/(da-db)))
        elif da < -tolerance and abs(db) <= tolerance:
            result.append(b)
    clean = []
    for p in result:
        if not clean or np.linalg.norm(p-clean[-1]) > 1e-10:
            clean.append(p)
    if len(clean)>1 and np.linalg.norm(clean[0]-clean[-1]) < 1e-10:
        clean.pop()
    return np.asarray(clean).reshape(-1, 3)


def face_regions(values):
    # Every label that is nonzero at a corner can potentially own the interior.
    candidates = np.flatnonzero(np.max(values, axis=0) > 1e-10)
    result = []
    for label in candidates:
        polygon = np.eye(3)
        for other in candidates:
            if label == other:
                continue
            difference = values[:, label] - values[:, other]
            if np.max(np.abs(difference)) < 1e-12:
                if label > other:
                    polygon = np.empty((0, 3)); break
                continue
            polygon = clip_polygon(polygon, difference)
            if len(polygon)<3:
                break
        if len(polygon)>=3:
            result.append((label, polygon))
    return result


def partition(vertices, faces, ids, fields):
    source = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    normals = np.asarray(source.vertex_normals)
    positions, output_normals, face_labels, source_faces, barycentrics = [], [], [], [], []
    boundary_segments = []
    original_area = np.linalg.norm(np.cross(vertices[faces[:, 1]]-vertices[faces[:, 0]], vertices[faces[:, 2]]-vertices[faces[:, 0]]), axis=1)/2
    # Most faces have one affine winner everywhere. Process them in one batch.
    winners = np.argmax(fields, axis=1)[faces]
    homogeneous = np.all(winners == winners[:, :1], axis=1)
    pure_ids = np.flatnonzero(homogeneous)
    pure_labels = ids[winners[pure_ids, 0]]
    if len(pure_ids):
        positions.append(vertices[faces[pure_ids]])
        output_normals.append(normals[faces[pure_ids]])
        barycentrics.append(np.broadcast_to(np.eye(3), (len(pure_ids),3,3)))
        face_labels.extend(pure_labels); source_faces.extend(pure_ids)
    max_relative_error, total_area, refined_faces = 0., float(original_area[pure_ids].sum()), 0
    areas = {str(int(label)): 0. for label in ids}
    for label in ids:
        areas[str(int(label))] = float(original_area[pure_ids[pure_labels == label]].sum())
    for fi in np.flatnonzero(~homogeneous):
        face = faces[fi]
        values = fields[face]
        regions = face_regions(values)
        area_sum = 0.
        pieces = 0
        for label, polygon in regions:
            for j in range(1, len(polygon)-1):
                bary = polygon[[0, j, j+1]]
                points = bary @ vertices[face]
                area = np.linalg.norm(np.cross(points[1]-points[0], points[2]-points[0]))/2
                if area <= original_area[fi]*1e-12:
                    continue
                n = bary @ normals[face]
                n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-30)
                positions.append(points[None]); output_normals.append(n[None]); barycentrics.append(bary[None])
                face_labels.append(ids[label]); source_faces.append(fi)
                areas[str(int(ids[label]))] += float(area)
                area_sum += area; pieces += 1
            for a, b in zip(polygon, np.roll(polygon, -1, axis=0)):
                # Source-face exterior edges are not interface segments.
                if np.any((np.abs(a)<1e-9) & (np.abs(b)<1e-9)):
                    continue
                midpoint = (a+b)/2 @ values
                ties = np.flatnonzero(np.abs(midpoint-midpoint[label])<1e-8)
                other = next((int(x) for x in ties if x != label), None)
                if other is not None and label < other and np.linalg.norm(a-b)>1e-10:
                    boundary_segments.append(np.stack([a,b]) @ vertices[face])
        error = abs(area_sum-original_area[fi])/max(original_area[fi], 1e-30)
        max_relative_error = max(max_relative_error, error)
        if error > 1e-7:
            raise ValueError(f'Face {fi} partition failed area coverage: {error}')
        total_area += area_sum
        refined_faces += pieces > 1
    positions = np.concatenate(positions)
    source_faces = np.asarray(source_faces, dtype=np.uint32)
    barycentrics = np.concatenate(barycentrics)
    reconstruction = np.einsum('nij,njk->nik', barycentrics, vertices[faces[source_faces]])
    report = {'output_faces': len(face_labels), 'split_source_faces': refined_faces,
              'max_face_area_relative_error': float(max_relative_error), 'surface_area': total_area,
              'max_source_reconstruction_error': float(np.max(np.abs(positions-reconstruction))),
              'tooth_and_gum_areas': areas}
    return positions, np.concatenate(output_normals), np.asarray(face_labels, dtype=np.uint16), source_faces, barycentrics, np.asarray(boundary_segments).reshape(-1,2,3), report


