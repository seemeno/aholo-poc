"""Local, deterministic geometric fitting. No LLM, semantic service or network.
Outputs metre-assumed Z-up bounded candidates; never promises a semantic floorplan.
"""
import argparse, json
from pathlib import Path
import numpy as np

TYPES={'float':'<f4','float32':'<f4','double':'<f8','float64':'<f8','uchar':'u1','uint8':'u1','int':'<i4','uint':'<u4','short':'<i2','ushort':'<u2'}
def read_ply(file):
    with Path(file).open('rb') as stream:
        fields=[];count=0;vertex=False;fmt=None
        for _ in range(200):
            raw=stream.readline()
            if not raw:raise ValueError('PLY header truncated')
            parts=raw.decode('ascii').strip().split()
            if parts[:1]==['format']:fmt=parts[1]
            if parts[:2]==['element','vertex']:count=int(parts[2]);vertex=True
            elif parts[:1]==['element']:vertex=False
            elif vertex and parts[:1]==['property']:
                if parts[1]=='list':raise ValueError('Vertex list properties unsupported')
                fields.append((parts[2],TYPES[parts[1]]))
            if parts==['end_header']:break
        else:raise ValueError('PLY header too long')
        if not 100<=count<=10000000:raise ValueError('PLY requires 100..10,000,000 vertices')
        if not {'x','y','z'}.issubset(dict(fields)):raise ValueError('Missing XYZ')
        if fmt=='binary_little_endian':
            dtype=np.dtype(fields)
            if Path(file).stat().st_size-stream.tell()<count*dtype.itemsize:raise ValueError('PLY payload truncated')
            return np.fromfile(stream,dtype=dtype,count=count)
        if fmt=='ascii':
            values=np.loadtxt(stream,max_rows=count);out=np.empty(count,dtype=fields)
            for i,(name,_) in enumerate(fields):out[name]=values[:,i]
            return out
        raise ValueError('Use ASCII or binary little endian PLY')

def boundary(points,cell):
    occupied=set(map(tuple,np.floor(points[:,:2]/cell).astype(int)))
    kernel=[(i,j) for i in (-1,0,1) for j in (-1,0,1)]
    expanded={(x+i,y+j) for x,y in occupied for i,j in kernel}
    cells={(x,y) for x,y in expanded if all((x+i,y+j) in expanded for i,j in kernel)}
    groups=[]
    while cells:
        first=cells.pop();group={first};queue=[first]
        while queue:
            x,y=queue.pop()
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
                v=(x+dx,y+dy)
                if v in cells:cells.remove(v);group.add(v);queue.append(v)
        groups.append(group)
    if not groups:raise ValueError('No connected floor support')
    group=max(groups,key=len);edges=set()
    for x,y in group:
        vs=[(x,y),(x+1,y),(x+1,y+1),(x,y+1)]
        for a,b in zip(vs,vs[1:]+vs[:1]):
            if (b,a) in edges:edges.remove((b,a))
            else:edges.add((a,b))
    loops=[]
    while edges:
        a,b=edges.pop();loop=[a,b]
        while loop[-1]!=loop[0]:
            choices=sorted(e for e in edges if e[0]==loop[-1])
            if not choices:break
            edge=choices[0];edges.remove(edge);loop.append(edge[1])
        if loop[-1]==loop[0]:loops.append(loop[:-1])
    area=lambda l:abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(l,l[1:]+l[:1])))
    loop=max(loops,key=area);poly=[]
    for i,v in enumerate(loop):
        a,b=loop[i-1],loop[(i+1)%len(loop)]
        if (v[0]-a[0])*(b[1]-v[1])!=(v[1]-a[1])*(b[0]-v[0]):poly.append([v[0]*cell,v[1]*cell])
    if len(poly)>480:raise ValueError('Floor boundary too fragmented; choose another scene or manually simplify')
    return poly,{'connectedComponents':len(groups),'selectedCells':len(group),'interiorLoopsExcluded':max(0,len(loops)-1)}

def normal_to_z(n):
    target=np.array([0.,0.,1.]);v=np.cross(n,target);c=n@target
    if c>.99999999:return np.eye(3)
    k=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+k+k@k/(1+c)

def fit(file,out,world_id,up='Z',scale=1.):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);data=read_ply(file);names=set(data.dtype.names)
    source=np.column_stack([data[k] for k in ('x','y','z')]).astype(float)
    axis=np.eye(3) if up=='Z' else np.array([[1.,0,0],[0,0,-1],[0,1,0]])
    points=source@axis.T*scale;finite=np.isfinite(points).all(1)
    if finite.sum()<100:raise ValueError('Not enough finite points')
    lo,hi=np.percentile(points[finite],[.5,99.5],axis=0);mask=finite&(points>=lo).all(1)&(points<=hi).all(1)
    if 'opacity' in names:mask&=1/(1+np.exp(-np.clip(data['opacity'].astype(float),-30,30)))>.35
    if all(f'scale_{i}' in names for i in range(3)):
        sigma=np.exp(np.clip(np.column_stack([data[f'scale_{i}'] for i in range(3)]).astype(float),-30,30))*scale
        mask&=np.isfinite(sigma).all(1)&(sigma.max(1)<max(.05,(hi[2]-lo[2])*.12))
    source=source[mask];p=points[mask]
    if len(p)<500:raise ValueError('Filtered scene too small for floor/wall fitting')
    if all(f'f_dc_{i}' in names for i in range(3)):rgb=(np.clip(.5+.2820947918*np.column_stack([data[f'f_dc_{i}'][mask] for i in range(3)]),0,1)*255).astype('u1')
    elif {'red','green','blue'}.issubset(names):rgb=np.column_stack([data[k][mask] for k in ('red','green','blue')]).astype('u1')
    else:rgb=np.full((len(p),3),170,dtype='u1')
    rng=np.random.default_rng(20261031)
    if len(p)>400000:
        ids=rng.choice(len(p),400000,replace=False);p=p[ids];source=source[ids];rgb=rgb[ids]
    _,ids=np.unique(np.floor(p/.04).astype(int),axis=0,return_index=True);q=p[ids]
    low,high=np.percentile(q[:,2],[1,45]);slabs=[]
    if np.ptp(q,axis=0).max()>200:raise ValueError('SOURCE_SCALE_UNCERTAIN: scene spans over 200 assumed metres; provide metre-scaled PLY')
    for z in np.linspace(low,high,min(240,max(2,int((high-low)/.025)+1))):
        near=q[np.abs(q[:,2]-z)<.05]
        if len(near)<80:continue
        coverage=len(np.unique(np.floor(near[:,:2]/.30).astype(int),axis=0));slabs.append((coverage,z))
    if not slabs:raise ValueError('NO_RELIABLE_FLOOR: no broad low horizontal support; check up axis')
    coverage,z=max(slabs);best=q[np.abs(q[:,2]-z)<.065];center=np.median(best,axis=0)
    _,_,vh=np.linalg.svd(best-center,full_matrices=False);n=vh[-1]
    if n[2]<0:n=-n
    tilt=float(np.degrees(np.arccos(np.clip(n[2],-1,1))))
    if tilt>12:raise ValueError('NO_RELIABLE_FLOOR: floor tilt exceeds 12 degrees; change up axis or improve capture')
    r=normal_to_z(n);rotated=p@r.T;base=float(np.median((best@r.T)[:,2]));rotated[:,2]-=base;p=rotated
    _,ids=np.unique(np.floor(p/.04).astype(int),axis=0,return_index=True);q=p[ids]
    floor_pts=q[np.abs(q[:,2])<.065];rmse=float(np.sqrt(np.mean(floor_pts[:,2]**2)))
    poly,components=boundary(floor_pts,.30);xy=np.array(poly)
    if np.ptp(xy,axis=0).min()<.6:raise ValueError('NO_RELIABLE_FLOOR: support region is too narrow')
    floor={'id':'floor_0','z':0.,'normal':[0,0,1],'polygon':poly,'bounds':[xy.min(0).tolist(),xy.max(0).tolist()],'source':'LOCAL_GEOMETRY','status':'CANDIDATE','method':'lower-height horizontal coverage + SVD normal + connected support boundary','rmse':rmse,'supportCount':len(floor_pts),'supportRatio':len(floor_pts)/len(q),'sourceTiltDegrees':tilt,**components}
    remaining=q[(q[:,2]>.15)&(q[:,2]<np.percentile(q[:,2],98))];walls=[]
    for _ in range(10):
        if len(remaining)<350:break
        sample=remaining[rng.choice(len(remaining),min(8000,len(remaining)),replace=False)];best_score=0;best_plane=None
        for _ in range(160):
            a,b=sample[rng.choice(len(sample),2,replace=False),:2];t=b-a;length=np.linalg.norm(t)
            if length<.7:continue
            t/=length;n2=np.array([-t[1],t[0]]);d=-a@n2;near=sample[np.abs(sample[:,:2]@n2+d)<.05]
            if len(near)<100 or np.ptp(np.percentile(near[:,2],[5,95]))<1.:continue
            score=len(np.unique(np.floor(np.column_stack([near[:,:2]@t,near[:,2]])/.25).astype(int),axis=0))
            if score>best_score:best_score=score;best_plane=(n2,d)
        if best_plane is None:break
        n2,d=best_plane;near=remaining[np.abs(remaining[:,:2]@n2+d)<.065];center=near[:,:2].mean(0);_,_,vh=np.linalg.svd(near[:,:2]-center,full_matrices=False);t=vh[0];n2=np.array([-t[1],t[0]]);d=-center@n2
        if n2@(xy.mean(0)-center)<0:n2=-n2;d=-d
        us=near[:,:2]@t;bins=np.unique(np.floor(us/.30).astype(int));cuts=np.where(np.diff(bins)>2)[0]+1
        for group in np.split(bins,cuts):
            support=near[(us>=group[0]*.30)&(us<=(group[-1]+1)*.30)]
            if len(support)<150:continue
            u0,u1=np.percentile(support[:,:2]@t,[2,98]);height=float(np.percentile(support[:,2],97))
            if u1-u0<.8 or height<1.2:continue
            a=t*u0-n2*d;b=t*u1-n2*d;error=float(np.sqrt(np.mean((support[:,:2]@n2+d)**2)))
            walls.append({'id':f'wall_{len(walls)}','a':[*a.tolist(),0.],'b':[*b.tolist(),0.],'height':height,'normal':[*n2.tolist(),0.],'source':'LOCAL_GEOMETRY','method':'constrained vertical RANSAC + PCA + connected intervals','status':'CANDIDATE','enabled':bool(len(support)/len(q)>=.02 or len(support)/((u1-u0)*height)>=100),'supportCount':len(support),'supportRatio':len(support)/len(q),'rmse':error,'thickness':0})
        remaining=remaining[np.abs(remaining[:,:2]@n2+d)>.18]
    transform=np.eye(4);transform[:3,:3]=r@axis*scale;transform[2,3]=-base
    result={'schemaVersion':2,'worldId':world_id,'units':'m','upAxis':'Z','sourceToAligned':transform.tolist(),'scaleBasis':'ASSUMED_SOURCE_UNIT_METRE_USER_CALIBRATION_REQUIRED','sourceGaussianCount':len(data),'filteredPointCount':len(p),'floor':floor,'walls':walls,'openings':[],'boxes':[],'quality':{'status':'PARTIAL','method':'LOCAL_GEOMETRY_NO_LLM','floorCount':1,'wallCount':len(walls),'openingCount':0,'openingsStatus':'UNKNOWN_MANUAL_CORRECTION_REQUIRED'},'limitations':['Local geometry candidates may include furniture faces.','Largest connected floor support is not a complete multi-room floorplan.','Doors and windows are not inferred by this geometric method; add openings manually.','Scale is assumed, not a measured room.']}
    (out/'structure.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    pick=rng.choice(len(p),min(len(p),22000),replace=False)
    (out/'point_preview.json').write_text(json.dumps({'xyz':np.round(p[pick],5).tolist(),'sourceXyz':np.round(source[pick],6).tolist(),'rgb':rgb[pick].tolist()},separators=(',',':')),encoding='utf-8')
    (out/'fit_report.json').write_text(json.dumps({'method':'LOCAL_GEOMETRY_NO_LLM','filter':{'opacity':'sigmoid > 0.35','scale':'exp(log scale) < 12% of robust source height','percentiles':[.5,99.5],'voxel':.04,'seed':20261031},'floor':floor,'walls':walls,'quality':result['quality']},indent=2),encoding='utf-8')
    return {'floor':1,'walls':len(walls),'rmse':rmse,'tilt':tilt,'points':len(p)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--out',required=True);parser.add_argument('--world',required=True);parser.add_argument('--up',choices=['Z','Y'],default='Z');parser.add_argument('--scale',type=float,default=1.)
    a=parser.parse_args()
    if not np.isfinite(a.scale) or a.scale<=0:raise ValueError('Scale must be finite and positive')
    print(json.dumps(fit(a.input,a.out,a.world,a.up,a.scale)))
