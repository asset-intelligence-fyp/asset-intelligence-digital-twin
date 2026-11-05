import {Viewer,XKTLoaderPlugin,Mesh,ReadableGeometry,PhongMaterial,buildSphereGeometry} from '@xeokit/xeokit-sdk';
import navigation from '../../shared/modelNavigation.json';

/** Isolated illustration: never modifies sensor state, mappings or the monitoring viewer. */
export function createPresentationViewer(canvas,{onReady,onError}){
 const viewer=new Viewer({canvasId:canvas.id,transparent:true,preserveDrawingBuffer:true,antialias:true});
 const scene=viewer.scene,loader=new XKTLoaderPlugin(viewer);
 loader.globalizeObjectIds=true;
 viewer.cameraControl.navMode='orbit';viewer.cameraControl.doublePickFlyTo=false;
 viewer.camera.perspective.fov=35;
 Object.assign(scene.xrayMaterial,{fill:true,fillColor:[.06,.48,.62],fillAlpha:.15,edges:true,edgeColor:[.12,.85,1],edgeAlpha:.9,edgeWidth:1,glowThrough:false});
 Object.assign(scene.edgeMaterial,{edgeColor:[.24,.33,.43],edgeAlpha:.55,edgeWidth:1});
 let dead=false,loaded=0,ready=false,progress=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,paired=true,elapsed=0,last=0,box=null,shift=0,span=1;
 let sourceIds=[],twinIds=[];const beacons=[];
 const src='/models/FYP_WholeBuilding_18Sensors.xkt';
 const source=loader.load({id:'poster_source',src,edges:true,globalizeObjectIds:true});
 const twin=loader.load({id:'poster_twin',src,edges:true,globalizeObjectIds:true});
 function layout(){
  if(!ready)return;
  const separation=paired?shift*progress:0;
  source.position=[-separation,0,0];twin.position=[separation,0,0];
  scene.setObjectsVisible(sourceIds,paired);
  scene.xrayMaterial.fillAlpha=paired?.18*progress:.18;
  scene.xrayMaterial.edgeAlpha=paired?.92*progress:.92;
  for(const b of beacons)b.mesh.position=[b.position[0]+separation,b.position[1],b.position[2]];
 }
 function fit(){
  if(!ready)return;
  // Keep a fixed final composition throughout extraction, with X horizontal on screen.
  const [x0,y0,z0,x1,y1,z1]=box,c=[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2];
  const width=x1-x0+(paired?2*shift:0),depth=z1-z0,height=y1-y0;
  const aspect=Math.max(.25,canvas.clientWidth/Math.max(1,canvas.clientHeight));
  const extent=Math.max(width/aspect,height*.88+depth*.6),distance=extent/(2*Math.tan(35*Math.PI/360))*1.24+depth*.45;
  viewer.camera.eye=[c[0]+distance*.04,c[1]+distance*.52,c[2]+distance*.86];
  viewer.camera.look=c;viewer.camera.up=[0,1,0];viewer.cameraControl.pivotPos=c;
 }
 function loadedModel(){
  if(dead||++loaded!==2)return;
  sourceIds=Object.keys(source.objects);twinIds=Object.keys(twin.objects);
  box=Array.from(scene.getAABB(sourceIds));span=Math.max(box[3]-box[0],box[5]-box[2]);shift=span*.58;
  scene.setObjectsColorized(sourceIds,[.58,.64,.71]);scene.setObjectsEdges(sourceIds,true);
  scene.setObjectsXRayed(twinIds,true);
  const geometry=new ReadableGeometry(scene,buildSphereGeometry({radius:Math.max(.22,span*.0038),widthSegments:12,heightSegments:8}));
  for(const [i,s] of navigation.sensors.entries()){
   const material=new PhongMaterial(scene,{diffuse:[.02,.8,1],emissive:[.08,.9,1],ambient:[.1,.9,1],alphaMode:'blend',alpha:.9,shininess:0});
   const mesh=new Mesh(scene,{geometry,material,position:s.position,pickable:false,clippable:false,collidable:false,isObject:false});
   beacons.push({mesh,material,position:s.position,index:i});
  }
  ready=true;if(!playing)progress=1;layout();fit();onReady();
 }
 source.on('loaded',loadedModel);twin.on('loaded',loadedModel);
 source.on('error',e=>!dead&&onError(String(e)));twin.on('error',e=>!dead&&onError(String(e)));
 const tick=scene.on('tick',()=>{
  const now=performance.now(),dt=last?Math.min(.06,(now-last)/1000):0;last=now;
  if(!ready)return;
  if(playing){elapsed+=dt;if(progress<1){progress=Math.min(1,progress+dt/4.5);layout()}}
  const smooth=progress*progress*(3-2*progress);
  if(progress<1&&paired){const separation=shift*smooth;source.position=[-separation,0,0];twin.position=[separation,0,0];for(const b of beacons)b.mesh.position=[b.position[0]+separation,b.position[1],b.position[2]]}
  for(const b of beacons){
   const pulse=playing?.5+.5*Math.sin(elapsed*2.1-b.index*.42):1;
   const visible=paired?smooth:1;b.mesh.visible=visible>.03;
   b.material.alpha=visible*(.3+.7*pulse);const size=1+pulse*.6;b.mesh.scale=[size,size,size];
  }
 });
 const resize=new ResizeObserver(()=>fit());resize.observe(canvas);
 return {
  setPlaying(value){playing=value;last=0},
  replay(){progress=0;elapsed=0;playing=true;layout();fit()},
  poster(){progress=1;playing=false;layout();for(const b of beacons){b.mesh.visible=true;b.material.alpha=1;b.mesh.scale=[1.6,1.6,1.6]}},
  setPaired(value){paired=value;progress=1;layout();fit()},
  fit,
  snapshot(){if(!ready)return null;return viewer.getSnapshot({format:'png',width:2400,height:1350})},
  destroy(){dead=true;resize.disconnect();scene.off(tick);viewer.destroy()},
 };
}
