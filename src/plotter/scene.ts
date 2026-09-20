import { bounds, type Point, type SceneObject, type Stroke } from "./workshop";
export type SceneTool = "move" | "rotate" | "scale" | "warp" | "pan";
export function mapSceneObjects(objects: SceneObject[], ids: string[], map: (point: Point) => Point) {
  const selected = new Set(ids);
  return objects.map(object => selected.has(object.id) ? { ...object, strokes: object.strokes.map(stroke => {
    const result = stroke.map(map) as Stroke;
    if (stroke.pressure !== undefined) result.pressure = stroke.pressure;
    if (stroke.feedRate !== undefined) result.feedRate = stroke.feedRate;
    return result;
  }) } : object);
}
export function selectionBounds(objects: SceneObject[], ids: string[]) {
  return bounds(objects.filter(o=>ids.includes(o.id)).flatMap(o=>o.strokes));
}
export function warpPoint(point: Point, box: ReturnType<typeof bounds>, corners: Point[]) {
  const u = box.width > 1e-6 ? (point.x-box.minX)/box.width : .5;
  const v = box.height > 1e-6 ? (point.y-box.minY)/box.height : .5;
  const weights = [(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];
  return corners.reduce((p,c,i)=>({x:p.x+c.x*weights[i],y:p.y+c.y*weights[i]}),{x:0,y:0});
}
