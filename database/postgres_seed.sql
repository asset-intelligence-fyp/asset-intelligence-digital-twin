BEGIN;

-- =========================================================
-- BUILDING
-- =========================================================

INSERT INTO buildings (
    building_code,
    building_name,
    building_type
)
VALUES (
    'SNOWDON',
    'Snowdon Towers',
    'Residential'
);


-- =========================================================
-- BIM MODEL
-- =========================================================

INSERT INTO bim_models (
    building_code,
    model_name,
    file_reference
)
VALUES (
    'SNOWDON',
    'Snowdon Level 5 Model + HVAC',
    '/models/Snowdon_Level5_Model+HVAC_S.xkt'
);


-- =========================================================
-- FLOOR
-- =========================================================

INSERT INTO building_floors (
    building_code,
    floor_level
)
VALUES (
    'SNOWDON',
    'L5'
);


-- =========================================================
-- LOCATION
-- =========================================================

INSERT INTO locations (
    location_code,
    building_code,
    floor_level,
    location_name,
    location_type
)
VALUES (
    'LOC-L5-507',
    'SNOWDON',
    'L5',
    'Live/Work Unit 507',
    'Room'
);


-- =========================================================
-- TEMPORARY BIM ELEMENT FOR HRU507
--
-- Replace this with the real HRU IFC GUID later.
-- =========================================================

INSERT INTO bim_elements (
    global_id,
    building_code,
    element_type
)
VALUES (
    'TEMP-BIM-HRU507',
    'SNOWDON',
    'Equipment'
);


-- =========================================================
-- REAL BIM ELEMENT FOR ABB SENSOR
-- =========================================================

INSERT INTO bim_elements (
    global_id,
    building_code,
    element_type
)
VALUES (
    '1Rnvr0S6DA0x5eK1Aa66rR',
    'SNOWDON',
    'Sensor'
);


-- =========================================================
-- EQUIPMENT
-- =========================================================

INSERT INTO equipment (
    equipment_code,
    global_id,
    location_code,
    equipment_type,
    manufacturer,
    model,
    equipment_status,
    installation_date
)
VALUES (
    'HRU507',
    'TEMP-BIM-HRU507',
    'LOC-L5-507',
    'HRU',
    NULL,
    NULL,
    'Running',
    NULL
);


-- =========================================================
-- PHYSICAL SENSOR DEVICE
-- =========================================================

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
);


-- =========================================================
-- SENSOR MEASUREMENT CHANNELS
-- =========================================================

INSERT INTO sensor_points (
    point_code,
    sensor_code,
    measurement_type,
    unit,
    point_status
)
VALUES
(
    'S-L5-008-TEMP',
    'S-L5-008',
    'Temperature',
    '°C',
    'Online'
),
(
    'S-L5-008-HUM',
    'S-L5-008',
    'Humidity',
    '%RH',
    'Online'
),
(
    'S-L5-008-CO2',
    'S-L5-008',
    'CO2',
    'ppm',
    'Online'
);


-- =========================================================
-- ALERT LOOKUPS
-- =========================================================

INSERT INTO alert_status (status_name)
VALUES
    ('New'),
    ('Review'),
    ('Acknowledged'),
    ('Closed');

INSERT INTO alert_severity (severity_name)
VALUES
    ('Low'),
    ('Medium'),
    ('High'),
    ('Critical');


COMMIT;