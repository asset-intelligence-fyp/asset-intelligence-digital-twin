-- Switch the Level 5 live telemetry profile to the NINE point names provided
-- for the updated AI CSV / forthcoming independent Python simulator.
-- Apply AFTER seed_level5_sensor_registry.sql on the existing digital_twin DB.
-- SAFE: never drops or renames BIM sensor GlobalIds, equipment or recorded history.
-- Old points remain queryable in sensor_readings but are marked Inactive.
-- Re-runnable; changes are wrapped in a single transaction.
BEGIN;

-- Additional HRU asset-level channels are NOT supplied as IFC physical sensors.
-- Their BIM element keys are VIRTUAL database identifiers, not XKT geometry.
INSERT INTO bim_elements (global_id, building_code, element_type) VALUES
 ('VIRTUAL-MAT-501A', 'SNOWDON', 'Sensor'),
 ('VIRTUAL-DPCMD-504', 'SNOWDON', 'Sensor'),
 ('VIRTUAL-CV-507', 'SNOWDON', 'Sensor')
ON CONFLICT (global_id) DO NOTHING;

INSERT INTO sensors
 (sensor_code, equipment_code, global_id, sensor_name, sensor_status, data_source)
VALUES
 ('MAT-501A', 'HRU501A', 'VIRTUAL-MAT-501A',
    'Mixed-air temperature telemetry (no verified IFC sensor marker)', 'Online', 'Simulated'),
 ('DPCMD-504', 'HRU504', 'VIRTUAL-DPCMD-504',
    'Outdoor-air damper command telemetry (not a physical position sensor)', 'Online', 'Simulated'),
 ('CV-507', 'HRU507', 'VIRTUAL-CV-507',
    'Cooling-valve position telemetry (no verified IFC sensor marker)', 'Online', 'Simulated')
ON CONFLICT (sensor_code) DO UPDATE SET
 equipment_code=EXCLUDED.equipment_code,
 global_id=EXCLUDED.global_id,
 sensor_name=EXCLUDED.sensor_name,
 data_source=EXCLUDED.data_source;

-- The previous profile's velocity, humidity and CO2 channels are not in
-- the new CSV. Keep all their historical rows and physical BIM marker records.
UPDATE sensor_points SET point_status='Inactive'
WHERE point_code IN
 ('AF-501A','AF-504','AF-507','S-L5-008-HUM','S-L5-008-CO2');

-- These six point IDs already exist; preserve their sensor/BIM association.
-- Do not reuse an old air-velocity GUID for a different sensor modality.
UPDATE sensor_points SET point_status='Online'
WHERE point_code IN
 ('SAT-501A','FS-501A','SAT-504','DP-504','SAT-507','S-L5-008-TEMP');

-- Three new asset-linked but unlocated signals.
INSERT INTO sensor_points
 (point_code,sensor_code,measurement_type,unit,point_status)
VALUES
 ('MAT-501A','MAT-501A','Mixed Air Temperature','°C','Online'),
 ('DPCMD-504','DPCMD-504','Outdoor Air Damper Command','%','Online'),
 ('CV-507','CV-507','Cooling Valve Position','%','Online')
ON CONFLICT (point_code) DO UPDATE SET
 sensor_code=EXCLUDED.sensor_code,
 measurement_type=EXCLUDED.measurement_type,
 unit=EXCLUDED.unit,
 point_status='Online';

COMMIT;

-- Post-migration check: exactly nine Online points, with the original eight
-- physical IFC markers still present in sensors/bim_elements.
SELECT point_code, sensor_code, measurement_type, unit, point_status
FROM sensor_points
WHERE point_status='Online'
ORDER BY point_code;
