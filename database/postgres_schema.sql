-- =========================================================
-- DIGITAL TWIN DATABASE
-- PostgreSQL + TimescaleDB
-- =========================================================

-- =========================================================
-- ENABLE TIMESCALEDB
-- =========================================================

-- CREATE EXTENSION IF NOT EXISTS timescaledb;


-- =========================================================
-- ENUM TYPES
-- =========================================================

CREATE TYPE bim_element_type AS ENUM (
    'Equipment',
    'Sensor'
);

CREATE TYPE prediction_type AS ENUM (
    'Normal',
    'Abnormal'
);

CREATE TYPE maintenance_type AS ENUM (
    'Preventive',
    'Corrective'
);

CREATE TYPE maintenance_status AS ENUM (
    'Pending',
    'In Progress',
    'Completed'
);


-- =========================================================
-- 1. BUILDINGS
-- =========================================================

CREATE TABLE buildings (
    building_code VARCHAR(50) PRIMARY KEY,
    building_name VARCHAR(255) NOT NULL,
    building_type VARCHAR(50) NOT NULL
);


-- =========================================================
-- 2. BIM MODELS
-- Current PoC: one BIM model per building
-- =========================================================

CREATE TABLE bim_models (
    building_code VARCHAR(50) PRIMARY KEY,
    model_name VARCHAR(255) NOT NULL,
    file_reference VARCHAR(255) NOT NULL,

    CONSTRAINT fk_bim_model_building
        FOREIGN KEY (building_code)
        REFERENCES buildings(building_code)
);


-- =========================================================
-- 3. BUILDING FLOORS
-- Composite PK: building_code + floor_level
-- =========================================================

CREATE TABLE building_floors (
    building_code VARCHAR(50) NOT NULL,
    floor_level VARCHAR(50) NOT NULL,

    CONSTRAINT pk_building_floors
        PRIMARY KEY (building_code, floor_level),

    CONSTRAINT fk_floor_building
        FOREIGN KEY (building_code)
        REFERENCES buildings(building_code)
);


-- =========================================================
-- 4. BIM ELEMENTS
-- =========================================================

CREATE TABLE bim_elements (
    global_id VARCHAR(100) PRIMARY KEY,
    building_code VARCHAR(50) NOT NULL,
    element_type bim_element_type NOT NULL,

    CONSTRAINT fk_bim_element_building
        FOREIGN KEY (building_code)
        REFERENCES buildings(building_code)
);


-- =========================================================
-- 5. LOCATIONS
-- =========================================================

CREATE TABLE locations (
    location_code VARCHAR(50) PRIMARY KEY,
    building_code VARCHAR(50) NOT NULL,
    floor_level VARCHAR(50) NOT NULL,
    location_name VARCHAR(100) NOT NULL,
    location_type VARCHAR(50) NOT NULL,

    CONSTRAINT fk_location_floor
        FOREIGN KEY (building_code, floor_level)
        REFERENCES building_floors(building_code, floor_level)
);


-- =========================================================
-- 6. EQUIPMENT
-- =========================================================

CREATE TABLE equipment (
    equipment_code VARCHAR(50) PRIMARY KEY,
    global_id VARCHAR(100) NOT NULL,
    location_code VARCHAR(50) NOT NULL,
    equipment_type VARCHAR(50) NOT NULL,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    equipment_status VARCHAR(50) NOT NULL,
    installation_date DATE,

    CONSTRAINT fk_equipment_bim
        FOREIGN KEY (global_id)
        REFERENCES bim_elements(global_id),

    CONSTRAINT fk_equipment_location
        FOREIGN KEY (location_code)
        REFERENCES locations(location_code)
);


-- =========================================================
-- 7. SENSORS
-- =========================================================

CREATE TABLE sensors (
    sensor_code VARCHAR(50) PRIMARY KEY,
    equipment_code VARCHAR(50) NOT NULL,
    global_id VARCHAR(100) NOT NULL,

    sensor_name VARCHAR(255),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    sensor_status VARCHAR(50) NOT NULL,
    data_source VARCHAR(50),

    CONSTRAINT fk_sensor_equipment
        FOREIGN KEY (equipment_code)
        REFERENCES equipment(equipment_code),

    CONSTRAINT fk_sensor_bim
        FOREIGN KEY (global_id)
        REFERENCES bim_elements(global_id)
);

-- =========================================================
-- SENSOR POINTS / MEASUREMENT CHANNELS
-- One physical sensor may expose multiple measured variables
-- =========================================================

CREATE TABLE sensor_points (
    point_code VARCHAR(50) PRIMARY KEY,
    sensor_code VARCHAR(50) NOT NULL,

    measurement_type VARCHAR(50) NOT NULL,
    unit VARCHAR(20) NOT NULL,

    point_status VARCHAR(50) NOT NULL DEFAULT 'Online',

    CONSTRAINT fk_sensor_point_sensor
        FOREIGN KEY (sensor_code)
        REFERENCES sensors(sensor_code),

    CONSTRAINT uq_sensor_measurement
        UNIQUE (sensor_code, measurement_type)
);

-- =========================================================
-- 8. ROLES
-- =========================================================

CREATE TABLE roles (
    role_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
);


-- =========================================================
-- 9. USERS
-- =========================================================

CREATE TABLE users (
    user_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id INT NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_user_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id)
);


-- =========================================================
-- 10. SENSOR READINGS
-- Time-series table
-- =========================================================

CREATE TABLE sensor_readings (
    reading_id INT GENERATED ALWAYS AS IDENTITY,
    point_code VARCHAR(50) NOT NULL,
    reading_timestamp TIMESTAMPTZ NOT NULL,
    reading_value DECIMAL(10,2) NOT NULL,
    quality VARCHAR(50),

    CONSTRAINT pk_sensor_readings
        PRIMARY KEY (reading_id, reading_timestamp),

    CONSTRAINT fk_reading_sensor_point
        FOREIGN KEY (point_code)
        REFERENCES sensor_points(point_code)
);

-- Convert sensor readings into a TimescaleDB hypertable
-- SELECT create_hypertable(
--     'sensor_readings',
--     'reading_timestamp',
--     if_not_exists => TRUE
-- );


-- =========================================================
-- 11. AI RESULTS
-- =========================================================

CREATE TABLE ai_results (
    ai_result_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    reading_id INT NOT NULL,
    reading_timestamp TIMESTAMPTZ NOT NULL,

    prediction prediction_type NOT NULL,
    anomaly_score DECIMAL(5,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT,

    CONSTRAINT fk_ai_result_reading
        FOREIGN KEY (reading_id, reading_timestamp)
        REFERENCES sensor_readings(reading_id, reading_timestamp),

    CONSTRAINT chk_anomaly_score
        CHECK (anomaly_score >= 0 AND anomaly_score <= 1)
);


-- =========================================================
-- 12. ALERT SEVERITY
-- =========================================================

CREATE TABLE alert_severity (
    alert_severity_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    severity_name VARCHAR(50) NOT NULL UNIQUE
);


-- =========================================================
-- 13. ALERT STATUS
-- =========================================================

CREATE TABLE alert_status (
    alert_status_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status_name VARCHAR(50) NOT NULL UNIQUE
);


-- =========================================================
-- 14. ALERTS
-- =========================================================

CREATE TABLE alerts (
    alert_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ai_result_id INT NOT NULL,
    alert_severity_id INT NOT NULL,
    alert_status_id INT NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,

    CONSTRAINT fk_alert_ai_result
        FOREIGN KEY (ai_result_id)
        REFERENCES ai_results(ai_result_id),

    CONSTRAINT fk_alert_severity
        FOREIGN KEY (alert_severity_id)
        REFERENCES alert_severity(alert_severity_id),

    CONSTRAINT fk_alert_status
        FOREIGN KEY (alert_status_id)
        REFERENCES alert_status(alert_status_id)
);


-- =========================================================
-- 15. NOTIFICATIONS
-- =========================================================

CREATE TABLE notifications (
    notification_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_id INT NOT NULL,
    user_id INT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notification_alert
        FOREIGN KEY (alert_id)
        REFERENCES alerts(alert_id),

    CONSTRAINT fk_notification_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
);


-- =========================================================
-- 16. MAINTENANCE EVENTS
-- =========================================================

CREATE TABLE maintenance_events (
    maintenance_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipment_code VARCHAR(50) NOT NULL,
    maintenance_type maintenance_type NOT NULL,
    maintenance_date TIMESTAMPTZ NOT NULL,
    description TEXT,
    maintenance_status maintenance_status NOT NULL,
    performed_by VARCHAR(100),

    CONSTRAINT fk_maintenance_equipment
        FOREIGN KEY (equipment_code)
        REFERENCES equipment(equipment_code)
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_sensor_readings_point_time
ON sensor_readings(point_code, reading_timestamp DESC);

CREATE INDEX idx_ai_results_reading
ON ai_results(reading_id, reading_timestamp);

CREATE INDEX idx_alerts_ai_result
ON alerts(ai_result_id);

CREATE INDEX idx_alerts_severity
ON alerts(alert_severity_id);

CREATE INDEX idx_alerts_status
ON alerts(alert_status_id);

CREATE INDEX idx_notifications_alert
ON notifications(alert_id);

CREATE INDEX idx_notifications_user
ON notifications(user_id);

CREATE INDEX idx_maintenance_equipment
ON maintenance_events(equipment_code);