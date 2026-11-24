/**
 * Build heatmap surfaces constrained by the real IFC wall/window envelope.
 *
 * An IFC slab AABB is only a rectangle around a mesh. Using it directly
 * produces huge horizontal sheets in an irregular building. This module
 * derives the outer envelope from wall, glazing and door world AABBs, clips
 * every heatmap cell against that envelope, and (when exterior walls form
 * a sufficiently closed loop) removes exterior voids via flood fill.
 *
 * AABBs are an approximation, not the original wall polygon topology.
 * The inset keeps the colour inside the boundary rather than projecting
 * beyond the facade. We never invent measurements in non-monitored floors.
 */
const valid=b=>Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)
 &&b[3]>b[0]+.02&&b[5]>b[2]+.02;
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const insideEdge=(a,b,p,inset)=>cross(a,b,p)>=inset*Math.hypot(b.x-a.x,b.z-a.z)-1e-7;

export function facadeHull(boxes){
 const points=[];
 for(const b of boxes||[]){
  if(!valid(b))continue;
  points.push({x:b[0],z:b[2]},{x:b[0],z:b[5]},
   {x:b[3],z:b[2]},{x:b[3],z:b[5]});
 }
 if(points.length<3)return [];
 points.sort((a,b)=>a.x-b.x||a.z-b.z);
 const unique=points.filter((p,i)=>!i||Math.abs(p.x-points[i-1].x)>1e-7||Math.abs(p.z-points[i-1].z)>1e-7);
 if(unique.length<3)return [];
 const lower=[],upper=[];
 for(const p of unique){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
 for(let i=unique.length-1;i>=0;i--){
  const p=unique[i];
  while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();
  upper.push(p);
 }
 const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
 return hull.length>=3?hull:[];
}

/** Clip a clockwise or counterclockwise subject to a CCW facade polygon. */
export function clipToFacade(subject,hull,inset=.35){
 if(hull.length<3)return [];
 let polygon=subject.map(p=>({x:p.x,z:p.z}));
 for(let i=0;i<hull.length;i++){
  if(!polygon.length)break;
  const a=hull[i],b=hull[(i+1)%hull.length],next=[];
  let prev=polygon.at(-1),wasIn=insideEdge(a,b,prev,inset);
  for(const current of polygon){
   const isIn=insideEdge(a,b,current,inset);
   if(isIn!==wasIn){
    const dx=current.x-prev.x,dz=current.z-prev.z;
    const edgeX=b.x-a.x,edgeZ=b.z-a.z;
    const denom=edgeX*dz-edgeZ*dx;
    if(Math.abs(denom)>1e-10){
     const target=inset*Math.hypot(edgeX,edgeZ);
     const t=Math.max(0,Math.min(1,(target-cross(a,b,prev))/denom));
     next.push({x:prev.x+t*dx,z:prev.z+t*dz});
    }
   }
   if(isIn)next.push(current);
   prev=current;wasIn=isIn;
  }
  polygon=next;
 }
 return polygon;
}

/**
 * The wall mask is only trusted when it actually encloses a nontrivial
 * portion of the envelope. Open façade exports otherwise use the clipped
 * hull alone, rather than accidentally making every floor disappear.
 */
export function enclosedCells(walls,minX,minZ,dx,dz,nx,nz,hull){
 const total=nx*nz,barrier=new Uint8Array(total),outside=new Uint8Array(total);
 const ix=(x)=>Math.floor((x-minX)/dx),iz=(z)=>Math.floor((z-minZ)/dz);
 const boundaryWalls=walls.filter(b=>{
  if(!valid(b))return false;
  const wx=b[3]-b[0],wz=b[5]-b[2];
  return Math.min(wx,wz)<2.5||Math.max(wx,wz)/Math.min(wx,wz)>3;
 });
 if(boundaryWalls.length<4)return null;
 // Dilate walls by half a cell: adjacent facade segments and door gaps
 // meet without widening the map outside the true wall line.
 const padding=Math.min(.80,Math.min(dx,dz)*.75);
 for(const box of boundaryWalls){
  const loX=Math.max(0,ix(box[0]-padding)),hiX=Math.min(nx-1,ix(box[3]+padding));
  const loZ=Math.max(0,iz(box[2]-padding)),hiZ=Math.min(nz-1,iz(box[5]+padding));
  for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++){
   const cx=minX+(x+.5)*dx,cz=minZ+(z+.5)*dz;
   if(cx>=box[0]-padding&&cx<=box[3]+padding&&cz>=box[2]-padding&&cz<=box[5]+padding)
    barrier[z*nx+x]=1;
  }
 }
 const queue=new Int32Array(total);
 let front=0,back=0;
 const add=(x,z)=>{
  if(x<0||z<0||x>=nx||z>=nz)return;
  const k=z*nx+x;if(barrier[k]||outside[k])return;
  outside[k]=1;queue[back++]=k;
 };
 for(let x=0;x<nx;x++){add(x,0);add(x,nz-1)}
 for(let z=0;z<nz;z++){add(0,z);add(nx-1,z)}
 while(front<back){
  const n=queue[front++],x=n%nx,z=Math.floor(n/nx);
  add(x-1,z);add(x+1,z);add(x,z-1);add(x,z+1);
 }
 let inside=0,inHull=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const cx=minX+(x+.5)*dx,cz=minZ+(z+.5)*dz;
  if(!clipToFacade([{x:cx-.01,z:cz-.01},{x:cx+.01,z:cz-.01},
   {x:cx+.01,z:cz+.01},{x:cx-.01,z:cz+.01}],hull,0).length)continue;
  inHull++;
  if(!outside[z*nx+x]&&!barrier[z*nx+x])inside++;
 }
 // A broken wall boundary can give tiny enclosed islands. In that case
 // fail open to the inset façade polygon, never the enormous slab AABB.
 if(inHull<8||inside/inHull<.12)return null;
 return {outside,barrier,nx,nz,inside,inHull};
}

/**
 * Build a floor-colour mesh that respects the façade, including concave
 * recesses when available from an enclosed wall raster.
 */
export function buildContainedFloorGrid(slabAabbs,wallAabbs,elevation,{
 cellSize=1.25,offset=.10,inset=.40
}={}){
 const empty={positions:[],normals:[],indices:[],cellCount:0,bounds:null,source:'no-facade'};
 const slabs=(slabAabbs||[]).filter(valid),walls=(wallAabbs||[]).filter(valid);
 if(!slabs.length||!walls.length||!Number.isFinite(elevation))return empty;
 const hull=facadeHull(walls);
 if(hull.length<3)return empty;
 const minX=Math.max(Math.min(...slabs.map(b=>b[0])),Math.min(...hull.map(p=>p.x)));
 const maxX=Math.min(Math.max(...slabs.map(b=>b[3])),Math.max(...hull.map(p=>p.x)));
 const minZ=Math.max(Math.min(...slabs.map(b=>b[2])),Math.min(...hull.map(p=>p.z)));
 const maxZ=Math.min(Math.max(...slabs.map(b=>b[5])),Math.max(...hull.map(p=>p.z)));
 if(maxX-minX<1||maxZ-minZ<1)return empty;
 const nx=Math.max(8,Math.min(120,Math.ceil((maxX-minX)/cellSize)));
 const nz=Math.max(8,Math.min(120,Math.ceil((maxZ-minZ)/cellSize)));
 const dx=(maxX-minX)/nx,dz=(maxZ-minZ)/nz;
 const enclosure=enclosedCells(walls,minX,minZ,dx,dz,nx,nz,hull);
 const y=elevation+offset,positions=[],normals=[],indices=[];
 let cells=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const x0=minX+x*dx,x1=x0+dx,z0=minZ+z*dz,z1=z0+dz;
  const mx=(x0+x1)/2,mz=(z0+z1)/2;
  if(!slabs.some(b=>mx>=b[0]&&mx<=b[3]&&mz>=b[2]&&mz<=b[5]))continue;
  const cell=clipToFacade([
   {x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}
  ],hull,inset);
  if(cell.length<3)continue;
  if(enclosure){
   const k=z*nx+x;
   if(enclosure.outside[k])continue;
   if(enclosure.barrier[k]){
    // Do not draw onto the outside half of the facade wall itself.
    // Internal partition walls may still be coloured on the floor plane.
    const exterior=x===0||z===0||x===nx-1||z===nz-1||
     [[x-1,z],[x+1,z],[x,z-1],[x,z+1]].some(([ax,az])=>
      ax>=0&&ax<nx&&az>=0&&az<nz&&enclosure.outside[az*nx+ax]);
    if(exterior)continue;
   }
  }
  for(let i=1;i<cell.length-1;i++){
   const a=cell[0],b=cell[i],c=cell[i+1];
   if(Math.abs(cross(a,b,c))<1e-7)continue;
   const id=positions.length/3;
   for(const p of [a,b,c]){positions.push(p.x,y,p.z);normals.push(0,1,0)}
   indices.push(id,id+1,id+2);
  }
  cells++;
 }
 return {positions,normals,indices,cellCount:cells,
  bounds:[minX,y,minZ,maxX,y,maxZ],source:enclosure?'wall-enclosed':'facade-hull'};
}
