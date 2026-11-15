-- FYP v2 seed from Simulator SOP v1.5; only fixed metadata.
-- No old HVAC readings; BIM GlobalIds pending.
BEGIN;
INSERT INTO buildings (building_code, building_name, building_type) VALUES ('SNOWDON', 'Snowdon Towers', 'Office') ON CONFLICT (building_code) DO NOTHING;
INSERT INTO building_floors (building_code, floor_level) VALUES ('SNOWDON', 'L03') ON CONFLICT (building_code, floor_level) DO NOTHING;
INSERT INTO locations (location_code, building_code, floor_level, location_name, location_type)
VALUES
    ('L03-OPEN-01', 'SNOWDON', 'L03', 'Open Office', 'Open Office'),
    ('L03-MEET-01', 'SNOWDON', 'L03', 'Meeting Room', 'Meeting Room'),
    ('L03-WC-01', 'SNOWDON', 'L03', 'Toilet / WC', 'Toilet'),
    ('L03-CLEAN-01', 'SNOWDON', 'L03', 'Cleaning Room', 'Cleaning Room'),
    ('L03-PWR-POINT-01', 'SNOWDON', 'L03', 'Level 03 Virtual Power Point', 'Virtual Power Point')
ON CONFLICT (location_code) DO NOTHING;

INSERT INTO sensors (sensor_code, location_code, global_id, sensor_name, sensor_status, data_source)
VALUES
    ('TEMP-L03-OPEN-01', 'L03-OPEN-01', NULL, 'Temperature Sensor', 'Online', 'simulated'),
    ('RH-L03-OPEN-01', 'L03-OPEN-01', NULL, 'Humidity Sensor', 'Online', 'simulated'),
    ('CO2-L03-OPEN-01', 'L03-OPEN-01', NULL, 'Co2 Sensor', 'Online', 'simulated'),
    ('PIR-L03-OPEN-01', 'L03-OPEN-01', NULL, 'Occupancy Sensor', 'Online', 'simulated'),
    ('LUX-L03-OPEN-01', 'L03-OPEN-01', NULL, 'Light Sensor', 'Online', 'simulated'),
    ('TEMP-L03-MEET-01', 'L03-MEET-01', NULL, 'Temperature Sensor', 'Online', 'simulated'),
    ('RH-L03-MEET-01', 'L03-MEET-01', NULL, 'Humidity Sensor', 'Online', 'simulated'),
    ('CO2-L03-MEET-01', 'L03-MEET-01', NULL, 'Co2 Sensor', 'Online', 'simulated'),
    ('PIR-L03-MEET-01', 'L03-MEET-01', NULL, 'Occupancy Sensor', 'Online', 'simulated'),
    ('LUX-L03-MEET-01', 'L03-MEET-01', NULL, 'Light Sensor', 'Online', 'simulated'),
    ('PIR-L03-WC-01', 'L03-WC-01', NULL, 'Occupancy Sensor', 'Online', 'simulated'),
    ('LUX-L03-WC-01', 'L03-WC-01', NULL, 'Light Sensor', 'Online', 'simulated'),
    ('RH-L03-WC-01', 'L03-WC-01', NULL, 'Humidity Sensor', 'Online', 'simulated'),
    ('LEAK-L03-WC-01', 'L03-WC-01', NULL, 'Water Leakage Sensor', 'Online', 'simulated'),
    ('PIR-L03-CLEAN-01', 'L03-CLEAN-01', NULL, 'Occupancy Sensor', 'Online', 'simulated'),
    ('LUX-L03-CLEAN-01', 'L03-CLEAN-01', NULL, 'Light Sensor', 'Online', 'simulated'),
    ('LEAK-L03-CLEAN-01', 'L03-CLEAN-01', NULL, 'Water Leakage Sensor', 'Online', 'simulated'),
    ('PWR-L03-PWR-POINT-01', 'L03-PWR-POINT-01', NULL, 'Power Sensor', 'Online', 'simulated')
ON CONFLICT (sensor_code) DO NOTHING;

INSERT INTO sensor_points (point_code, sensor_code, measurement_type, unit, point_status)
VALUES
    ('TEMP-L03-OPEN-01', 'TEMP-L03-OPEN-01', 'temperature', '°C', 'Online'),
    ('RH-L03-OPEN-01', 'RH-L03-OPEN-01', 'humidity', '%RH', 'Online'),
    ('CO2-L03-OPEN-01', 'CO2-L03-OPEN-01', 'co2', 'ppm', 'Online'),
    ('PIR-L03-OPEN-01', 'PIR-L03-OPEN-01', 'occupancy', 'binary', 'Online'),
    ('LUX-L03-OPEN-01', 'LUX-L03-OPEN-01', 'light', 'lux', 'Online'),
    ('TEMP-L03-MEET-01', 'TEMP-L03-MEET-01', 'temperature', '°C', 'Online'),
    ('RH-L03-MEET-01', 'RH-L03-MEET-01', 'humidity', '%RH', 'Online'),
    ('CO2-L03-MEET-01', 'CO2-L03-MEET-01', 'co2', 'ppm', 'Online'),
    ('PIR-L03-MEET-01', 'PIR-L03-MEET-01', 'occupancy', 'binary', 'Online'),
    ('LUX-L03-MEET-01', 'LUX-L03-MEET-01', 'light', 'lux', 'Online'),
    ('PIR-L03-WC-01', 'PIR-L03-WC-01', 'occupancy', 'binary', 'Online'),
    ('LUX-L03-WC-01', 'LUX-L03-WC-01', 'light', 'lux', 'Online'),
    ('RH-L03-WC-01', 'RH-L03-WC-01', 'humidity', '%RH', 'Online'),
    ('LEAK-L03-WC-01', 'LEAK-L03-WC-01', 'water_leakage', 'binary', 'Online'),
    ('PIR-L03-CLEAN-01', 'PIR-L03-CLEAN-01', 'occupancy', 'binary', 'Online'),
    ('LUX-L03-CLEAN-01', 'LUX-L03-CLEAN-01', 'light', 'lux', 'Online'),
    ('LEAK-L03-CLEAN-01', 'LEAK-L03-CLEAN-01', 'water_leakage', 'binary', 'Online'),
    ('PWR-L03-PWR-POINT-01', 'PWR-L03-PWR-POINT-01', 'power', 'kW', 'Online')
ON CONFLICT (point_code) DO NOTHING;

-- Reference values; no historical sensor readings are inserted.
INSERT INTO alert_severity (severity_name) VALUES
    ('Low'), ('Medium'), ('High'), ('Critical')
ON CONFLICT (severity_name) DO NOTHING;

INSERT INTO alert_status (status_name) VALUES
    ('New'), ('Review'), ('Acknowledged'), ('Closed')
ON CONFLICT (status_name) DO NOTHING;

COMMIT;

