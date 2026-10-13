import unittest
from unittest.mock import patch
import numpy as np
import trimesh
from refinement import curves


def reference(mesh, raw, closed, iterations, cap):
    # Independent pre-batching contour algorithm, retained as a numerical oracle.
    dense = [raw[0]]
    for a, b in zip(raw[:-1], raw[1:]):
        n = max(1, int(np.ceil(np.linalg.norm(b-a)/.25)))
        dense.extend(a+(b-a)*i/n for i in range(1,n+1))
    anchor = np.asarray(dense[:-1] if closed else dense)
    points = anchor.copy()
    for _ in range(iterations):
        proposal = .5*points+.25*(np.roll(points,1,axis=0)+np.roll(points,-1,axis=0))
        if not closed: proposal[[0,-1]]=anchor[[0,-1]]
        projected,_,_=curves.project(mesh,proposal)
        allowed=np.linalg.norm(projected-anchor,axis=1)<=cap
        points[allowed]=projected[allowed]
    points,ids,bary=curves.project(mesh,points)
    if not closed: points[[0,-1]]=anchor[[0,-1]]
    if closed:
        points=np.vstack((points,points[0]));ids=np.r_[ids,ids[0]]
        bary=np.vstack((bary,bary[0]));anchor=np.vstack((anchor,anchor[0]))
    return points,ids,bary,float(np.linalg.norm(points-anchor,axis=1).max(initial=0))


class CurveBatchTests(unittest.TestCase):
    def setUp(self):
        v=np.array([[x,y,.06*x*y] for y in range(5) for x in range(5)],float)
        f=[]
        for y in range(4):
            for x in range(4):
                a=y*5+x;f.extend([[a,a+1,a+5],[a+1,a+6,a+5]])
        self.mesh=trimesh.Trimesh(vertices=v,faces=f,process=False)
        self.inputs=[(v[[6,7,12,17,18]],False),(v[[6,8,18,16,6]],True),(v[[0,1]],False)]

    def test_batch_matches_independent_contours_with_fixed_endpoints_and_cap(self):
        for cap in [0.,.15,.55]:
            expected=[reference(self.mesh,raw,closed,8,cap) for raw,closed in self.inputs]
            actual=curves.smooth_chains(self.mesh,self.inputs,8,cap)
            for got,want in zip(actual,expected):
                for i in [0,1,2]: np.testing.assert_array_equal(got[i],want[i])
                self.assertEqual(got[3],want[3])
            np.testing.assert_array_equal(actual[0][0][[0,-1]],self.inputs[0][0][[0,-1]])
            np.testing.assert_array_equal(actual[1][0][0],actual[1][0][-1])

    def test_projection_work_depends_on_iterations_not_number_of_curves(self):
        with patch.object(curves,'project',wraps=curves.project) as project:
            curves.smooth_chains(self.mesh,self.inputs,48,.55)
            self.assertEqual(project.call_count,49)
        with patch.object(curves,'project') as project:
            self.assertEqual(curves.smooth_chains(self.mesh,[],48,.55),[])
            project.assert_not_called()
