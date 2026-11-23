/**
 * Shared procedural architectural-occupant geometry.
 *
 * Human-scale, deliberately low-poly silhouettes for the BIM viewer. The meshes
 * are authored as tapered, triangulated rings rather than box-shaped toys.
 * Flat normals, muted matte materials and small heads are intentional.
 *
 * No external GLB assets, texture downloads or skinned animation required.
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

/** Dimensions are in metres relative to each part's local origin. */
export const CHARACTER_PROFILES={
 // Narrower shoulders, subtle waist shaping and a tailored hem.
 jacket:[
  {y:-.37,rx:.205,rz:.127},{y:-.21,rx:.205,rz:.135},
  {y:-.02,rx:.210,rz:.141},{y:.21,rx:.249,rz:.156},
  {y:.33,rx:.253,rz:.151},{y:.365,rx:.130,rz:.099}
 ],
 // A relaxed collared top; not a triangular cartoon dress.
 blouse:[
  {y:-.36,rx:.195,rz:.132},{y:-.23,rx:.203,rz:.140},
  {y:.02,rx:.210,rz:.144},{y:.25,rx:.237,rz:.148},
  {y:.345,rx:.137,rz:.094}
 ],
 // A straight cardigan with a slightly longer, draped hem.
 cardigan:[
  {y:-.39,rx:.208,rz:.137},{y:-.26,rx:.215,rz:.145},
  {y:-.03,rx:.215,rz:.148},{y:.225,rx:.244,rz:.155},
  {y:.35,rx:.137,rz:.100}
 ],
 // A lengthened contemporary jacket for a fourth silhouette.
 longline:[
  {y:-.46,rx:.215,rz:.140},{y:-.35,rx:.222,rz:.146},
  {y:-.10,rx:.210,rz:.148},{y:.24,rx:.244,rz:.155},
  {y:.37,rx:.134,rz:.098}
 ],
 // Cylindrical tapered sleeves and legs; wrists/ankles stay slender.
 arm:[
  {y:-.31,rx:.061,rz:.070},{y:-.15,rx:.066,rz:.075},
  {y:.12,rx:.079,rz:.082},{y:.285,rx:.092,rz:.089}
 ],
 leg:[
  {y:-.335,rx:.077,rz:.086},{y:-.10,rx:.082,rz:.092},
  {y:.17,rx:.085,rz:.094},{y:.33,rx:.099,rz:.099}
 ],
 // Low-profile cap and three hair silhouettes, not helmet-like spheres.
 hairCrop:[
  {y:-.065,rx:.144,rz:.141},{y:-.003,rx:.173,rz:.159},
  {y:.078,rx:.164,rz:.153},{y:.125,rx:.092,rz:.092},
  {y:.142,rx:.020,rz:.020}
 ],
 hairSide:[
  {y:-.130,rx:.154,rz:.149},{y:-.075,rx:.165,rz:.161},
  {y:.03,rx:.169,rz:.158},{y:.115,rx:.107,rz:.098},
  {y:.14,rx:.014,rz:.016}
 ],
 hairTaper:[
  {y:-.095,rx:.137,rz:.141},{y:-.01,rx:.165,rz:.155},
  {y:.077,rx:.154,rz:.144},{y:.132,rx:.076,rz:.083},
  {y:.149,rx:.014,rz:.015}
 ],
 neck:[
  {y:-.066,rx:.063,rz:.066},{y:.064,rx:.068,rz:.070}
 ],
 // Two understated, contrasting jacket lapels; no cartoon badges/buttons.
 lapel:[
  {y:-.190,rx:.024,rz:.024},{y:-.045,rx:.029,rz:.025},
  {y:.115,rx:.037,rz:.027},{y:.180,rx:.018,rz:.020}
 ],
 collar:[
  {y:-.053,rx:.099,rz:.082},{y:.018,rx:.113,rz:.088},
  {y:.072,rx:.073,rz:.068}
 ]
};
export function characterProfileGeometry(){
 return Object.fromEntries(Object.entries(CHARACTER_PROFILES).map(([name,profile])=>[name,loftedPart(profile,name==='lapel'?7:10)]));
}
