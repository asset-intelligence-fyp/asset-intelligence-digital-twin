import {heatmapColour,interpolateWholeFloor} from './heatmapField.js';

/**
 * Convert a scalar field into contiguous, narrow isobands.
 *
 * xeokit's current project produced white/grey floor planes when using
 * dynamic vertex colours AND when using generated PNG diffuse textures.
 * Rather than depend on either path, the heatmap now uses ordinary
 * PhongMaterial.diffuse colours, one for each of 32 levels.
 *
 * Each source grid triangle is split on iso-value boundaries. This avoids
 * blocky square cells and fills every modeled floor triangle without gaps.
 * A single scalar value paints the entire surface one band; a missing metric
 * paints nothing. No cross-floor interpolation.
 */
const lerp=(a,b,t)=>({
 x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,
 score:a.score+(b.score-a.score)*t
});
export function clipHeatmapPolygon(polygon,threshold,greater){
 if(!polygon.length)return [];
 const result=[];
 let previous=polygon.at(-1);
 let previousInside=greater?previous.score>=threshold:previous.score<=threshold;
 for(const current of polygon){
  const inside=greater?current.score>=threshold:current.score<=threshold;
  if(inside!==previousInside){
   const denominator=current.score-previous.score;
   if(Math.abs(denominator)>1e-10){
    const t=Math.max(0,Math.min(1,(threshold-previous.score)/denominator));
    result.push(lerp(previous,current,t));
   }
  }
  if(inside)result.push(current);
  previous=current;previousInside=inside;
 }
 return result;
}

export function buildHeatmapBands(grid,samples,bandCount=32){
 if(!samples?.length||!grid?.indices?.length||!grid.positions?.length)return [];
 if(!Number.isInteger(bandCount)||bandCount<2||bandCount>128)throw Error('Invalid heatmap band count');
 const scores=[];
 for(let i=0;i<grid.positions.length;i+=3){
  scores.push(interpolateWholeFloor(grid.positions[i],grid.positions[i+2],samples));
 }
 const bands=Array.from({length:bandCount},(_,index)=>({index,positions:[],normals:[],indices:[]}));
 for(let n=0;n<grid.indices.length;n+=3){
  const triangle=grid.indices.slice(n,n+3).map(index=>{
   const at=index*3;
   return {x:grid.positions[at],y:grid.positions[at+1],z:grid.positions[at+2],score:scores[index]};
  });
  if(triangle.some(p=>p.score===null||!Number.isFinite(p.score)))continue;
  const start=Math.max(0,Math.min(bandCount-1,Math.floor(Math.min(...triangle.map(v=>v.score))*bandCount)));
  const end=Math.max(0,Math.min(bandCount-1,Math.floor(Math.max(...triangle.map(v=>v.score))*bandCount)));
  for(let index=start;index<=end;index++){
   // Boundaries overlap exactly; zero-area triangles are culled below.
   const min=index/bandCount,max=(index+1)/bandCount;
   const polygon=clipHeatmapPolygon(clipHeatmapPolygon(triangle,min,true),max,false);
   if(polygon.length<3)continue;
   const target=bands[index];
   for(let j=1;j<polygon.length-1;j++){
    const vertices=[polygon[0],polygon[j],polygon[j+1]];
    const area=(vertices[1].x-vertices[0].x)*(vertices[2].z-vertices[0].z)-
     (vertices[1].z-vertices[0].z)*(vertices[2].x-vertices[0].x);
    if(Math.abs(area)<1e-7)continue;
    const first=target.positions.length/3;
    for(const p of vertices){target.positions.push(p.x,p.y,p.z);target.normals.push(0,1,0)}
    target.indices.push(first,first+1,first+2);
   }
  }
 }
 return bands.filter(b=>b.indices.length>0);
}
export function bandMaterialColours(count=32){
 return Array.from({length:count},(_,i)=>heatmapColour((i+.5)/count));
}
