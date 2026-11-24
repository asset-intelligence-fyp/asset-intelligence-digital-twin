/**
 * Deterministic, conceptual low-poly site geometry.
 *
 * This module has no xeokit dependencies so its paths, clearance and mesh
 * geometry can be regression tested in Node. None of the shapes represent
 * measured landscaping, nor may they be registered as IFC objects.
 */
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const fract=x=>x-Math.floor(x);
const noise=(a,b,salt=0)=>fract(Math.sin(a*127.1+b*311.7+salt*74.7)*43758.5453);
const rad=d=>d*Math.PI/180;
export function segmentDistance(x,z,a,b){
 const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
 const t=length>0?clamp(((x-a[0])*dx+(z-a[1])*dz)/length,0,1):0;
 return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
export function pathDistance(x,z,paths){
 let closest=Infinity;
 for(const path of paths)for(let i=1;i<path.points.length;i++)
  closest=Math.min(closest,segmentDistance(x,z,path.points[i-1],path.points[i])-path.width/2);
 return closest;
}
export function makeSiteLayout(bounds){
 if(!bounds||bounds.length!==6||!bounds.every(Number.isFinite))return null;
 const [x0,y0,z0,x1,,z1]=bounds,w=x1-x0,d=z1-z0;
 if(w<=.5||d<=.5)return null;
 const reach=Math.max(12,Math.max(w,d)*.20);
 const cx=(x0+x1)/2,cz=(z0+z1)/2;
 const west=x0-reach*1.47,east=x1+reach*1.47,north=z0-reach*1.47,south=z1+reach*1.47;
 // The grass is a deliberately thin site model below the IFC basement.
 // Top of the pavers is 220 mm above this plane, with visible stone sides.
 const grassY=y0-.88,walkwayY=grassY+.22;
 const width=clamp(reach*.18,2.25,3.35);
 const paths=[
  {name:'front promenade',width,points:[[west+reach*.12,z1+reach*.50],[east-reach*.12,z1+reach*.50]]},
  {name:'rear promenade',width:width*.82,points:[[west+reach*.25,z0-reach*.54],[east-reach*.25,z0-reach*.54]]},
  {name:'entrance approach',width:width*1.04,points:[
   [cx-w*.16,z1+reach*.15],[cx-w*.16,z1+reach*.53],[cx-w*.05,south-reach*.08]]},
  {name:'side walk',width:width*.82,points:[
   [x0-reach*.54,north+reach*.12],[x0-reach*.54,z1+reach*.50],[x0-reach*.54,south-reach*.12]]}
 ];
 const candidates=[];
 for(let i=0;i<7;i++){
  const x=x0+(w*(i+.5)/7);
  candidates.push([x,z0-reach*(.88+(i%2)*.10)]);
  candidates.push([x,z1+reach*(.91+(i%3)*.08)]);
 }
 for(let i=0;i<4;i++){
  const z=z0+d*(i+.5)/4;
  candidates.push([x0-reach*.98,z]);
  candidates.push([x1+reach*(.92+(i%2)*.06),z]);
 }
 for(let i=0;i<5;i++)candidates.push([west+reach*.32+i*(east-west-reach*.64)/4,south-reach*.35]);
 const trees=[];
 for(const [i,[baseX,baseZ]] of candidates.entries()){
  const x=baseX+(noise(i,1)-.5)*1.35,z=baseZ+(noise(i,2)-.5)*1.35;
  if(x<west+2||x>east-2||z<north+2||z>south-2)continue;
  if(x>x0-2&&x<x1+2&&z>z0-2&&z<z1+2)continue;
  if(pathDistance(x,z,paths)<2.25)continue;
  if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<3.1))continue;
  trees.push({x,z,kind:i%5===2?'pine':i%7===5?'slender':'broadleaf',
   height:3.7+(i%4)*.44,spread:1.0+(i%3)*.15,variant:i%4,
   yaw:noise(i,7)*360});
 }
 return {bounds:[west,north,east,south],building:[x0,z0,x1,z1],
  grassY,walkwayY,paths,trees,reach,width};
}
function appendTriangle(mesh,a,b,c){
 const offset=mesh.positions.length/3;
 for(const v of [a,b,c]){mesh.positions.push(...v);mesh.normals.push(0,1,0)}
 mesh.indices.push(offset,offset+1,offset+2);
}
const geometry=()=>({primitive:'triangles',positions:[],normals:[],indices:[]});
const addQuad=(mesh,a,b,c,d)=>{appendTriangle(mesh,a,b,c);appendTriangle(mesh,a,c,d)};
export function buildGrassFacets(layout,{columns=19,rows=15}={}){
 const [x0,z0,x1,z1]=layout.bounds,dx=(x1-x0)/columns,dz=(z1-z0)/rows;
 const points=[];
 for(let j=0;j<=rows;j++){
  const line=[];
  for(let i=0;i<=columns;i++){
   const x=x0+dx*i+(i===0||i===columns?0:(noise(i,j,3)-.5)*dx*.30);
   const z=z0+dz*j+(j===0||j===rows?0:(noise(i,j,4)-.5)*dz*.30);
   const y=layout.grassY+.014+(noise(i,j,5)-.5)*.025;
   line.push([x,y,z]);
  }
  points.push(line);
 }
 const parts=Array.from({length:5},geometry);
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  const a=points[j][i],b=points[j][i+1],c=points[j+1][i+1],d=points[j+1][i];
  appendTriangle(parts[Math.floor(noise(i,j,7)*5)],a,c,b);
  appendTriangle(parts[Math.floor(noise(i,j,8)*5)],a,d,c);
 }
 return parts;
}
const side=(mesh,a,b,y0,y1)=>{
 // Backfaces render both sides, so winding does not determine visibility.
 const p=[a[0],y1,a[1]],q=[b[0],y1,b[1]],r=[b[0],y0,b[1]],s=[a[0],y0,a[1]];
 addQuad(mesh,p,q,r,s);
};
/** Pavers form a unioned grid: crossings are never overlapping boxes.
 * Stone tops sit 220 mm above grass, with sides reaching to the turf.
 * A slight inset leaves narrow, darker joints between individual pavers.
 */
export function buildPavedPaths(layout,{tileSize=.80}={}){
 const [x0,z0,x1,z1]=layout.bounds;
 const nx=Math.max(1,Math.min(360,Math.ceil((x1-x0)/tileSize)));
 const nz=Math.max(1,Math.min(360,Math.ceil((z1-z0)/tileSize)));
 const dx=(x1-x0)/nx,dz=(z1-z0)/nz,mask=new Uint8Array(nx*nz);
 const [bx0,bz0,bx1,bz1]=layout.building;
 const at=(i,j)=>j*nx+i;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const x=x0+(i+.5)*dx,z=z0+(j+.5)*dz;
  if(x>=bx0-.12&&x<=bx1+.12&&z>=bz0-.12&&z<=bz1+.12)continue;
  if(pathDistance(x,z,layout.paths)<=0)mask[at(i,j)]=1;
 }
 const under=geometry(),stone=Array.from({length:3},geometry),curbs=geometry();
 const top=layout.walkwayY,base=layout.grassY-.004,join=top-.017;
 let count=0,sideCount=0;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  if(!mask[at(i,j)])continue;
  count++;
  const a=x0+i*dx,b=a+dx,c=z0+j*dz,d=c+dz;
  addQuad(under,[a,join,c],[a,join,d],[b,join,d],[b,join,c]);
  const gap=Math.min(.018,dx*.025,dz*.025);
  const y=top+.004+(noise(i,j,10)-.5)*.002;
  addQuad(stone[Math.floor(noise(i,j,9)*3)],
   [a+gap,y,c+gap],[a+gap,y,d-gap],[b-gap,y,d-gap],[b-gap,y,c+gap]);
  for(const [di,dj,from,to] of [
   [-1,0,[a,c],[a,d]],[1,0,[b,d],[b,c]],
   [0,-1,[b,c],[a,c]],[0,1,[a,d],[b,d]]
  ]){
   const ix=i+di,iz=j+dj;
   if(ix>=0&&iz>=0&&ix<nx&&iz<nz&&mask[at(ix,iz)])continue;
   side(curbs,from,to,base,top);sideCount++;
  }
 }
 return {under,stone,curbs,tileCount:count,edgeCount:sideCount,
  grassTop:layout.grassY+.027,pathTop:top,base,
  tileSpacing:[dx,dz]};
}
/** A reusable angular trunk or conifer tier centred at the origin. */
export function buildFacetedFrustum(bottom=1,top=.2,height=1,sides=7){
 const g=geometry();
 for(let i=0;i<sides;i++){
  const a=i*2*Math.PI/sides,b=(i+1)*2*Math.PI/sides;
  const lowerA=[Math.cos(a)*bottom,-height/2,Math.sin(a)*bottom];
  const lowerB=[Math.cos(b)*bottom,-height/2,Math.sin(b)*bottom];
  const upperA=[Math.cos(a)*top,height/2,Math.sin(a)*top];
  const upperB=[Math.cos(b)*top,height/2,Math.sin(b)*top];
  appendTriangle(g,lowerA,upperA,upperB);
  appendTriangle(g,lowerA,upperB,lowerB);
  appendTriangle(g,[0,height/2,0],upperB,upperA);
  appendTriangle(g,[0,-height/2,0],lowerA,lowerB);
 }
 return g;
}
