#!/usr/bin/env python3
"""Deterministic local extraction. Review masks and letter boundaries before admitting forms."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np,json,math,sys
sys.setrecursionlimit(50000)
import argparse
parser=argparse.ArgumentParser(description="Extract notebook ink with reviewed character boundaries; requires Pillow and NumPy.")
parser.add_argument('--image',required=True,help='Decoded full-resolution photograph (PNG/JPEG), upright')
parser.add_argument('--segments',default='font/pavel-notes/raster-segments.json')
parser.add_argument('--output',default='font/pavel-notes/raster-strokes.json')
parser.add_argument('--review-dir',help='Optional local directory for source overlays and masks')
args=parser.parse_args()
spec=json.loads(Path(args.segments).read_text())
if spec.get('processingScale') != 2:
    raise ValueError('This reviewed extraction uses processingScale=2.')
words=spec['words']
ROOT=Path(args.review_dir) if args.review_dir else None
if ROOT:ROOT.mkdir(parents=True,exist_ok=True)


def thin(mask):
    a=np.pad(mask.astype(np.uint8),1)
    for _ in range(150):
        changed=False
        for phase in [0,1]:
            p=[a[:-2,1:-1],a[:-2,2:],a[1:-1,2:],a[2:,2:],a[2:,1:-1],a[2:,:-2],a[1:-1,:-2],a[:-2,:-2]]
            count=sum(p);trans=sum((p[i]==0)&(p[(i+1)%8]==1) for i in range(8))
            if phase==0: constraint=(p[0]*p[2]*p[4]==0)&(p[2]*p[4]*p[6]==0)
            else:constraint=(p[0]*p[2]*p[6]==0)&(p[0]*p[4]*p[6]==0)
            remove=(a[1:-1,1:-1]>0)&(count>=2)&(count<=6)&(trans==1)&constraint
            if np.any(remove):a[1:-1,1:-1][remove]=0;changed=True
        if not changed:break
    return a[1:-1,1:-1]

def components(mask):
    coords=set(map(tuple,np.argwhere(mask)));result=[]
    while coords:
        start=coords.pop();part=[start];stack=[start]
        while stack:
            y,x=stack.pop()
            for dy in [-1,0,1]:
                for dx in [-1,0,1]:
                    p=(y+dy,x+dx)
                    if p in coords:coords.remove(p);stack.append(p);part.append(p)
        result.append(part)
    return result

def simplify(points,tol=.45):
    if len(points)<3:return points
    a=np.array(points[0]);b=np.array(points[-1]);q=np.array(points);v=b-a;v2=np.dot(v,v)
    if v2<1e-9:d=np.linalg.norm(q-a,axis=1)
    else:
        t=np.clip(np.dot(q-a,v)/v2,0,1);d=np.linalg.norm(q-(a+t[:,None]*v),axis=1)
    k=int(np.argmax(d))
    if d[k]<=tol:return [points[0],points[-1]]
    return simplify(points[:k+1],tol)[:-1]+simplify(points[k:],tol)

def trace(mask, word=None):
    coords=set((int(x),int(y)) for y,x in np.argwhere(mask));adj={}
    for x,y in coords:
        neighbors=[]
        for dx,dy in [(1,0),(0,1),(-1,0),(0,-1),(1,1),(-1,1),(-1,-1),(1,-1)]:
            p=(x+dx,y+dy)
            if p not in coords:continue
            if dx and dy and ((x+dx,y) in coords or (x,y+dy) in coords):continue
            neighbors.append(p)
        adj[(x,y)]=neighbors
    key=lambda a,b:tuple(sorted([a,b]))
    owners={}
    if word:
        stack=[];seen={};low={};counter=[0]
        def visit(u,parent=None):
            counter[0]+=1;seen[u]=low[u]=counter[0]
            for v in adj[u]:
                if v==parent:continue
                if v not in seen:
                    stack.append((u,v));visit(v,u);low[u]=min(low[u],low[v])
                    if low[v]>=seen[u]:
                        group=[]
                        while stack:
                            edge=stack.pop();group.append(edge)
                            if edge==(u,v):break
                        if len(group)>=3:
                            nodes={n for e in group for n in e};l,t,_,_=word['box']
                            qs=[n[0]/2+l+word['slant']*(n[1]/2+t-word['baseline']) for n in nodes]
                            owner=max(0,min(len(word['text'])-1,int(np.searchsorted(word['cuts'],np.median(qs),side='right')-1)))
                            for a,b in group:owners[key(a,b)]=owner
                elif seen[v]<seen[u]:
                    stack.append((u,v));low[u]=min(low[u],seen[v])
        for node in sorted(coords):
            if node not in seen:visit(node)
    used=set();paths=[]
    nodes=sorted(coords,key=lambda p:(len(adj[p])!=1,p[0],p[1]))
    for start in nodes:
        while any(key(start,n) not in used for n in adj[start]):
            path=[start];cur=start
            while True:
                choices=[n for n in adj[cur] if key(cur,n) not in used]
                if not choices:break
                if len(path)>1:
                    prev=path[max(0,len(path)-6)];vx=cur[0]-prev[0];vy=cur[1]-prev[1]
                    choices.sort(key=lambda n:-((n[0]-cur[0])*vx+(n[1]-cur[1])*vy)/max(.001,math.hypot(n[0]-cur[0],n[1]-cur[1])))
                else:choices.sort(key=lambda n:(n[0],n[1]))
                nxt=choices[0];used.add(key(cur,nxt));path.append(nxt);cur=nxt
            if len(path)>1:paths.append(path)
    return paths, owners

im=Image.open(args.image).convert('RGB')
width,height=spec['orientedSize'];l,t,w,h=spec['pageCrop']
if abs(im.width/im.height-width/height) > .02:
    raise ValueError('Use the full upright photograph, not a rotated image or page crop.')
im=im.resize((width*2,height*2),Image.Resampling.LANCZOS).crop((l*2,t*2,(l+w)*2,(t+h)*2))
result=[]
for wi,word in enumerate(words):
    l,t,r,bottom=word['box'];base=word['baseline'];sl=word['slant'];c=word['cuts'];arr=np.asarray(im.crop((l*2,t*2,r*2,bottom*2))).astype(float)
    red,green,blue=arr[:,:,0],arr[:,:,1],arr[:,:,2];gray=red*.299+green*.587+blue*.114
    mask=((gray<90)|((blue-np.minimum(red,green)>22)&(blue-green>7)&(gray<145))|(word.get('highlighted',False)&(gray<140)))&~((red>blue*1.25)&(red>green*1.3))
    yy,xx=np.indices(mask.shape);ys=yy/2+t;xs=xx/2+l;q=xs+sl*(ys-base)
    mask &= (q>=c[0])&(q<=c[-1])
    # Exclude neighboring rows while preserving the known ascenders/descenders.
    for gi,char in enumerate(word['text']):
        cell=(q>=c[gi])&(q<c[gi+1])
        if char not in 'дзуфрцщ': mask[cell&(ys>base+10)]=False
        if char not in 'бвйёф' and not char.isupper():mask[cell&(ys<base-35)]=False
    for x1,y1,x2,y2 in word.get('exclude',[]):mask[(xs>x1)&(xs<x2)&(ys>y1)&(ys<y2)]=False
    parts=components(mask);largest=max(map(len,parts),default=0);mask[:]=False
    for part in parts:
        pts=np.array(part);pys=pts[:,0]/2+t;pxs=pts[:,1]/2+l;pq=pxs+sl*(pys-base)
        body=np.any((pys>base-31)&(pys<base+6))
        accent=any(char=='й' and np.any((pq>c[idx])&(pq<c[idx+1])&(pys>base-48)&(pys<base-24)) for idx,char in enumerate(word['text']))
        if (len(part)>=max(10,largest*.025) and body) or (accent and len(part)>=5):mask[pts[:,0],pts[:,1]]=True
    mask=np.array(Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)))>0
    skel=thin(mask)
    if ROOT:Image.fromarray((255-mask*255).astype('uint8')).save(ROOT/f'mask-{wi:02}.png')
    if ROOT:Image.fromarray((255-skel*255).astype('uint8')).save(ROOT/f'skeleton-{wi:02}.png')
    rawpaths,cycleOwners=trace(skel,word)
    paths=[[(x/2+l,y/2+t) for x,y in path] for path in rawpaths]
    glyphs=[[] for _ in word['text']]
    def segidx(q):return max(0,min(len(c)-2,int(np.searchsorted(c,q,side='right')-1)))
    for path in paths:
        current=[];ci=None
        for a,b in zip(path,path[1:]):
            qa=a[0]+sl*(a[1]-base);qb=b[0]+sl*(b[1]-base)
            cycle=cycleOwners.get(tuple(sorted([tuple(round((v-z)*2) for v,z in zip(a,(l,t))),tuple(round((v-z)*2) for v,z in zip(b,(l,t)))])))
            knots=[0,1]
            if cycle is None and abs(qb-qa)>1e-8:knots += [(v-qa)/(qb-qa) for v in c[1:-1] if 0<(v-qa)/(qb-qa)<1]
            knots=sorted(knots)
            for ta,tb in zip(knots,knots[1:]):
                aa=(a[0]+(b[0]-a[0])*ta,a[1]+(b[1]-a[1])*ta);bb=(a[0]+(b[0]-a[0])*tb,a[1]+(b[1]-a[1])*tb)
                index=cycle if cycle is not None else segidx((qa+(qb-qa)*(ta+tb)/2))
                if ci!=index:
                    if len(current)>1:glyphs[ci].append(current)
                    current=[aa];ci=index
                elif not current:current=[aa]
                current.append(bb)
        if len(current)>1:glyphs[ci].append(current)
    paths=[simplify(p,.3) for p in paths]
    glyphs=[[simplify(p,.3) for p in gs] for gs in glyphs]
    result.append({**word,'paths':paths,'glyphs':glyphs,'inkPixels':int(mask.sum()),'skeletonPixels':int(skel.sum())})
    if ROOT:
        prev=im.crop((l*2,t*2,r*2,bottom*2));draw=ImageDraw.Draw(prev)
        colors=['#08b080','#e13c44','#284ada','#b350c0']
        for index,strokes in enumerate(glyphs):
            for path in strokes:draw.line([((x-l)*2,(y-t)*2) for x,y in path],fill=colors[index%4],width=2)
        prev.save(ROOT/f'trace-{wi:02}.png')
    print(wi,word['text'],len(paths),'paths',int(mask.sum()),'pixels')
Path(args.output).write_text(json.dumps({'version':1,'sourceFile':spec['sourceFile'],
    'method':'threshold-skeleton-with-manual-character-boundaries','pixelsPerMm':spec['pixelsPerMm'],
    'nominalFontSizePx':spec['nominalFontSizePx'],'words':result},ensure_ascii=False,separators=(',',':'))+'\n')
