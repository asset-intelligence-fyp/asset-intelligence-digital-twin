import {useEffect,useState} from 'react';

export type E8AClass='normal'|'suspect'|'anomaly'|'unknown';
export type E8AAssessment='verified_anomaly'|'verified_suspect'|'verified_normal'|'screening_needs_review'|'unverified'|'review_required'|'not_evaluated';
export interface E8AResult{
 workflow:'E8-A';point_code:string;sensor_id:string;location:string;sensor_type:string;unit:string;
 as_of:string;screening_status:E8AClass;verified_status:E8AClass;evidence_status:string;
 assessment:E8AAssessment; evaluated_at:string;replay_id:string|null;source_observation_count:number;
 screening?:{explanation?:string;confidence?:number;anomaly_type?:string};
 verification?:{explanation?:string;evidence_ids?:string[]};
 validation?:{current_comparison_grounded?:boolean;current_observation_cited?:boolean;
  validated_comparisons?:Array<{valid:boolean;difference_left_minus_right?:number}>};
 review_audit?:{attempts?:number;repair_attempted?:boolean};
 trace?:Array<{tool?:string;source?:string;reason?:string}>;
 elapsed_seconds?:number;limitations?:string[];
}
export interface E8AState{
 workflow:'E8-A';model:string;automatic:boolean;enabled:boolean;
 running:boolean;connected:boolean;dependencies_ready:boolean;model_available:boolean;
 error?:string|null;updated_at:string|null;sensors_supported:number;results:E8AResult[];note:string;
}
export const emptyE8A:E8AState={
 workflow:'E8-A',model:'qwen3:1.7b',automatic:true,enabled:true,
 running:false,connected:false,dependencies_ready:false,model_available:false,
 updated_at:null,sensors_supported:0,results:[],note:'Waiting for automatic E8-A checks.',
 error:'Checking agentic monitor'
};
export function useE8AMonitoring(interval=12000){
 const [state,setState]=useState<E8AState>(emptyE8A);
 useEffect(()=>{
  let alive=true;
  const read=async()=>{
   try{
    const response=await fetch('/api/ai/e8a/status',{cache:'no-store'});
    if(!response.ok)throw Error('Monitoring endpoint returned '+response.status);
    const result=await response.json();
    if(result.workflow!=='E8-A'||!Array.isArray(result.results))throw Error('Invalid E8-A status');
    if(alive)setState(result);
   }catch(e){
    if(alive)setState(old=>({...old,connected:false,error:e instanceof Error?e.message:String(e)}));
   }
  };
  void read();
  const timer=setInterval(()=>void read(),interval);
  return()=>{alive=false;clearInterval(timer)};
 },[interval]);
 return state;
}
export const e8aAttention=(r:E8AResult)=>['verified_anomaly','verified_suspect','screening_needs_review'].includes(r.assessment);
export function e8aLabel(r:E8AResult){
 if(r.assessment==='verified_anomaly')return 'Grounded anomaly assessment';
 if(r.assessment==='verified_suspect')return 'Grounded suspect assessment';
 if(r.assessment==='verified_normal')return 'Grounded normal assessment';
 if(r.assessment==='screening_needs_review')return 'Screening flagged · needs review';
 return 'Unverified / inconclusive';
}
