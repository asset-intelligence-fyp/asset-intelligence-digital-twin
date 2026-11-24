import {Mesh,ReadableGeometry,PhongMaterial,buildBoxGeometry,buildSphereGeometry} from '@xeokit/xeokit-sdk';
import {makeSiteLayout,buildGrassFacets,buildPavedPaths,buildFacetedFrustum} from './siteLandscapeMath.js';

/**
 * Lightweight conceptual low-poly landscaping around the FYP BIM asset.
 *
 * This is a display-only layer: no scene object registration, picking,
 * collisions, IFC geometry, sensor state, simulator data or camera changes.
 * It remains visible only in solid whole-building mode as before.
 *
 * The walkways are actual 3D paved surfaces with exposed sidewalls; their
 * finished level sits 220 mm above the turf. A single unioned paver grid
 * prevents the crossing paths or terrain surface from z-fighting.
 */
export function createSiteLandscapeLayer(scene){
 const meshes=[],resources=[];
 const own=x=>(resources.push(x),x);
 const box=own(new ReadableGeometry(scene,buildBoxGeometry({xSize:1,ySize:1,zSize:1})));
 const crown=own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:8,heightSegments:6})));
 const trunkGeometry=own(new ReadableGeometry(scene,buildFacetedFrustum(.94,.59,1,7)));
 const branchGeometry=own(new ReadableGeometry(scene,buildFacetedFrustum(.8,.35,1,6)));
 const coneGeometry=own(new ReadableGeometry(scene,buildFacetedFrustum(1,.035,1,7)));
 const shadeDisc=own(new ReadableGeometry(scene,buildFacetedFrustum(1,1,.015,12)));
 const mat=(rgb,{glow=.07,alpha=1,shininess=4}={})=>own(new PhongMaterial(scene,{
  diffuse:rgb,ambient:rgb.map(v=>v*.63),emissive:rgb.map(v=>v*glow),
  specular:[.055,.055,.055],shininess,backfaces:true,
  alpha,alphaMode:alpha<1?'blend':'opaque'
 }));
 const turfColours=[
  [.38,.64,.30],[.43,.69,.34],[.34,.59,.29],
  [.41,.65,.32],[.46,.70,.37]
 ].map(rgb=>mat(rgb,{glow:.085}));
 const grassEdge=mat([.27,.46,.24]);
 const pathFoundation=mat([.68,.69,.65]);
 const stoneColours=[
  [.89,.88,.82],[.85,.85,.81],[.92,.90,.85]
 ].map(rgb=>mat(rgb,{glow:.055}));
 const curbStone=mat([.67,.69,.66]);
 const trunk=mat([.47,.32,.22]),trunkLight=mat([.54,.37,.25]);
 const leaves=[
  [.31,.55,.29],[.42,.66,.32],[.54,.72,.35],
  [.25,.46,.29],[.37,.61,.34],[.60,.76,.41],
  [.27,.52,.35],[.48,.68,.37]
 ].map(rgb=>mat(rgb,{glow:.075}));
 const treeShade=mat([.16,.31,.18],{glow:0,alpha:.19});
 const benchWood=mat([.64,.43,.29]),benchSupport=mat([.38,.41,.39]);
 const make=(shape,material,position=[0,0,0],scale=[1,1,1],rotation=[0,0,0])=>{
  const mesh=new Mesh(scene,{
   geometry:shape,material,position,scale,rotation,
   pickable:false,collidable:false,clippable:false,isObject:false,
   visible:false,edges:false,occluder:false
  });
  meshes.push(mesh);
  return mesh;
 };
 const useGeometry=data=>own(new ReadableGeometry(scene,data));
 let ready=false,active=false;
 function plantBroadleaf(t,y){
  const h=t.height,spread=t.spread,variation=t.variant;
  // Angular branches are visible between the trunk and the clustered crown.
  make(trunkGeometry,variation%2?trunk:trunkLight,
   [t.x,y+h*.285,t.z],[.19,h*.57,.18],[0,t.yaw,0]);
  for(const side of [-1,1]){
   make(branchGeometry,trunk,[t.x+side*spread*.22,y+h*.62,t.z],
    [.085,h*.35,.08],[0,t.yaw,side*24]);
  }
  const c=y+h*.82;
  const clusters=[
   {x:0,y:0,z:0,s:[1.02,.79,.98],m:0},
   {x:-.72,y:-.20,z:.04,s:[.77,.64,.74],m:1},
   {x:.71,y:-.14,z:-.08,s:[.81,.69,.78],m:2},
   {x:.11,y:.36,z:-.40,s:[.72,.61,.65],m:3},
   {x:-.15,y:.19,z:.62,s:[.69,.56,.68],m:4},
   {x:.45,y:.35,z:.38,s:[.56,.57,.58],m:5}
  ];
  for(const shape of clusters){
   const colour=leaves[(variation*2+shape.m)%leaves.length];
   const offset=spread;
   make(crown,colour,
    [t.x+shape.x*offset,c+shape.y*offset,t.z+shape.z*offset],
    [spread*shape.s[0],spread*shape.s[1],spread*shape.s[2]],
    [0,t.yaw+shape.m*27,0]);
  }
 }
 function plantPine(t,y){
  const h=t.height;
  make(trunkGeometry,trunk,[t.x,y+h*.36,t.z],[.12,h*.72,.12]);
  // Three overlapping, 7-sided tapered tiers form a recognisable pine.
  for(const [i,factor] of [[0,.46],[1,.33],[2,.25]]){
   const center=[.49,.68,.84][i],radius=t.spread*[1,.79,.56][i];
   make(coneGeometry,leaves[[0,3,6][i]+t.variant%2],
    [t.x,y+h*center,t.z],[radius,h*factor,radius],[0,t.yaw+i*14,0]);
  }
 }
 function plantSlender(t,y){
  const h=t.height;
  make(trunkGeometry,trunkLight,[t.x,y+h*.36,t.z],[.14,h*.72,.14]);
  for(const [i,offset] of [[0,-.18],[1,.12],[2,.36]]){
   make(crown,leaves[(t.variant+i+3)%leaves.length],
    [t.x+Math.sin(i*2.1)*.15,y+h*(.70+offset*.28),t.z+Math.cos(i*2.1)*.12],
    [t.spread*.65,t.spread*(.87-i*.07),t.spread*.57],[0,t.yaw+i*27,0]);
  }
 }
 function bench(x,z,y,rotation=0){
  // Small low-poly campus benches are intentionally decorative.
  const makeSeat=(at,scale,material,rot=[0,rotation,0])=>make(box,material,at,scale,rot);
  makeSeat([x,y+.51,z],[1.75,.13,.52],benchWood);
  makeSeat([x,y+.81,z+.22],[1.75,.51,.12],benchWood);
  for(const dx of [-.65,.65])makeSeat([x+dx,y+.27,z],[.11,.51,.35],benchSupport);
 }
 return {
  init(bounds){
   if(ready)return;
   const layout=makeSiteLayout(Array.from(bounds||[]));
   if(!layout)return;
   const [west,north,east,south]=layout.bounds;
   const groundWidth=east-west,groundDepth=south-north;
   const centerX=(west+east)/2,centerZ=(north+south)/2;
   // A thin, darker side rim gives the terrain a deliberate modelled edge.
   make(box,grassEdge,[centerX,layout.grassY-.15,centerZ],
    [groundWidth,.30,groundDepth]);
   for(const [i,data] of buildGrassFacets(layout).entries()){
    if(data.indices.length)make(useGeometry(data),turfColours[i]);
   }
   const paving=buildPavedPaths(layout);
   if(paving.under.indices.length)make(useGeometry(paving.under),pathFoundation);
   if(paving.curbs.indices.length)make(useGeometry(paving.curbs),curbStone);
   for(const [i,data] of paving.stone.entries())
    if(data.indices.length)make(useGeometry(data),stoneColours[i]);
   for(const tree of layout.trees){
    const y=layout.grassY;
    // Light pooled ground shadow adds depth without costly dynamic lighting.
    make(shadeDisc,treeShade,[tree.x+.36,y+.038,tree.z+.29],
     [tree.spread*1.26,1,tree.spread*.86]);
    if(tree.kind==='pine')plantPine(tree,y);
    else if(tree.kind==='slender')plantSlender(tree,y);
    else plantBroadleaf(tree,y);
   }
   const [x0,,z0,x1,,z1]=bounds;
   const front=z1+layout.reach*.85;
   bench((x0+x1)/2-(x1-x0)*.23,front,layout.grassY);
   bench((x0+x1)/2+(x1-x0)*.20,front,layout.grassY);
   ready=true;
   for(const mesh of meshes)mesh.visible=active;
  },
  setVisible(value){
   active=!!value;
   if(ready)for(const mesh of meshes)mesh.visible=active;
  },
  destroy(){
   for(const mesh of meshes)mesh.destroy();
   for(const resource of resources)resource.destroy();
   meshes.length=0;resources.length=0;
  }
 };
}
