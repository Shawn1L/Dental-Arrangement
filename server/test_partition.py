import unittest
import numpy as np
from refinement.partition import face_regions, partition, guided_fields


class PartitionTests(unittest.TestCase):
    def setUp(self):
        self.vertices = np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]])
        self.faces = np.array([[0,1,2]])

    def test_two_labels_share_exact_half_edge(self):
        fields=np.array([[1.,0.],[0.,1.],[0.,1.]])
        result=partition(self.vertices,self.faces,np.array([0,11]),fields)
        self.assertEqual(len(result[2]),3)
        self.assertAlmostEqual(result[-1]['surface_area'],.5)
        self.assertEqual(len(result[5]),1)
        np.testing.assert_allclose(result[5][0],[[.5,0,0],[0,.5,0]])
        self.assertEqual(result[-1]['max_source_reconstruction_error'],0)

    def test_three_labels_cover_face_and_share_junction(self):
        result=partition(self.vertices,self.faces,np.array([0,11,21]),np.eye(3))
        self.assertEqual(len(result[2]),6)
        self.assertEqual(set(result[2]),{0,11,21})
        self.assertEqual(len(result[5]),3)
        for line in result[5]:
            self.assertTrue(np.any(np.linalg.norm(line-np.array([1/3,1/3,0]),axis=1)<1e-10))
        self.assertLess(result[-1]['max_face_area_relative_error'],1e-12)

    def test_identical_fields_have_one_owner(self):
        result=face_regions(np.full((3,2),.5))
        self.assertEqual(len(result),1)
        self.assertEqual(result[0][0],0)

    def test_adjacent_faces_have_matching_boundary_crossing(self):
        vertices=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.],[1.,1.,.5]])
        faces=np.array([[0,1,2],[1,3,2]])
        fields=np.array([[1.,0.],[.7,.3],[.2,.8],[0.,1.]])
        result=partition(vertices,faces,np.array([0,11]),fields)
        # The shared edge (1,2) crosses at the same point on both faces.
        expected=.6*vertices[1]+.4*vertices[2]
        endpoints=result[5].reshape(-1,3)
        self.assertEqual(np.count_nonzero(np.linalg.norm(endpoints-expected,axis=1)<1e-10),2)
        self.assertLess(result[-1]['max_face_area_relative_error'],1e-12)

    def test_label_can_own_interior_without_winning_corner(self):
        values=np.array([[.6,0,0,.4],[0,.6,0,.4],[0,0,.6,.4]])
        self.assertEqual(set(x[0] for x in face_regions(values)),{0,1,2,3})
        result=partition(self.vertices,self.faces,np.array([0,11,21,31]),values)
        self.assertLess(result[-1]['max_face_area_relative_error'],1e-12)

    def test_outside_band_fixed_and_guides_affect_solution(self):
        v=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.],[1.,1.,0.],[2.,0.,0.],[2.,1.,0.]])
        f=np.array([[0,1,2],[1,3,2],[1,4,3],[4,5,3]])
        labels=np.array([0,11,0,11,11,11])
        curve={'smooth':[[.3,0,0],[.3,.3,0]],'smooth_face_ids':[0,0],
               'smooth_barycentric':[[.7,.3,0],[.4,.3,.3]],'labels':[0,11]}
        ids,fields,band,_=guided_fields(v,f,labels,[curve],width=.2)
        original=(labels[:,None]==ids).astype(float)
        np.testing.assert_array_equal(fields[~band],original[~band])
        np.testing.assert_allclose(fields.sum(axis=1),1)
        self.assertGreater(np.max(np.abs(fields-original)),.01)

    def test_smoothing_strength_changes_solution_and_preserves_band(self):
        v=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.],[1.,1.,0.],[2.,0.,0.],[2.,1.,0.]])
        f=np.array([[0,1,2],[1,3,2],[1,4,3],[4,5,3]])
        labels=np.array([0,11,0,11,11,11])
        ids,weak,band,_=guided_fields(v,f,labels,[],width=.2,smoothness=.1)
        _,strong,_,_=guided_fields(v,f,labels,[],width=.2,smoothness=6)
        self.assertGreater(np.max(np.abs(weak-strong)),.1)
        np.testing.assert_array_equal(strong[~band],(labels[:,None]==ids)[~band])

    def test_bulk_homogeneous_faces_preserve_source_mapping(self):
        v=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.],[1.,1.,.5]])
        f=np.array([[0,1,2],[1,3,2]])
        fields=np.array([[.6,.4],[.65,.35],[.8,.2],[.2,.8]])
        result=partition(v,f,np.array([0,11]),fields)
        for points,source,bary in zip(result[0],result[3],result[4]):
            np.testing.assert_allclose(points,bary@v[f[source]])
        self.assertLess(result[-1]['max_face_area_relative_error'],1e-12)



if __name__=='__main__':
    unittest.main()
