"""Small local visualization; run `streamlit run dashboard.py`.
Evaluation labels are never passed to the LLM; this viewer reads results only.
"""
from pathlib import Path
import json
import streamlit as st
import pandas as pd
from src.db import sensors, get_series, valid_timestamp
from src.config import PROJECT_ROOT

st.set_page_config(page_title="Local Sensor Digital Twin",layout="wide")
st.title("Local Agentic RAG — Sensor Digital Twin")
st.caption("Visual inspection only. This dashboard does not run model inference.")
try:
    opts=sensors()
except Exception as e:
    st.error(f"Import a dataset first: {e}")
    st.stop()
chosen=st.selectbox("Sensor",[r['sensor_id'] for r in opts])
record=next(r for r in opts if r['sensor_id']==chosen)
origin=st.text_input("Show history through (UTC)",record['last'].replace(' ','T')+'Z')
try:
    rows=get_series(chosen,origin,288)
    if rows:
        df=pd.DataFrame(rows)
        df['timestamp']=pd.to_datetime(df['timestamp'],utc=True)
        st.line_chart(df.set_index('timestamp')['value'])
    else:
        st.info('No readings in this period')
except Exception as e:
    st.error(str(e))
files=sorted((PROJECT_ROOT/'results').glob('*.jsonl'))
selected=st.selectbox("Prediction file",['None']+[str(f.relative_to(PROJECT_ROOT)) for f in files])
if selected!='None':
    records=[json.loads(line) for line in (PROJECT_ROOT/selected).read_text().splitlines() if line.strip()]
    df=pd.DataFrame(records)
    st.dataframe(df,hide_index=True,use_container_width=True)
    st.caption('The table displays raw inference outputs and traces, not ground-truth labels.')
