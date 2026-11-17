import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';

/** Horizontal reference lines only: model elevations, not implied room slabs. */
export function createFloorGuidesLayer(scene,navigation){
 const owned=[],levels=[];
 let ready=false,enabled=false,floor='all';
 const representative=navigation.levels.filter(l=>/^Level_0[1-5]$/.test(l.id));
 function show(){
  if(!ready)return;
  for(const {mesh,id} of levels)mesh.visible=enabled&&(floor==='all'||floor===id);
 }
 return {
  init(bounds){
   if(ready||!bounds||bounds.length!==6||!bounds.every(Number.isFinite))return;
   const [x0,,z0,x1,,z1]=bounds;
   for(const level of representative){
    const y=level.elevation+.14,dx=Math.max(1,(x1-x0)*.012),dz=Math.max(1,(z1-z0)*.012);
    const a=x0-dx,b=x1+dx,c=z0-dz,d=z1+dz;
    const positions=[a,y,c,b,y,c,b,y,c,b,y,d,b,y,d,a,y,d,a,y,d,a,y,c];
    const geometry=new ReadableGeometry(scene,{primitive:'lines',positions,indices:[0,1,2,3,4,5,6,7]});
    const rgb=[.32,.65,.81];
    const material=new PhongMaterial(scene,{diffuse:rgb,emissive:rgb,ambient:[.15,.34,.42],lineWidth:2});
    const mesh=new Mesh(scene,{geometry,material,pickable:false,collidable:false,clippable:false,isObject:false,visible:false});
    levels.push({mesh,id:level.id});owned.push(mesh,material,geometry);
   }
   ready=true;show();
  },
  update(mode,whichFloor,showGuides=true){enabled=mode==='xray'&&!!showGuides;floor=whichFloor||'all';show()},
  destroy(){for(const item of owned)item.destroy();owned.length=0;levels.length=0}
 };
}
