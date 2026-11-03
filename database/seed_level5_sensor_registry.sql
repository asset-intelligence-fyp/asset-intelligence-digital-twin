-- Level 5 extension for the physical BIM sensor registry.
-- Apply after database/postgres_schema.sql and initial Snowdon/HRU507 seed.
-- No DELETE/TRUNCATE/DROP statements. Re-runnable.
BEGIN;

INSERT INTO building_floors(building_code, floor_level) VALUES ('SNOWDON','L5')
ON CONFLICT (building_code, floor_level) DO NOTHING;

INSERT INTO locations(location_code,building_code,floor_level,location_name,location_type)
VALUES
 ('LOC-L5-HRU501A','SNOWDON','L5','HRU501A supply duct','Mechanical'),
 ('LOC-L5-HRU504','SNOWDON','L5','HRU504 supply duct','Mechanical'),
 ('LOC-L5-507','SNOWDON','L5','Live/Work Unit 507','Room')
ON CONFLICT (location_code) DO NOTHING;

-- Equipment BIM GUIDs have not been supplied in the sensor spreadsheet.
-- TEMP-EQUIPMENT-* records are database placeholders, NOT model geometry.
INSERT INTO bim_elements(global_id,building_code,element_type)
VALUES
 ('TEMP-EQUIPMENT-HRU501A','SNOWDON','Equipment'),
 ('TEMP-EQUIPMENT-HRU504','SNOWDON','Equipment'),
 ('TEMP-EQUIPMENT-HRU507','SNOWDON','Equipment')
ON CONFLICT(global_id) DO NOTHING;

INSERT INTO equipment(equipment_code,global_id,location_code,equipment_type,equipment_status)
VALUES
 ('HRU501A','TEMP-EQUIPMENT-HRU501A','LOC-L5-HRU501A','HRU','Running'),
 ('HRU504','TEMP-EQUIPMENT-HRU504','LOC-L5-HRU504','HRU','Running'),
 ('HRU507','TEMP-EQUIPMENT-HRU507','LOC-L5-507','HRU','Running')
ON CONFLICT(equipment_code) DO NOTHING;

INSERT INTO bim_elements(global_id,building_code,element_type)
VALUES
 ('2kuK4GGyjA5QV8NiAnXeXZ','SNOWDON','Sensor'),
 ('3gW6u2ne59c8oABDoS7b3j','SNOWDON','Sensor'),
 ('3gW6u2ne59c8oABDoS7bB3','SNOWDON','Sensor'),
 ('3iie255UfEvg3mun9qVzgx','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofK0i','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofKIe','SNOWDON','Sensor'),
 ('050uZGzlP8Yg9H1S$ofKRW','SNOWDON','Sensor'),
 ('1Rnvr0S6DA0x5eK1Aa66rR','SNOWDON','Sensor'),
 ('VIRTUAL-FS-501A','SNOWDON','Sensor')
ON CONFLICT(global_id) DO NOTHING;

INSERT INTO sensors(sensor_code,equipment_code,global_id,sensor_name,sensor_status,data_source)
VALUES
 ('S-L5-001','HRU501A','2kuK4GGyjA5QV8NiAnXeXZ','Supply air temperature','Online','Simulated'),
 ('S-L5-002','HRU501A','3gW6u2ne59c8oABDoS7b3j','Air velocity','Online','Simulated'),
 ('FS-501A','HRU501A','VIRTUAL-FS-501A','Fan status telemetry (no physical BIM GUID)','Online','Simulated'),
 ('S-L5-003','HRU504','3gW6u2ne59c8oABDoS7bB3','Supply air temperature','Online','Simulated'),
 ('S-L5-004','HRU504','3iie255UfEvg3mun9qVzgx','Air velocity','Online','Simulated'),
 ('S-L5-005','HRU504','050uZGzlP8Yg9H1S$ofK0i','Motorized damper position','Online','Simulated'),
 ('S-L5-006','HRU507','050uZGzlP8Yg9H1S$ofKIe','Supply air temperature','Online','Simulated'),
 ('S-L5-007','HRU507','050uZGzlP8Yg9H1S$ofKRW','Air velocity','Online','Simulated'),
 ('S-L5-008','HRU507','1Rnvr0S6DA0x5eK1Aa66rR','ABB Fusion Smart Sensor','Online','Simulated')
ON CONFLICT(sensor_code) DO UPDATE
SET equipment_code=EXCLUDED.equipment_code, global_id=EXCLUDED.global_id,
    sensor_name=EXCLUDED.sensor_name, data_source=EXCLUDED.data_source;

INSERT INTO sensor_points(point_code,sensor_code,measurement_type,unit,point_status)
VALUES
 ('SAT-501A','S-L5-001','Supply Air Temperature','°C','Online'),
 ('AF-501A','S-L5-002','Air Velocity','m/s','Online'),
 ('FS-501A','FS-501A','Fan Status','Boolean','Online'),
 ('SAT-504','S-L5-003','Supply Air Temperature','°C','Online'),
 ('AF-504','S-L5-004','Air Velocity','m/s','Online'),
 ('DP-504','S-L5-005','Damper Position','%','Online'),
 ('SAT-507','S-L5-006','Supply Air Temperature','°C','Online'),
 ('AF-507','S-L5-007','Air Velocity','m/s','Online'),
 ('S-L5-008-TEMP','S-L5-008','Temperature','°C','Online'),
 ('S-L5-008-HUM','S-L5-008','Humidity','%RH','Online'),
 ('S-L5-008-CO2','S-L5-008','CO2','ppm','Online')
ON CONFLICT(point_code) DO UPDATE
SET sensor_code=EXCLUDED.sensor_code,measurement_type=EXCLUDED.measurement_type,
    unit=EXCLUDED.unit,point_status=EXCLUDED.point_status;

COMMIT;

