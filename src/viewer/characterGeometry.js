/**
 * Small procedural rounded mannequin geometry for the xeokit BIM viewer.
 * Silhouette-only: no hair, face, clothes, lapels or external model assets.
 * Materials and animation are managed by occupantLayer.js.
 */
export function loftedPart(rings,segments=14){
 if(!Array.isArray(rings)||rings.length<2||!Number.isInteger(segments)||segments<5)throw Error('Bad low-poly profile');
 const triangles=[];
 const position=(ring,i)=>{
  const angle=i/segments*Math.PI*2;
  return [(ring.x||0)+Math.cos(angle)*ring.rx,ring.y,(ring.z||0)+Math.sin(angle)*ring.rz];
 };
 for(let layer=0;layer<rings.length-1;layer++){
  for(let side=0;side<segments;side++){
   const a=position(rings[layer],side),b=position(rings[layer],side+1);
   const c=position(rings[layer+1],side),d=position(rings[layer+1],side+1);
   triangles.push([a,c,b],[b,c,d]);
  }
 }
 const cap=(ring,upper)=>{
  const center=[ring.x||0,ring.y,ring.z||0];
  for(let side=0;side<segments;side++){
   const a=position(ring,side),b=position(ring,side+1);
   triangles.push(upper?[center,b,a]:[center,a,b]);
  }
 };
 cap(rings[0],false);cap(rings.at(-1),true);
 const positions=[],normals=[],indices=[];
 for(const [a,b,c] of triangles){
  const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
  const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const len=Math.hypot(...normal)||1;
  const index=positions.length/3;
  for(const vertex of [a,b,c]){
   positions.push(...vertex);
   normals.push(...normal.map(x=>x/len));
  }
  indices.push(index,index+1,index+2);
 }
 return {primitive:'triangles',positions,normals,indices};
}

/**
 * Part geometry is centred on each mesh origin.
 * Rounded ends eliminate the previous stick/segment look.
 * Units are metres; proportions intentionally resemble the user's
 * simple, soft-edged mannequin references rather than office workers.
 */
export const CHARACTER_PROFILES={
 torso:[
  {y:-.34,rx:.080,rz:.065},
  {y:-.318,rx:.153,rz:.117},
  {y:-.266,rx:.191,rz:.139},
  {y:-.13,rx:.201,rz:.151},
  {y:.12,rx:.228,rz:.162},
  {y:.26,rx:.236,rz:.158},
  {y:.324,rx:.164,rz:.117},
  {y:.344,rx:.074,rz:.054}
 ],
 arm:[
  {y:-.305,rx:.018,rz:.018},
  {y:-.290,rx:.057,rz:.061},
  {y:-.255,rx:.084,rz:.083},
  {y:.00,rx:.096,rz:.091},
  {y:.247,rx:.089,rz:.085},
  {y:.292,rx:.059,rz:.061},
  {y:.309,rx:.018,rz:.018}
 ],
 leg:[
  {y:-.379,rx:.017,rz:.017},
  {y:-.361,rx:.061,rz:.074},
  {y:-.325,rx:.094,rz:.104},
  {y:.03,rx:.105,rz:.112},
  {y:.310,rx:.106,rz:.111},
  {y:.364,rx:.073,rz:.080},
  {y:.386,rx:.018,rz:.020}
 ]
};
export function characterProfileGeometry(){
 return Object.fromEntries(Object.entries(CHARACTER_PROFILES).map(([name,profile])=>[name,loftedPart(profile,14)]));
}
