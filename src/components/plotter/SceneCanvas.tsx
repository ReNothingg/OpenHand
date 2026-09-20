import { useEffect, useMemo, useRef, useState } from "react";
import { bounds, type Point, type SceneObject } from "../../plotter/workshop";
import { mapSceneObjects, selectionBounds, warpPoint, type SceneTool } from "../../plotter/scene";
const path = (object: SceneObject) => object.strokes.map(s=>s.map((p,i)=>`${i?"L":"M"}${p.x} ${p.y}`).join(" ")).join(" ");
export default function SceneCanvas({ objects, selected, onSelect, onCommit, tool, setTool, locked, width, height, fitRequest, zoom, onZoom, onUndo, onRedo, onDuplicate, onDelete, travelPath }: {
  objects: SceneObject[]; selected: string[]; onSelect: (ids:string[])=>void; onCommit:(objects:SceneObject[])=>void;
  tool: SceneTool; setTool:(tool:SceneTool)=>void; locked:boolean; width:number; height:number; fitRequest:number; zoom:number; onZoom:(zoom:number)=>void;
  onUndo:()=>void; onRedo:()=>void; onDuplicate:()=>void; onDelete:()=>void; travelPath?:string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [pixelScale,setPixelScale] = useState(1);
  const [pan,setPan] = useState({x:-10,y:-10});
  const [draft,setDraft] = useState<SceneObject[] | null>(null);
  const [marquee,setMarquee] = useState<{a:Point;b:Point}|null>(null);
  const space = useRef(false);
  const drag = useRef<any>(null);
  const pending = useRef<Point|null>(null), frame=useRef(0);
  const cachedPaths = useMemo(()=>new Map(objects.map(o=>[o.id,path(o)])),[objects]);
  const rendered = draft || objects;
  const box = useMemo(()=>selectionBounds(rendered, selected),[rendered,selected]);
  const boxes = useMemo(()=>new Map(rendered.map(o=>[o.id,bounds(o.strokes)])),[rendered]);
  const lightObjects = useMemo(()=>objects.map(o=>{const count=o.strokes.reduce((n,s)=>n+s.length,0),step=Math.max(1,Math.ceil(count/1500));return {...o,strokes:o.strokes.map(s=>s.filter((_,i)=>i===0||i===s.length-1||i%step===0))};}),[objects]);
  const viewWidth=(width+20)/zoom, viewHeight=(height+20)/zoom;
  useEffect(()=>{
    const el=svg.current;if(!el)return;
    const update=()=>setPixelScale(el.getScreenCTM()?.a || 1);
    update();const observer=new ResizeObserver(update);observer.observe(el);return()=>observer.disconnect();
  },[zoom,width,height]);
  useEffect(()=>{setPan({x:-10,y:-10});onZoom(1);},[width,height]);
  const handle = 9/pixelScale;
  const fit = () => {
    const b=bounds(objects.filter(o=>!selected.length||selected.includes(o.id)).flatMap(o=>o.strokes));
    const next=Math.max(.2,Math.min(8,Math.min((width+20)/(b.width+30),(height+20)/(b.height+30))));
    setPan({x:(b.minX+b.maxX)/2-(width+20)/next/2,y:(b.minY+b.maxY)/2-(height+20)/next/2});onZoom(next);
  };
  useEffect(()=>{ if(fitRequest)fit(); },[fitRequest]);
  const point = (x:number,y:number):Point => {
    const inverse=drag.current?.kind!=="pan" && drag.current?.inverse ? drag.current.inverse : svg.current?.getScreenCTM()?.inverse(); if(!inverse) return {x:0,y:0};
    const p=new DOMPoint(x,y).matrixTransform(inverse); return {x:p.x,y:p.y};
  };
  const cancel = () => { drag.current=null; pending.current=null; cancelAnimationFrame(frame.current); frame.current=0;
    svg.current?.querySelectorAll("[data-preview-transform]").forEach(node=>{node.removeAttribute("transform");node.removeAttribute("data-preview-transform");});
    setDraft(null); setMarquee(null); };
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  useEffect(()=>{if(locked)cancel();},[locked]);
  useEffect(()=>{
    const el=svg.current;if(!el)return;
    const wheel=(e:WheelEvent)=>{e.preventDefault();if(drag.current)return;const p=point(e.clientX,e.clientY),next=Math.max(.2,Math.min(8,zoom*Math.exp(-e.deltaY*.002)));const ratio=zoom/next;setPan({x:p.x-(p.x-pan.x)*ratio,y:p.y-(p.y-pan.y)*ratio});onZoom(next);};
    el.addEventListener("wheel",wheel,{passive:false});return()=>el.removeEventListener("wheel",wheel);
  },[zoom,pan,width,height]);
  const mapping=(p:Point,shift=false):((q:Point)=>Point)=>{
    const d=drag.current;if(!d)return q=>q;
    let dx=p.x-d.start.x,dy=p.y-d.start.y;
    if(shift&&d.kind==="move"){dx=Math.round(dx);dy=Math.round(dy);}
    if(d.kind==="move")return q=>({x:q.x+dx,y:q.y+dy});
    const b=d.box,c={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
    if(d.kind==="rotate"){
      let a=Math.atan2(p.y-c.y,p.x-c.x)-Math.atan2(d.start.y-c.y,d.start.x-c.x);
      if(shift)a=Math.round(a/(Math.PI/12))*(Math.PI/12);
      return q=>({x:c.x+(q.x-c.x)*Math.cos(a)-(q.y-c.y)*Math.sin(a),y:c.y+(q.x-c.x)*Math.sin(a)+(q.y-c.y)*Math.cos(a)});
    }
    if(d.kind==="warp"){
      const corners=[{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}];corners[d.corner]={x:corners[d.corner].x+dx,y:corners[d.corner].y+dy};
      return q=>warpPoint(q,b,corners);
    }
    const anchor={x:d.corner===0||d.corner===3?b.maxX:b.minX,y:d.corner<2?b.maxY:b.minY};
    let sx=Math.abs(d.start.x-anchor.x)>1e-6?(p.x-anchor.x)/(d.start.x-anchor.x):1;
    let sy=Math.abs(d.start.y-anchor.y)>1e-6?(p.y-anchor.y)/(d.start.y-anchor.y):1;
    if(!shift){const k=Math.abs(sx)>Math.abs(sy)?sx:sy;sx=sy=k;}
    sx=Math.max(.01,Math.min(100,sx));sy=Math.max(.01,Math.min(100,sy));
    return q=>({x:anchor.x+(q.x-anchor.x)*sx,y:anchor.y+(q.y-anchor.y)*sy});
  };
  const compute=(p:Point,shift=false,preview=false)=>mapSceneObjects(preview?lightObjects:drag.current.objects,drag.current.ids,mapping(p,shift));
  const begin=(e:React.PointerEvent,kind:string,ids=selected,corner=0)=>{
    e.preventDefault();e.stopPropagation();svg.current?.focus({preventScroll:true});
    if(locked&&kind!=="pan")return;
    drag.current={kind,ids,corner,inverse:svg.current?.getScreenCTM()?.inverse(),start:point(e.clientX,e.clientY),screen:{x:e.clientX,y:e.clientY},pan,objects,box:selectionBounds(objects,ids),shift:e.shiftKey};
    svg.current?.setPointerCapture(e.pointerId);
  };
  return <svg ref={svg} className="scene-canvas" tabIndex={0} role="application" aria-label="Редактор сцены плоттера" viewBox={`${pan.x} ${pan.y} ${viewWidth} ${viewHeight}`}
    onBlur={()=>{space.current=false;}} onContextMenu={e=>e.preventDefault()}
    onPointerDown={e=>{if(e.button===1||space.current||tool==="pan")begin(e,"pan");else{if(!e.shiftKey)onSelect([]);begin(e,"marquee",e.shiftKey?selected:[]);}}}
    onPointerMove={e=>{
      const d=drag.current;if(!d)return;
      if(d.kind==="pan") { const matrix=svg.current!.getScreenCTM()!;setPan({x:d.pan.x-(e.clientX-d.screen.x)/matrix.a,y:d.pan.y-(e.clientY-d.screen.y)/matrix.d});return; }
      pending.current=point(e.clientX,e.clientY);d.shift=e.shiftKey;
      if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;if(!drag.current||!pending.current)return;if(d.kind==="marquee")setMarquee({a:d.start,b:pending.current});else if(d.kind==="warp")setDraft(compute(pending.current,d.shift,true));else {
        const fn=mapping(pending.current,d.shift),a=fn({x:0,y:0}),b=fn({x:1,y:0}),c=fn({x:0,y:1});
        const matrix=`matrix(${b.x-a.x} ${b.y-a.y} ${c.x-a.x} ${c.y-a.y} ${a.x} ${a.y})`;
        svg.current?.querySelectorAll<SVGGElement>("[data-scene-node], .scene-gizmo").forEach(node=>{
          if(node.classList.contains("scene-gizmo") || d.ids.includes(node.dataset.sceneNode)) {
            node.setAttribute("transform",matrix);node.setAttribute("data-preview-transform","");
          }
        });
      }});
    }}
    onPointerUp={e=>{
      const d=drag.current;if(!d)return;const p=point(e.clientX,e.clientY);
      if(d.kind==="marquee"){
        const left=Math.min(p.x,d.start.x),right=Math.max(p.x,d.start.x),top=Math.min(p.y,d.start.y),bottom=Math.max(p.y,d.start.y);
        if(Math.hypot(p.x-d.start.x,p.y-d.start.y)>1)onSelect([...new Set([...d.ids,...objects.filter(o=>{const b=bounds(o.strokes);return b.maxX>=left&&b.minX<=right&&b.maxY>=top&&b.minY<=bottom;}).map(o=>o.id)])]);
      }else if(d.kind!=="pan"&&!locked&&Math.hypot(p.x-d.start.x,p.y-d.start.y)>.001)onCommit(compute(p,e.shiftKey));
      cancel();if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={e=>{
      if(e.key===" "){e.preventDefault();space.current=true;return;}if(e.key==="Escape"){cancel();onSelect([]);return;}if(e.key.toLowerCase()==="f"){e.preventDefault();fit();return;}if(locked)return;
      const modifier=e.metaKey||e.ctrlKey;
      if(modifier&&e.key.toLowerCase()==="z"){e.preventDefault();cancel();e.shiftKey?onRedo():onUndo();return;}
      if(modifier&&e.key.toLowerCase()==="d"){e.preventDefault();onDuplicate();return;}
      if(modifier&&e.key.toLowerCase()==="a"){e.preventDefault();onSelect(objects.map(o=>o.id));return;}
      if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();onDelete();return;}
      const tools:Record<string,SceneTool>={v:"move",e:"rotate",r:"scale",t:"warp",h:"pan"};if(!modifier&&tools[e.key.toLowerCase()])setTool(tools[e.key.toLowerCase()]);
      const deltas:Record<string,Point>={ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1}};
      if(deltas[e.key]&&selected.length){e.preventDefault();const d=deltas[e.key],k=e.shiftKey?10:1;onCommit(mapSceneObjects(objects,selected,p=>({x:p.x+d.x*k,y:p.y+d.y*k})));}
    }} onKeyUp={e=>{if(e.key===" ")space.current=false;}}>
    <rect x={0} y={0} width={width} height={height} fill="white" stroke="#a0a0a0" strokeWidth=".3" />
    <path d={[...Array.from({length:Math.floor(width/10)},(_,i)=>`M${(i+1)*10} 0V${height}`),...Array.from({length:Math.floor(height/10)},(_,i)=>`M0 ${(i+1)*10}H${width}`)].join(" ")} stroke="#e6e6e6" strokeWidth=".15" fill="none" pointerEvents="none" />
    {travelPath&&!draft&&<path d={travelPath} fill="none" stroke="#b28650" strokeWidth=".25" strokeDasharray="1 1"/>}
    {rendered.map(o=>{const b=boxes.get(o.id)!;return <g key={o.id} data-scene-node={o.id} aria-label={o.name}>
      <path d={draft && selected.includes(o.id) ? path(o) : cachedPaths.get(o.id)} fill="none" stroke={b.minX<0||b.minY<0||b.maxX>width||b.maxY>height?"#b43b32":selected.includes(o.id)?"#237a35":"#222"} strokeWidth=".35" pointerEvents="none" />
      <rect data-scene-object={o.id} x={b.minX} y={b.minY} width={Math.max(.8,b.width)} height={Math.max(.8,b.height)} fill="transparent" onPointerDown={e=>{
        if(space.current||tool==="pan"||e.button===1){begin(e,"pan");return;}
        const ids=e.shiftKey?(selected.includes(o.id)?selected.filter(id=>id!==o.id):[...selected,o.id]):selected.includes(o.id)?selected:[o.id];onSelect(ids);
        begin(e,"move",ids);
      }} />
    </g>;})}
    {selected.length>0&&objects.some(o=>selected.includes(o.id))&&<g className="scene-gizmo">
      <rect x={box.minX} y={box.minY} width={Math.max(.1,box.width)} height={Math.max(.1,box.height)} fill="none" stroke="#237a35" strokeWidth=".35" strokeDasharray="2 1" pointerEvents="none" />
      {tool==="rotate"&&<><line x1={(box.minX+box.maxX)/2} y1={box.minY} x2={(box.minX+box.maxX)/2} y2={box.minY-24/pixelScale} stroke="#237a35" strokeWidth=".35"/><circle aria-label="Вращение выделения" cx={(box.minX+box.maxX)/2} cy={box.minY-24/pixelScale} r={handle/2} fill="white" stroke="#237a35" strokeWidth=".4" onPointerDown={e=>begin(e,"rotate")}/></>}
      {(tool==="scale"||tool==="warp")&&[{x:box.minX,y:box.minY},{x:box.maxX,y:box.minY},{x:box.maxX,y:box.maxY},{x:box.minX,y:box.maxY}].map((p,i)=><rect key={i} data-scene-handle={i} aria-label={`${tool==="warp"?"Warp":"Масштаб"} · угол ${i+1}`} x={p.x-handle/2} y={p.y-handle/2} width={handle} height={handle} fill={tool==="warp"?"#e8f5eb":"white"} stroke="#237a35" strokeWidth=".4" onPointerDown={e=>begin(e,tool,selected,i)}/>)}
    </g>}
    {marquee&&<rect x={Math.min(marquee.a.x,marquee.b.x)} y={Math.min(marquee.a.y,marquee.b.y)} width={Math.abs(marquee.a.x-marquee.b.x)} height={Math.abs(marquee.a.y-marquee.b.y)} fill="#237a351a" stroke="#237a35" strokeWidth=".3" pointerEvents="none"/>}
  </svg>;
}
