/** Seeded rain segments outside the building's rectangular footprint, in world metres. */
export function rainGeometry(bounds,seed=7923,count=120){
 if(!bounds||bounds.length!==6||!Array.from(bounds).every(Number.isFinite))throw Error('Invalid exterior bounds');
 const [x0,y0,z0,x1,y1,z1]=bounds,w=x1-x0,d=z1-z0,h=y1-y0;
 if(w<=0||d<=0||h<=0)throw Error('Exterior bounds must have positive dimensions');
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 const positions=[],indices=[],span=h*1.75,cx=(x0+x1)/2,cz=(z0+z1)/2;
 for(let i=0;i<count;i++){
  const side=i%4,margin=2,rx=margin+random()*w*.35,rz=margin+random()*d*.45;
  const x=side===0?x0-rx:side===1?x1+rx:cx+(random()-.5)*w*1.7;
  const z=side===2?z0-rz:side===3?z1+rz:cz+(random()-.5)*d*1.9;
  const y=random()*span,n=positions.length/3;
  positions.push(x,y,z,x-.12,y-1.1,z);indices.push(n,n+1);
 }
 return {positions,indices,span,base:y0};
}
