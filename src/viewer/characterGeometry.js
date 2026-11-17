/**
 * Authored low-poly office-character geometry.
 *
 * Curved tapered surfaces (not box primitives) keep the silhouettes human-readable
 * without downloading models or requiring textures/skinned animation middleware.
 * Material / scene ownership stays with the caller.
 */
export function loftedPart(rings,segments=10){
 if(!Array.isArray(rings)||rings.length<2||!Number.isInteger(segments)||segments<5)throw Error('Bad low-poly profile');
 const v=[],tri=[];
 const point=(ring,step)=>{
  const angle=step/segments*Math.PI*2;
  return [(ring.x||0)+Math.cos(angle)*ring.rx,ring.y,(ring.z||0)+Math.sin(angle)*ring.rz];
 };
 for(let layer=0;layer<rings.length-1;layer++){
  for(let side=0;side<segments;side++){
   const a=point(rings[layer],side),b=point(rings[layer],side+1),
    c=point(rings[layer+1],side),d=point(rings[layer+1],side+1);
   tri.push([a,c,b],[b,c,d]);
  }
 }
 const cap=(ring,upper)=>{
  const center=[ring.x||0,ring.y,ring.z||0];
  for(let side=0;side<segments;side++){
   const a=point(ring,side),b=point(ring,side+1);
   tri.push(upper?[center,b,a]:[center,a,b]);
  }
 };
 cap(rings[0],false);cap(rings.at(-1),true);
 const positions=[],normals=[],indices=[];
 for(const [a,b,c] of tri){
  const u=b.map((x,i)=>x-a[i]),w=c.map((x,i)=>x-a[i]);
  const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
  const len=Math.hypot(...n)||1,normal=n.map(x=>x/len);
  const index=positions.length/3;
  for(const pt of [a,b,c]){positions.push(...pt);normals.push(...normal)}
  indices.push(index,index+1,index+2);
 }
 return {primitive:'triangles',positions,normals,indices};
}
export const CHARACTER_PROFILES={
 jacket:[
  {y:-.39,rx:.22,rz:.14},{y:-.21,rx:.24,rz:.16},
  {y:.12,rx:.27,rz:.17},{y:.31,rx:.29,rz:.17},{y:.39,rx:.185,rz:.12}
 ],
 blouse:[
  {y:-.39,rx:.185,rz:.14},{y:-.17,rx:.22,rz:.16},
  {y:.13,rx:.25,rz:.17},{y:.31,rx:.265,rz:.16},{y:.39,rx:.17,rz:.11}
 ],
 arm:[
  {y:-.34,rx:.078,rz:.082},{y:-.11,rx:.086,rz:.093},
  {y:.14,rx:.105,rz:.10},{y:.32,rx:.14,rz:.125}
 ],
 leg:[
  {y:-.32,rx:.072,rz:.095},{y:-.10,rx:.09,rz:.106},
  {y:.16,rx:.096,rz:.12},{y:.32,rx:.116,rz:.125}
 ],
 hair:[
  {y:-.13,rx:.20,rz:.21},{y:0,rx:.26,rz:.24},
  {y:.10,rx:.235,rz:.225},{y:.18,rx:.11,rz:.13},
  {y:.20,rx:.015,rz:.020}
 ],
 skirt:[
  {y:-.32,rx:.34,rz:.285},{y:-.15,rx:.31,rz:.26},
  {y:.14,rx:.21,rz:.16},{y:.26,rx:.21,rz:.155}
 ],
 nose:[
  {y:-.06,rx:.06,rz:.065},{y:.04,rx:.032,rz:.06},
  {y:.10,rx:.003,rz:.008}
 ],
 neck:[
  {y:-.09,rx:.077,rz:.078},{y:.08,rx:.083,rz:.083}
 ]
};
export function characterProfileGeometry(){
 return Object.fromEntries(Object.entries(CHARACTER_PROFILES).map(([k,profile])=>[k,loftedPart(profile,k==='nose'?6:9)]));
}
