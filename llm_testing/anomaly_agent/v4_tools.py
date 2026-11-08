"""Case-bound, read-only v4 evidence tools for the unchanged shared_llm.agent loop."""
from __future__ import annotations
from datetime import datetime
from statistics import median, mean


def spec(name, description, properties=None, required=None):
    return {'type':'function','function':{'name':name,'description':description,
      'parameters':{'type':'object','properties':properties or {},'required':required or [],'additionalProperties':False}}}

SPECS=[
 spec('get_sensor_metadata','Get exact sensor type, room, unit and influences for current case. No arguments.'),
 spec('get_recent_readings','Retrieve observed time-stamped current sensor readings (1, 6 or 24 hours).',{'hours':{'type':'integer','enum':[1,6,24]}},['hours']),
 spec('get_room_context','Retrieve recent measured rain, AC, ventilation, headcount and other environmental context for current case.'),
 spec('get_historical_baseline','Retrieve comparable historical normal daily sensor measurements, not labels.'),
 spec('get_temporal_patterns','Retrieve recent time-indexed observations and descriptive change metrics, not a fault decision.',{'hours':{'type':'integer','enum':[1,6,24]}},['hours'])
]

class V4CaseTools:
    dataset='fault'
    retrieval='v4_case_tools'
    def __init__(self, packet):
        self.packet=packet
        self.as_of=datetime.fromisoformat(packet['as_of'])
        self.used=[]
    def specifications(self): return SPECS
    def execute(self,name,args):
        if not isinstance(args,dict): raise ValueError('Arguments must be object')
        spec_by_name={s['function']['name']:s for s in SPECS}
        if name not in spec_by_name: raise ValueError('Unknown tool')
        ps=spec_by_name[name]['function']['parameters']
        if set(args)-set(ps['properties']) or set(ps['required'])-set(args):raise ValueError('Invalid/missing arguments')
        if name in ('get_recent_readings','get_temporal_patterns') and (type(args['hours']) is not int or args['hours'] not in (1,6,24)):
            raise ValueError('hours must be 1, 6 or 24')
        if name=='get_sensor_metadata': out={'sensor':self.packet['sensor'],'as_of':self.packet['as_of']}
        elif name=='get_room_context': out={'as_of':self.packet['as_of'],'samples':self.packet['context_1h'],'time_window':'last hour'}
        elif name=='get_historical_baseline':
            hist=[{k:v for k,v in r.items() if k!='status'} for r in self.packet['historical_comparable_days']]
            out={'as_of':self.packet['as_of'],'historical_normal_days':hist,'count':len(hist),'warning':'Historical normal describes prior periods, NOT whether the current observation is normal'}
        else:
            hours=args['hours']; seq=self.packet[f'recent_{hours}h']
            out={'as_of':self.packet['as_of'],'hours':hours,'unit':self.packet['sensor']['unit'],'samples':seq,'count':len(seq)}
            if name=='get_temporal_patterns' and seq:
                values=[float(x[1]) for x in seq]
                out['descriptive_statistics']={'first':values[0],'last':values[-1],'change':round(values[-1]-values[0],4),
                   'min':min(values),'max':max(values),'mean':round(mean(values),4),'median':median(values)}
        self.used.append({'tool':name,'arguments':args,'result':out})
        return out
