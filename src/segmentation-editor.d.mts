export type Region = { number:number|null; mark:'B'|'I'|null };
export type BoundaryLoop = { key?:number; vertices:number[]; closed:boolean };
export type EditableJaw = {
  positions:Float32Array; labels:Uint32Array; regions:Record<number,Region>;
  vertices:number[][]; faces:Uint32Array; centers:Float32Array; areas:Float64Array;
  edges:Map<string,{a:number;b:number;faces:number[]}>;
};
export function createEditableJaw(positions:Float32Array,labels:Uint16Array|Uint32Array):EditableJaw;
export function activeRegions(jaw:EditableJaw):Set<number>;
export function regionCenters(jaw:EditableJaw):{key:number;id:number|'S';mark:'B'|'I'|null;center:number[]}[];
export function renumber(jaw:EditableJaw,key:number,number:number):void;
export function setMark(jaw:EditableJaw,key:number,mark:'B'|'I'|'S'):void;
export function deleteRegion(jaw:EditableJaw,key:number):void;
export function insidePolygon(x:number,y:number,polygon:number[][]):boolean;
export function applyLasso(jaw:EditableJaw,key:number,polygon:number[][],subtract:boolean,project:(p:Float32Array)=>number[]):boolean;
export function boundaryLoops(jaw:EditableJaw,key:number):BoundaryLoop[];
export function prepareBoundaryControls(jaw:EditableJaw,loops?:BoundaryLoop[]):void;
export function controlIndices(jaw:EditableJaw,loop:BoundaryLoop):number[];
export function boundaryReplacement(jaw:EditableJaw,loop:BoundaryLoop,index:number,target:number[]):number[]|false;
export function moveBoundary(jaw:EditableJaw,key:number,loop:BoundaryLoop,index:number,target:number[],separate?:boolean):boolean;
export class EditSession {
  constructor(jaws:EditableJaw[]);
  undoStack:unknown[];redoStack:unknown[];
  lastChanges:{j:number;indices:Uint32Array;old:Uint32Array;next:Uint32Array;before:Record<number,Region>;after:Record<number,Region>}[];
  edit(action:()=>void):boolean;undo():void;redo():void;reset():void;
}
