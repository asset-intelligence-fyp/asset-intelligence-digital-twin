/** Geometry-based navigation helpers, shared with the model integrity tests. */
export const centerOf = a => [(a[0]+a[3])/2,(a[1]+a[4])/2,(a[2]+a[5])/2];
export function validBounds(a){return !!a&&a.length===6&&a.every(Number.isFinite)&&a.slice(0,3).every((v,i)=>v<=a[i+3]);}
export function storeyFor(meta,byId){
 const visited=new Set();
 while(meta&&!visited.has(meta.id)){
  visited.add(meta.id);if(meta.type==='IfcBuildingStorey')return meta.name;
  meta=typeof meta.parent==='string'?byId[meta.parent]:meta.parent;
 }
 return null;
}
export function floorBounds(a,level){
 if(!validBounds(a))return null;
 if(!level)return Array.from(a);
 const lower=level.elevation-.25,upper=level.ceiling-.08;
 return [a[0],lower,a[2],a[3],Math.max(lower+.2,upper),a[5]];
}
export function frameBounds(a,aspect=1,view='orbit'){
 if(!validBounds(a))return null;
 const look=centerOf(a),width=Math.max(.5,a[3]-a[0]),depth=Math.max(.5,a[5]-a[2]),height=Math.max(.5,a[4]-a[1]);
 const scale=Math.max(depth,width/Math.max(.25,aspect))*1.2;
 if(view==='plan')return {eye:[look[0],look[1]+Math.max(width,depth)*2,look[2]],look,up:[0,0,-1],projection:'ortho',orthoScale:scale};
 const radius=Math.hypot(width,height,depth)/2;
 const distance=radius/Math.sin(Math.atan(Math.tan(35*Math.PI/360)*Math.min(1,Math.max(.25,aspect))))*1.1;
 const direction=[.62,.52,.59],norm=Math.hypot(...direction);
 return {eye:look.map((v,i)=>v+direction[i]/norm*distance),look,up:[0,1,0],projection:'perspective'};
}
export function frameSensor(sensor,aspect=1,view='orbit'){
 if(!sensor?.position?.every(Number.isFinite))return null;
 const r=sensor.roomAabb;
 const span=validBounds(r)?Math.max(r[3]-r[0],r[5]-r[2]):9;
 // Keep the actual marker at the centre while retaining a little room context.
 const radius=Math.min(9,Math.max(4,span*.42)),p=sensor.position;
 return frameBounds([p[0]-radius,p[1]-2,p[2]-radius,p[0]+radius,p[1]+2,p[2]+radius],aspect,view);
}
export function layoutPins(pins,width,height){
 const placed=[],boxWidth=Math.min(184,Math.max(120,width*.36)),boxHeight=45;
 for(const pin of [...pins].sort((a,b)=>Number(b.selected)-Number(a.selected)||a.index-b.index)){
  if(!Number.isFinite(pin.anchorX)||!Number.isFinite(pin.anchorY)||pin.anchorX<0||pin.anchorY<0||pin.anchorX>width||pin.anchorY>height)continue;
  for(let i=0;i<100;i++){
   const ring=Math.ceil(i/8),angle=(i%8)*Math.PI/4;
   const x=Math.max(boxWidth/2+10,Math.min(width-boxWidth/2-10,pin.anchorX+Math.cos(angle)*ring*80));
   const y=Math.max(158,Math.min(height-125,pin.anchorY+Math.sin(angle)*ring*56));
   if(!placed.some(p=>Math.abs(p.x-x)<boxWidth+7&&Math.abs(p.y-y)<boxHeight+8)){
    placed.push({...pin,x:Math.round(x),y:Math.round(y),width:boxWidth});break;
   }
  }
 }
 return placed;
}
