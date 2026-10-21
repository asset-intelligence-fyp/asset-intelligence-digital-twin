-- NEW NINE-POINT DEMONSTRATION SENSOR IDENTITIES (Oct 2026)
-- The user requests reusing the EIGHT original IFC GlobalIds as physical BIM
-- links for eight new dataset names. These are LOGICAL PoC associations:
-- the original spreadsheet described three of the models as air velocity.
-- Updating these labels is NOT evidence the underlying hardware changed type.
-- FS-501A has NO source IFC GUID; remains an HRU501A virtual sensor.
--
-- Run after database/seed_level5_sensor_registry.sql.
-- Also safely upgrades a DB where the earlier nine-point migration ran.
-- Old point rows and all historical measurements are retained.
-- Original S-L5-00x sensor rows are retained for archival relationships,
-- but the API returns current, online-point sensors only.
-- Do NOT rerun the original eleven-channel seed after this migration unless
-- this migration is rerun to restore the new active mapping.
BEGIN;

-- Preserve actual IFC geometry IDs. No new physical XKT geometry is created.
INSERT INTO bim_elements (global_id,building_code,element_type) VALUES
 ('2kuK4GGyjA5QV8NiAnXeXZ','SNOWDON','Sensor'),
 ('3gW6u2ne59c8oABDoS7b3j','SNOWDON','Sensor'),
 ('3gW6u2ne59c8oABDoS7bB3','SNOWDON','Sensor'),
 ('3iie255UfEvg3mun9qVzgx','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofK0i','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofKIe','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofKRW','SNOWDON','Sensor'),
 ('1Rnvr0S6DA0x5eK1Aa66rR','SNOWDON','Sensor'),
 ('VIRTUAL-FS-501A','SNOWDON','Sensor')
ON CONFLICT (global_id) DO NOTHING;

-- Same eight original BIM GlobalIds, but point-oriented sensor_code IDs.
-- MAT-501A, DPCMD-504, and CV-507 previously used virtual GUIDs in the
-- earlier migration; these statements correctly rebind them to original IFCs.
INSERT INTO sensors
 (sensor_code,equipment_code,global_id,sensor_name,sensor_status,data_source)
VALUES
 ('SAT-501A','HRU501A','2kuK4GGyjA5QV8NiAnXeXZ',
   'Supply-air temperature','Online','Simulated'),
 ('MAT-501A','HRU501A','3gW6u2ne59c8oABDoS7b3j',
   'Mixed-air temperature (logical BIM reassignment)','Online','Simulated'),
 ('SAT-504','HRU504','3gW6u2ne59c8oABDoS7bB3',
   'Supply-air temperature','Online','Simulated'),
 ('DPCMD-504','HRU504','3iie255UfEvg3mun9qVzgx',
   'Outdoor-air damper command (logical BIM reassignment)','Online','Simulated'),
 ('DP-504','HRU504','050uZGzlP8Yg9H1S$ofK0i',
   'Outdoor-air damper position','Online','Simulated'),
 ('SAT-507','HRU507','050uZGzlP8Yg9H1S$ofKIe',
   'Supply-air temperature','Online','Simulated'),
 ('CV-507','HRU507','050uZGzlP8Yg9H1S$ofKRW',
   'Cooling-valve position (logical BIM reassignment)','Online','Simulated'),
 ('S-L5-008-TEMP','HRU507','1Rnvr0S6DA0x5eK1Aa66rR',
   'Unit 507 room temperature','Online','Simulated'),
 ('FS-501A','HRU501A','VIRTUAL-FS-501A',
   'Supply-fan status (no IFC marker)','Online','Simulated')
ON CONFLICT (sensor_code) DO UPDATE SET
 equipment_code=EXCLUDED.equipment_code,
 global_id=EXCLUDED.global_id,
 sensor_name=EXCLUDED.sensor_name,
 sensor_status=EXCLUDED.sensor_status,
 data_source=EXCLUDED.data_source;

-- Archive previous dataset channels WITHOUT deleting historical data.
UPDATE sensor_points SET point_status='Inactive'
WHERE point_code IN
 ('AF-501A','AF-504','AF-507','S-L5-008-HUM','S-L5-008-CO2');

-- Nine expected point IDs, each matching its current sensor_code.
INSERT INTO sensor_points
 (point_code,sensor_code,measurement_type,unit,point_status)
VALUES
 ('SAT-501A','SAT-501A','Supply Air Temperature','°C','Online'),
 ('MAT-501A','MAT-501A','Mixed Air Temperature','°C','Online'),
 ('FS-501A','FS-501A','Supply Fan Status','ON/OFF','Online'),
 ('SAT-504','SAT-504','Supply Air Temperature','°C','Online'),
 ('DP-504','DP-504','Outdoor Air Damper Position','%','Online'),
 ('DPCMD-504','DPCMD-504','Outdoor Air Damper Command','%','Online'),
 ('SAT-507','SAT-507','Supply Air Temperature','°C','Online'),
 ('CV-507','CV-507','Cooling Valve Position','%','Online'),
 ('S-L5-008-TEMP','S-L5-008-TEMP','Room Temperature','°C','Online')
ON CONFLICT (point_code) DO UPDATE SET
 sensor_code=EXCLUDED.sensor_code,
 measurement_type=EXCLUDED.measurement_type,
 unit=EXCLUDED.unit,
 point_status=EXCLUDED.point_status;

COMMIT;

-- Expected: nine rows, eight reused real IFC GUIDs plus virtual FS-501A.
SELECT sp.point_code, sp.sensor_code, s.equipment_code, s.global_id,
       sp.measurement_type, sp.unit, sp.point_status
FROM sensor_points sp
JOIN sensors s ON s.sensor_code=sp.sensor_code
WHERE sp.point_status='Online'
 AND sp.point_code IN
 ('SAT-501A','MAT-501A','FS-501A','SAT-504','DP-504',
  'DPCMD-504','SAT-507','CV-507','S-L5-008-TEMP')
ORDER BY s.equipment_code, sp.point_code;
