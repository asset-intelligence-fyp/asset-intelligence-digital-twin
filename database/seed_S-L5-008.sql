BEGIN;

-- Real BIM sensor mapping:
-- BIM GUID: 1Rnvr0S6DA0x5eK1Aa66rR
-- Physical sensor: S-L5-008
-- Linked equipment: HRU507

INSERT INTO building_floors (building_code, floor_level)
VALUES ('SNOWDON', 'L5')
ON CONFLICT (building_code, floor_level) DO NOTHING;

UPDATE locations
SET floor_level = 'L5',
    location_name = 'Live/Work Unit 507'
WHERE location_code = (
    SELECT location_code
    FROM equipment
    WHERE equipment_code = 'HRU507'
);

INSERT INTO bim_elements (global_id, building_code, element_type)
SELECT
    'TEMP-' || e.equipment_code,
    be.building_code,
    'Equipment'::bim_element_type
FROM equipment e
JOIN bim_elements be
  ON be.global_id = e.global_id
WHERE e.global_id = '1Rnvr0S6DA0x5eK1Aa66rR'
ON CONFLICT (global_id) DO NOTHING;

UPDATE equipment
SET global_id = 'TEMP-' || equipment_code
WHERE global_id = '1Rnvr0S6DA0x5eK1Aa66rR';

INSERT INTO bim_elements (global_id, building_code, element_type)
VALUES ('1Rnvr0S6DA0x5eK1Aa66rR', 'SNOWDON', 'Sensor')
ON CONFLICT (global_id)
DO UPDATE SET
    building_code = EXCLUDED.building_code,
    element_type = EXCLUDED.element_type;

INSERT INTO sensors (
    sensor_code,
    equipment_code,
    global_id,
    sensor_name,
    manufacturer,
    model,
    sensor_status,
    data_source
)
VALUES (
    'S-L5-008',
    'HRU507',
    '1Rnvr0S6DA0x5eK1Aa66rR',
    'Fusion Smart Sensor',
    'ABB',
    'Fusion Smart Sensor-THC',
    'Online',
    'Simulated'
)
ON CONFLICT (sensor_code)
DO UPDATE SET
    equipment_code = EXCLUDED.equipment_code,
    global_id = EXCLUDED.global_id,
    sensor_name = EXCLUDED.sensor_name,
    manufacturer = EXCLUDED.manufacturer,
    model = EXCLUDED.model,
    sensor_status = EXCLUDED.sensor_status,
    data_source = EXCLUDED.data_source;

INSERT INTO sensor_points (
    point_code,
    sensor_code,
    measurement_type,
    unit,
    point_status
)
VALUES
    ('S-L5-008-TEMP', 'S-L5-008', 'Temperature', '°C',  'Online'),
    ('S-L5-008-HUM',  'S-L5-008', 'Humidity',    '%RH', 'Online'),
    ('S-L5-008-CO2',  'S-L5-008', 'CO2',         'ppm', 'Online')
ON CONFLICT (point_code)
DO UPDATE SET
    sensor_code = EXCLUDED.sensor_code,
    measurement_type = EXCLUDED.measurement_type,
    unit = EXCLUDED.unit,
    point_status = EXCLUDED.point_status;

COMMIT;

