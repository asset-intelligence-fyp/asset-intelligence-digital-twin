#!/usr/bin/env python3
"""Compiled historical Sarawak office closure calendar (must verify employer policy)."""
import csv
from pathlib import Path

# Dates sourced/compiled from Sarawak govt 2019, KLN/UNIMAS/MEF/other
# historical publications and user's supplied 2024-25 list; not legal advice.
RAW={
2019:'''01-01|New Year;02-05|Chinese New Year;02-06|Chinese New Year Day 2;04-19|Good Friday;05-01|Labour Day;05-19|Wesak Day;05-20|Wesak observed;06-01|Gawai Dayak;06-02|Gawai Dayak Day 2;06-03|Gawai observed;06-05|Hari Raya Aidilfitri;06-06|Hari Raya Aidilfitri Day 2;07-22|Sarawak Day;08-11|Hari Raya Haji;08-12|Hari Raya Haji observed;08-31|National Day;09-01|Awal Muharram;09-02|Awal Muharram observed;09-09|Agong Birthday;09-16|Malaysia Day;10-12|Governor Birthday;11-09|Prophet Muhammad Birthday;12-25|Christmas Day''',
2020:'''01-01|New Year;01-25|Chinese New Year;01-26|Chinese New Year Day 2;01-27|Chinese New Year observed;04-10|Good Friday;05-01|Labour Day;05-07|Wesak Day;05-24|Hari Raya Aidilfitri;05-25|Hari Raya Aidilfitri Day 2;05-26|Hari Raya replacement;06-01|Gawai Dayak;06-02|Gawai Dayak Day 2;06-08|Agong Birthday;07-22|Sarawak Day;07-31|Hari Raya Haji;08-20|Awal Muharram;08-31|National Day;09-16|Malaysia Day;10-10|Governor Birthday;10-29|Prophet Muhammad Birthday;12-25|Christmas Day''',
2021:'''01-01|New Year;02-12|Chinese New Year;02-13|Chinese New Year Day 2;04-02|Good Friday;05-01|Labour Day;05-13|Hari Raya Aidilfitri;05-14|Hari Raya Aidilfitri Day 2;05-26|Wesak Day;06-01|Gawai Dayak;06-02|Gawai Dayak Day 2;06-07|Agong Birthday;07-20|Hari Raya Haji;07-22|Sarawak Day;08-10|Awal Muharram;08-31|National Day;09-16|Malaysia Day;10-09|Governor Birthday;10-19|Prophet Muhammad Birthday;12-25|Christmas Day''',
2022:'''01-01|New Year;02-01|Chinese New Year;02-02|Chinese New Year Day 2;04-15|Good Friday;05-01|Labour Day;05-02|Hari Raya Aidilfitri;05-03|Hari Raya Aidilfitri Day 2;05-04|Labour Day observed;05-15|Wesak Day;05-16|Wesak observed;06-01|Gawai Dayak;06-02|Gawai Dayak Day 2;06-06|Agong Birthday;07-10|Hari Raya Haji;07-11|Hari Raya Haji observed;07-22|Sarawak Day;07-30|Awal Muharram;08-31|National Day;09-16|Malaysia Day;10-08|Governor Birthday;10-09|Prophet Muhammad Birthday;10-10|Prophet Muhammad Birthday observed;12-25|Christmas Day;12-26|Christmas observed''',
2023:'''01-01|New Year;01-02|New Year observed;01-22|Chinese New Year;01-23|Chinese New Year Day 2;01-24|Chinese New Year observed;04-07|Good Friday;04-22|Hari Raya Aidilfitri;04-23|Hari Raya Aidilfitri Day 2;04-24|Hari Raya observed;05-01|Labour Day;05-04|Wesak Day;06-01|Gawai Dayak;06-02|Gawai Dayak Day 2;06-05|Agong Birthday;06-29|Hari Raya Haji;07-19|Awal Muharram;07-22|Sarawak Day;08-31|National Day;09-16|Malaysia Day;09-28|Prophet Muhammad Birthday;10-14|Governor Birthday;12-25|Christmas Day''',
2026:'''01-01|New Year;02-17|Chinese New Year;02-18|Chinese New Year Day 2;03-21|Hari Raya Aidilfitri;03-22|Hari Raya Aidilfitri Day 2;03-23|Hari Raya observed'''  # Q1 only, for holdout
}
SRC={
2019:'https://www.nreb.gov.my/web/subpage/webpage_view/398',
2020:'https://payroll.autocountcloud.com/public-holidays/2020/sarawak',
2021:'https://payroll.autocountcloud.com/public-holidays/2021/sarawak',
2022:'https://www.kabinet.gov.my/akta-dan-warta/',
2023:'https://www.kabinet.gov.my/akta-dan-warta/',
2024:'user_supplied_reviewed_csv',2025:'user_supplied_reviewed_csv',2026:'https://talikhidmat.sarawak.gov.my/talikhidmat/web/home/list_holiday/'}
def main():
 root=Path(__file__).resolve().parent
 rows=[]
 for year,record in RAW.items():
  for item in record.split(';'):
   mmdd,name=item.split('|',1)
   rows.append([f'{year}-{mmdd}',name,'public_holiday',SRC[year]])
 userfile=root/'data'/'user_holidays_2024_2025.csv'
 with userfile.open(encoding='utf8',newline='') as f:
  for row in csv.DictReader(f):
   rows.append([row['date'],row['holiday'],'public_holiday',SRC[int(row['date'][:4])]])
 # In this particular synthetic OFFICE case study, these company closures are assumed
 # rather than declared statutory state-wide holidays.
 rows.extend([['2024-06-04','Gawai/Agong overlap - assumed employer closure','assumed_office_closure','scenario_assumption'],['2025-06-04','Gawai/Agong overlap - optional employer closure','assumed_office_closure','scenario_assumption']])
 seen=set();dedup=[]
 for row in sorted(rows):
  if row[0] not in seen:
   seen.add(row[0]);dedup.append(row)
 with (root/'data'/'holidays_sarawak_2019_2025.csv').open('w',encoding='utf8',newline='') as f:
  w=csv.writer(f);w.writerow(['date','holiday_name','holiday_type','reference']);w.writerows(dedup)
 print('Calendar:',len(dedup),'holiday/closure dates across 2019-2025 plus 2026 Q1 test period')
if __name__=='__main__':main()
