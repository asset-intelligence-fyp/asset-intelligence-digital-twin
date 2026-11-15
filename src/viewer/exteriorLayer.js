import {rainGeometry} from './weatherMath.js';
import {Mesh,ReadableGeometry,PhongMaterial,buildBoxGeometry,buildSphereGeometry} from '@xeokit/xeokit-sdk';
/** Decorative environment in BIM world coordinates. Rain is excluded from the building footprint. */
export function createExteriorLayer(scene){
 const owned=[],clouds=[],rain=[];let ready=false,mode='clear',exterior=true,animate=true,last=0,elapsed=0;
 const own=x=>(owned.push(x),x);
 function material(colour,alpha=1){return own(new PhongMaterial(scene,{diffuse:colour,ambient:colour,emissive:colour.map(v=>v*.3),alpha,alphaMode:alpha<1?'blend':'opaque',backfaces:true,shininess:mode==='rain'?45:12}))}
 function mesh(geometry,mat,position,scale){return own(new Mesh(scene,{geometry,material:mat,position,scale,pickable:false,collidable:false,clippable:false,isObject:false}))}
 function apply(){if(!ready)return;for(const c of clouds)c.visible=exterior&&['cloudy','rain'].includes(mode);for(const r of rain)r.mesh.visible=exterior&&mode==='rain';}
 return {
  init(bounds){
   if(ready||!bounds||!Array.from(bounds).every(Number.isFinite))return;
   const [x0,y0,z0,x1,y1,z1]=bounds,w=x1-x0,d=z1-z0,h=y1-y0,cx=(x0+x1)/2,cz=(z0+z1)/2;
   const box=own(new ReadableGeometry(scene,buildBoxGeometry({xSize:1,ySize:1,zSize:1})));
   const base=mesh(box,material([.055,.075,.14]),[cx,y0-.7,cz],[w*.68,.35,d*.75]);
   const gridPositions=[],gridIndices=[];
   for(let i=-8;i<=8;i++){const add=(a,b)=>{const n=gridPositions.length/3;gridPositions.push(...a,...b);gridIndices.push(n,n+1)};add([cx-w*.7,y0-.32,cz+i*d/10],[cx+w*.7,y0-.32,cz+i*d/10]);add([cx+i*w/10,y0-.32,cz-d*.8],[cx+i*w/10,y0-.32,cz+d*.8]);}
   const grid=mesh(own(new ReadableGeometry(scene,{primitive:'lines',positions:gridPositions,indices:gridIndices})),material([.13,.19,.34]),[0,0,0],[1,1,1]);
   const sphere=own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:16,heightSegments:10})));
   const cloudMat=material([.28,.34,.47],.27);
   for(let i=0;i<7;i++)clouds.push(mesh(sphere,cloudMat,[cx+(i-3)*w*.18,y1+h*.35+(i%2)*3,cz+(i%3-1)*d*.42],[w*.23,h*.10,d*.22]));
   const rainMat=material([.52,.70,1],.56);
   for(let group=0;group<4;group++){
    const {positions,indices,span,base}=rainGeometry(bounds,7923+group*101);
    const geometry=own(new ReadableGeometry(scene,{primitive:'lines',positions,indices}));
    rain.push({mesh:mesh(geometry,rainMat,[0,base,0],[1,1,1]),span,base,offset:group*span/4});
   }
   ready=true;apply();
   this.base=base;this.grid=grid;
  },
  set(weather,showExterior=true,motion=true){mode=weather;exterior=showExterior;animate=motion;apply();if(this.base){this.base.visible=exterior;this.grid.visible=exterior}},
  tick(time){const dt=last?Math.min(.05,Math.max(0,(time-last)/1000)):0;last=time;if(!ready||!exterior||!animate)return;elapsed+=dt;for(const r of rain){if(mode==='rain')r.mesh.position=[0,r.base-((elapsed*12+r.offset)%r.span),0]}for(let i=0;i<clouds.length;i++){if(clouds[i].visible)clouds[i].rotation=[0,Math.sin(elapsed*.025+i)*3,0]}},
  destroy(){for(const c of [...owned].reverse())c.destroy();owned.length=0}
 };
}
