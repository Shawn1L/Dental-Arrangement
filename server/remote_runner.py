"""Executed in the existing customer container; never installed on the server."""
import gzip
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import open3d as o3d
import torch
from scipy.spatial import cKDTree


def run(root, jaw):
    sys.path.insert(0, root)
    from inference_pipelines.inference_pipeline_maker import make_inference_pipeline
    import gen_utils as gu
    positions = np.frombuffer(gzip.decompress(sys.stdin.buffer.read()), dtype='<f4').reshape(-1, 3).astype(np.float64)
    if not np.isfinite(positions).all():
        raise ValueError('Model contains invalid coordinates')
    if len(np.unique(positions, axis=0)) < 100:
        raise ValueError('Model has too few valid vertices for dental inference')
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(positions)
    mesh.triangles = o3d.utility.Vector3iVector(np.arange(len(positions)).reshape(-1, 3))
    mesh.remove_duplicated_vertices()
    for _ in range(7):
        if len(mesh.vertices) > 24000:
            break
        mesh = mesh.subdivide_midpoint(number_of_iterations=1)
    if len(mesh.vertices) <= 24000:
        raise ValueError('Insufficient mesh vertices after subdivision')
    mesh.compute_vertex_normals()
    with tempfile.TemporaryDirectory(prefix='stl-studio-seg-') as folder:
        path = Path(folder) / f'scan_{jaw}.obj'
        if not o3d.io.write_triangle_mesh(str(path), mesh, write_triangle_uvs=False):
            raise RuntimeError('Could not prepare inference mesh')
        _, reference = gu.read_txt_obj_ls(str(path), ret_mesh=True, use_tri_mesh=True)
        reference.remove_duplicated_vertices()
        coordinates = np.asarray(reference.vertices).copy()
        model = make_inference_pipeline('default', [str(Path(root) / 'models/ckpts/fps.h5'), str(Path(root) / 'models/ckpts/bdl.h5')])
        model.first_module.eval()
        model.bdl_module.eval()
        with torch.no_grad():
            result = model(str(path))
        labels = np.asarray(result['sem'], dtype=np.int32).reshape(-1)
        if len(labels) != len(coordinates):
            raise RuntimeError('Prediction vertex count differs from source mesh')
        if jaw == 'lower':
            labels[labels > 0] += 20
        distances, mapping = cKDTree(coordinates).query(positions, k=1)
        tolerance = max(float(np.ptp(positions, axis=0).max()) * 1e-5, 1e-5)
        if distances.max() > tolerance:
            raise RuntimeError('Prediction coordinates differ from uploaded model')
        output = {'jaw': jaw, 'labels': labels[mapping].tolist(), 'backend': 'customer-container'}
        print('\nSTL_STUDIO_RESULT=' + json.dumps(output, separators=(',', ':')), flush=True)
