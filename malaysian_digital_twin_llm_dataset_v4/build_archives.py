#!/usr/bin/env python3
"""Make four artifact ZIPs: full data, safe visible prompts, hidden keys, code+guide."""
from pathlib import Path
import zipfile, json
root=Path(__file__).resolve().parent;dest=root.parent
code=[p for p in root.iterdir() if p.is_file() and p.suffix in ('.py','.md')]
code+=list((root/'data').glob('*.csv'))
static=[p for p in (root/'generated'/'llm_reference').iterdir() if p.is_file()]
public=[p for p in static if '_HIDDEN' not in p.name and 'truth_summary' not in p.name and p.name!='forecast_cases_manifest.json']
private=[p for p in static if '_HIDDEN' in p.name]
sample=[p for p in (root/'sample_week').iterdir() if p.is_file() and p.suffix in ('.csv','.json')]
full=[p for p in (root/'generated'/'normal_by_year').rglob('*') if p.is_file()]
fault=[p for p in (root/'generated'/'anomaly_eval_2026_q1').rglob('*') if p.is_file()]
runfiles=[root/'generated'/'quality_report.json',root/'generated'/'structural_validation.json']
public_fault=[p for p in fault if p.name not in ('ground_truth_events.csv','ground_truth_labels.csv')]
private_fault=[p for p in fault if p.name in ('ground_truth_events.csv','ground_truth_labels.csv')]
package={
 'malaysian_office_v4_code_guide.zip':code+sample+runfiles,
 'malaysian_office_v4_llm_inputs_ONLY.zip':[root/'LLM_UPLOADING_GUIDE.md']+public+sample+public_fault+runfiles,
 'malaysian_office_v4_evaluation_KEYS.zip':private+private_fault,
 'malaysian_office_v4_full_2019_2026.zip':code+static+full+fault+runfiles+sample
}
manifest={}
for name,files in package.items():
 target=dest/name
 with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as archive:
  for i,fp in enumerate(dict.fromkeys(files)):
   if not fp.exists():raise FileNotFoundError(fp)
   arcname='malaysian_digital_twin_llm_dataset_v4/'+str(fp.relative_to(root))
   archive.write(fp,arcname)
   if i%20==0:print(name,'processed',i+1,'files',flush=True)
 with zipfile.ZipFile(target,'r') as z:
  assert not z.bad_entries if hasattr(z,'bad_entries') else True
  num=len(z.namelist());compressed=sum(x.compress_size for x in z.infolist())
  assert num==len(dict.fromkeys(files))
 manifest[name]={'files':num,'compressed_bytes':target.stat().st_size,'contains_hidden_truth':name.endswith('KEYS.zip') or name.endswith('2019_2026.zip')}
 print('FINISHED',name,round(target.stat().st_size/1024/1024,1),'MiB',num,'files',flush=True)
(dest/'malaysian_office_v4_package_manifest.json').write_text(json.dumps(manifest,indent=2))
print('ARCHIVES_COMPLETE',flush=True)
