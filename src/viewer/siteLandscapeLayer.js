import {Mesh,ReadableGeometry,PhongMaterial,buildBoxGeometry,buildSphereGeometry} from '@xeokit/xeokit-sdk';

/**
 * Non-IFC, intentionally stylized landscape context.
 * All planting and paths are clearly conceptual, and never become BIM objects.
 * We build only a bounded number of simple low-poly meshes for predictable GPU cost.
 */
export function createSiteLandscapeLayer(scene){
 const meshes=[],resources=[];
 const own=x=>(resources.push(x),x);
 const box=own(new ReadableGeometry(scene,buildBoxGeometry({xSize:1,ySize:1,zSize:1})));
 const foliage=own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:7,heightSegments:5})));
 const colour=(rgb,glow=.16)=>own(new PhongMaterial(scene,{
  diffuse:rgb,ambient:rgb.map(x=>x*.38),emissive:rgb.map(x=>x*glow),
  backfaces:true,shininess:11
 }));
 const ground=colour([.28,.48,.33]),grassAlt=colour([.34,.55,.38]);
 const pavement=colour([.72,.77,.76],.10),pathAccent=colour([.56,.65,.65],.10);
 const trunk=colour([.37,.30,.24]),leaf=colour([.20,.50,.34],.20),
  leafAlt=colour([.31,.59,.40],.20),leafSoft=colour([.43,.63,.43],.17);
 const benchWood=colour([.58,.39,.28]),benchFrame=colour([.20,.29,.31]);
 const make=(shape,mat,position,scale)=>{const mesh=new Mesh(scene,{
  geometry:shape,material:mat,position,scale,
  pickable:false,collidable:false,clippable:false,isObject:false,visible:false
 });meshes.push(mesh);return mesh;};
 let ready=false,active=false;
 return {
  init(bounds){
   if(ready||!bounds||bounds.length!==6||!bounds.every(Number.isFinite))return;
   const [x0,y0,z0,x1,y1,z1]=bounds;
   const w=x1-x0,d=z1-z0;
   if(w<=0||d<=0)return;
   const cx=(x0+x1)/2,cz=(z0+z1)/2;
   const reach=Math.max(12,Math.max(w,d)*.20),y=y0-.88;
   // Turf and paths outside actual model bounds; this geometry does not
   // assert the real project's landscape layout.
   make(box,ground,[cx,y-.14,cz],[w+reach*2.9,.25,d+reach*2.9]);
   const pathW=Math.min(5,Math.max(2.8,reach*.28));
   const offset=reach*.43;
   for(const z of [z0-offset,z1+offset]){
    make(box,pavement,[cx,y+.02,z],[w+offset*2,.095,pathW]);
    make(box,pathAccent,[cx,y+.075,z],[w+offset*2,.024,.24]);
   }
   for(const x of [x0-offset,x1+offset]){
    make(box,pavement,[x,y+.02,cz],[pathW,.095,d+offset*2]);
   }
   // Grass borders and a restrained planted edge, arranged well outside
   // the bounding rectangle rather than inventing exact IFC landscaping.
   for(const z of [z0-reach*.91,z1+reach*.91]){
    make(box,grassAlt,[cx,y+.005,z],[w+reach*1.5,.05,reach*.33]);
   }
   function tree(x,z,index){
    const height=3.5+(index%4)*.36,spread=1.3+(index%3)*.2;
    make(box,trunk,[x,y+.26+height*.37,z],[.34,height*.74,.33]);
    make(foliage,[leaf,leafAlt,leafSoft][index%3],[x,y+height+.42,z],[spread,1.38+(index%2)*.22,spread]);
    make(foliage,[leafAlt,leafSoft,leaf][index%3],[x-.44,y+height-.15,z+.34],[spread*.74,.85,spread*.74]);
   }
   let index=0;
   const nx=5,nz=3;
   for(let i=0;i<nx;i++){
    const x=x0+(w*(i+.5)/nx);
    tree(x,z0-reach*.94,index++);
    tree(x,z1+reach*.94,index++);
   }
   for(let j=0;j<nz;j++){
    const z=z0+(d*(j+.5)/nz);
    tree(x0-reach*.98,z,index++);
    tree(x1+reach*.98,z,index++);
   }
   // Benches are recognisable, subdued and entirely outside the IFC shell.
   function bench(x,z){
    make(box,benchWood,[x,y+.51,z],[1.75,.16,.55]);
    make(box,benchWood,[x,y+.88,z+.24],[1.75,.55,.14]);
    for(const dx of [-.65,.65])make(box,benchFrame,[x+dx,y+.28,z],[.12,.50,.37]);
   }
   bench(cx-w*.21,z1+reach*.64);
   bench(cx+w*.21,z1+reach*.64);
   ready=true;
   for(const m of meshes)m.visible=active;
  },
  setVisible(value){active=!!value;if(ready)for(const m of meshes)m.visible=active},
  destroy(){for(const mesh of meshes)mesh.destroy();for(const resource of resources)resource.destroy();meshes.length=0;resources.length=0}
 };
}
