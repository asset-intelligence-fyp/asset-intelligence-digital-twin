import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import mqtt from "mqtt";
import { LIVE_POINT_ASSETS, validateLiveMqttMessage } from "./liveMqttContract.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

dotenv.config();

const { Pool, types } = pg;

// Keep PostgreSQL TIMESTAMP WITHOUT TIME ZONE values
// as ISO-like strings instead of automatically converting them.
types.setTypeParser(1114, (value) => value?.replace(" ", "T"));


// =========================================================
// POSTGRESQL CONNECTION
// =========================================================

const poolOptions = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL
    }
  : {
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || "digital_twin",
      ...(process.env.PGUSER
        ? { user: process.env.PGUSER }
        : {}),
      ...(process.env.PGPASSWORD
        ? { password: process.env.PGPASSWORD }
        : {})
    };

if (process.env.PGSSL === "true") {
  poolOptions.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolOptions);


// =========================================================
// EXPRESS
// =========================================================

const app = express();

const port = Number(
  process.env.SERVER_PORT || 3001
);

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

// =========================================================
// MQTT + LIVE EVENT CONFIGURATION
// =========================================================

const MQTT_URL =
  process.env.MQTT_URL ||
  "mqtt://localhost:1883";

const MQTT_TOPIC =
  process.env.MQTT_TOPIC ||
  "dt/+/+";

const mqttClient = mqtt.connect(MQTT_URL, {
  ...(process.env.MQTT_USERNAME ? { username: process.env.MQTT_USERNAME } : {}),
  ...(process.env.MQTT_PASSWORD ? { password: process.env.MQTT_PASSWORD } : {})
});
const mqttLiveStatus = {
  connected: false,
  last_received_at: null,
  last_point_code: null,
  last_source_timestamp: null,
  received_count: 0,
  last_provenance: null,
  by_point: Object.fromEntries(Object.keys(LIVE_POINT_ASSETS).map(code => [code, null]))
};
const ignoredLegacyWarnings = new Map();

const liveClients = new Set();


// MQTT transport state and last persisted simulated reading; no assumption
// that the external Python process itself is still running.
app.get("/api/live-status", (_req, res) => {
  const now = Date.now();
  const points = Object.entries(mqttLiveStatus.by_point).map(([point_code, last_received_at]) => {
    const age_seconds = last_received_at
      ? Math.max(0, Math.floor((now - Date.parse(last_received_at)) / 1000)) : null;
    return {point_code,last_received_at,age_seconds,
      recent: mqttLiveStatus.connected && age_seconds !== null && age_seconds < 90};
  });
  const received_points = points.filter(point => point.recent).length;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    mqtt_connected: mqttLiveStatus.connected,
    last_received_at: mqttLiveStatus.last_received_at,
    last_point_code: mqttLiveStatus.last_point_code,
    last_source_timestamp: mqttLiveStatus.last_source_timestamp,
    accepted_readings: mqttLiveStatus.received_count,
    expected_points: points.length,
    received_points,
    points,
    recent: mqttLiveStatus.connected && received_points === points.length,
    source: mqttLiveStatus.last_provenance === "SYNTHETIC_RANDOM_WALK_NINE_POINT" ? "random_walk_simulator" : "independent_synthetic_simulator",
    note: "Coverage counts persisted synthetic MQTT readings; no physical HRUs or AI inference"
  });
});

mqttClient.on("close", () => { mqttLiveStatus.connected = false; });

// =========================================================
// DATABASE HELPER
// =========================================================

async function rows(sql, params = []) {
  const result = await pool.query(sql, params);

  return result.rows;
}


// =========================================================
// HEALTH CHECK
// =========================================================

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        NOW() AS server_time
    `);

    res.json({
      ok: true,
      ...result.rows[0]
    });

  } catch (error) {

    res.status(503).json({
      ok: false,
      error: "PostgreSQL connection failed",
      detail: error.message
    });
  }
});

// =========================================================
// SERVER-SENT EVENTS
// Browser listens here for live Digital Twin updates
// =========================================================

app.get("/api/events", (req, res) => {

  res.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.flushHeaders?.();

  // Initial connection event
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      connected: true
    })}\n\n`
  );

  liveClients.add(res);

  req.on("close", () => {
    liveClients.delete(res);
  });
});


function broadcastLiveEvent(
  eventName,
  payload
) {

  const message =
    `event: ${eventName}\n` +
    `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of liveClients) {
    client.write(message);
  }
}

// =========================================================
// MQTT INGESTION
// =========================================================

mqttClient.on("connect", () => {
  mqttLiveStatus.connected = true;

  console.log(
    `MQTT connected: ${MQTT_URL}`
  );

  mqttClient.subscribe(
    MQTT_TOPIC,
    (error) => {

      if (error) {
        console.error(
          "MQTT subscription failed:",
          error
        );

        return;
      }

      console.log(
        `MQTT subscribed: ${MQTT_TOPIC}`
      );
    }
  );
});


mqttClient.on(
  "error",
  (error) => {

    console.error(
      "MQTT error:",
      error.message
    );
  }
);


mqttClient.on(
  "message",
  async (topic, buffer) => {

    try {

      // Do not ingest test-only ground truth.
      if (
        topic.startsWith(
          "dt/test/groundtruth/"
        )
      ) {
        return;
      }


      // -----------------------------------------------------
      // PARSE MESSAGE
      // -----------------------------------------------------

      const message =
        JSON.parse(
          buffer.toString("utf8")
        );


      // Reject legacy feeds *before* doing any SQL writes. In particular, the
      // old hru-simulator-v2 can use some valid topics but not this provenance.
      const contract = validateLiveMqttMessage(topic, message);
      if (!contract.ok) {
        const key = `${contract.reason}:${contract.point_code || topic}`;
        const now = Date.now();
        if ((ignoredLegacyWarnings.get(key) || 0) < now - 30000) {
          console.warn(`[MQTT] Ignored ${key}; stop any old simulator process`);
          ignoredLegacyWarnings.set(key, now);
        }
        return;
      }

      const {
        timestamp,
        asset_id,
        sensor_id,
        point_code,
        reading_type,
        value,
        unit,
        sequence,
        quality
      } = message;


      // -----------------------------------------------------
      // BASIC VALIDATION
      // -----------------------------------------------------

      if (
        !timestamp ||
        !asset_id ||
        !sensor_id ||
        !point_code ||
        value === undefined ||
        value === null
      ) {

        console.warn(
          "Rejected MQTT message: missing required fields",
          message
        );

        return;
      }


      const numericValue =
        Number(value);


      if (
        !Number.isFinite(
          numericValue
        )
      ) {

        console.warn(
          "Rejected MQTT reading: invalid numeric value",
          message
        );

        return;
      }


      // -----------------------------------------------------
      // VERIFY DATABASE MAPPING
      //
      // point -> physical sensor -> equipment
      // -----------------------------------------------------

      const mapping =
        await pool.query(
          `
            SELECT
              sp.point_code,
              sp.sensor_code,
              sp.measurement_type,
              sp.unit,

              s.equipment_code

            FROM sensor_points sp

            JOIN sensors s
              ON s.sensor_code =
                 sp.sensor_code

            WHERE
              sp.point_code = $1
              AND sp.point_status = 'Online'
          `,
          [point_code]
        );


      if (
        !mapping.rows.length
      ) {

        console.warn(
          `Rejected unmapped point: ${point_code}`
        );

        return;
      }


      const mapped =
        mapping.rows[0];


      // -----------------------------------------------------
      // CHECK SENSOR / ASSET MAPPING
      // -----------------------------------------------------

      if (
        !new Set([
          String(mapped.sensor_code),
          String(point_code),
        ]).has(String(sensor_id))
      ) {

        console.warn(
          `Rejected mapping mismatch: ${point_code} belongs to ${mapped.sensor_code}, not ${sensor_id}`
        );

        return;
      }


      if (
        String(mapped.equipment_code) !==
        String(asset_id)
      ) {

        console.warn(
          `Rejected asset mismatch: ${point_code} belongs to ${mapped.equipment_code}, not ${asset_id}`
        );

        return;
      }


      // -----------------------------------------------------
      // INSERT INTO POSTGRESQL
      // -----------------------------------------------------

      const inserted =
        await pool.query(
          `
            INSERT INTO sensor_readings (
              point_code,
              reading_timestamp,
              reading_value,
              quality
            )

            VALUES (
              $1,
              $2,
              $3,
              $4
            )

            RETURNING
              reading_id,
              point_code,
              reading_timestamp,
              reading_value,
              quality
          `,
          [
            point_code,
            timestamp,
            numericValue,
            quality || "simulated"
          ]
        );


      const row =
        inserted.rows[0];


      const liveReading = {

        reading_id:
          row.reading_id,

        point_code:
          row.point_code,

        sensor_id:
          mapped.sensor_code,

        asset_id:
          mapped.equipment_code,

        measurement_type:
          mapped.measurement_type,

        unit:
          mapped.unit,

        value:
          Number(
            row.reading_value
          ),

        quality:
          row.quality,

        timestamp:
          row.reading_timestamp,

        latest_update:
          row.reading_timestamp,

        source_sequence:
          sequence ?? null,

        source_timestamp:
          message.source_timestamp ?? null,

        source:
          "MQTT"
      };


      console.log(
        `[MQTT] ${asset_id} / ${sensor_id} / ${point_code} = ${numericValue} ${mapped.unit}`
      );


      // -----------------------------------------------------
      // PUSH UPDATE TO BROWSER
      // -----------------------------------------------------

      mqttLiveStatus.last_received_at = new Date().toISOString();
      mqttLiveStatus.last_point_code = point_code;
      mqttLiveStatus.by_point[point_code] = mqttLiveStatus.last_received_at;
      mqttLiveStatus.last_source_timestamp = message.source_timestamp || null;
      mqttLiveStatus.last_provenance = message.provenance || null;
      mqttLiveStatus.received_count += 1;

      broadcastLiveEvent(
        "sensor-reading",
        liveReading
      );


    } catch (error) {

      console.error(
        "MQTT ingestion failed:",
        error
      );
    }
  }
);

// =========================================================
// BOOTSTRAP
//
// Loads everything required by the frontend.
//
// IMPORTANT:
//
// Physical device:
// sensors
//
// Measurement channels:
// sensor_points
//
// Time-series values:
// sensor_readings
//
// Example:
//
// S-L5-008 → S-L5-008-TEMP (nine-point profile); HUM and CO2 are archived.
//
// =========================================================

app.get("/api/bootstrap", async (_req, res) => {
  try {

    const [
      BIM_Models,
      Buildings,
      Building_Floors,
      Spaces,
      Assets,
      Maintenance_Events,
      Sensors,
      Sensor_Points,
      Sensor_Readings,
      Historical_Sensor_Readings,
      Anomaly_Results,
      Alerts_Status,
      Alerts_Severity,
      Alerts
    ] = await Promise.all([


      // =====================================================
      // BIM MODELS
      // =====================================================

      rows(`
        SELECT
          building_code AS model_id,
          building_code,
          model_name,
          file_reference
        FROM bim_models
        ORDER BY building_code
      `),


      // =====================================================
      // BUILDINGS
      // =====================================================

      rows(`
        SELECT
          building_code AS building_id,
          building_code,
          building_name,
          building_type
        FROM buildings
        ORDER BY building_code
      `),


      // =====================================================
      // FLOORS
      // =====================================================

      rows(`
        SELECT
          building_code || ':' || floor_level AS floor_id,
          building_code,
          floor_level,
          floor_level AS floor_name
        FROM building_floors
        ORDER BY
          building_code,
          floor_level
      `),


      // =====================================================
      // LOCATIONS
      //
      // Returned as "Spaces" to avoid having to rewrite all
      // existing frontend components immediately.
      // =====================================================

      rows(`
        SELECT
          location_code AS space_id,
          building_code || ':' || floor_level AS floor_id,
          location_name AS space_name,
          location_type AS space_type,
          building_code,
          floor_level
        FROM locations
        ORDER BY location_code
      `),


      // =====================================================
      // EQUIPMENT
      //
      // Returned as frontend "Assets".
      // =====================================================

      rows(`
        SELECT
          equipment_code AS asset_id,
          equipment_code AS asset_name,
          equipment_type AS asset_type,
          location_code AS space_id,
          global_id AS ifc_global_id,
          equipment_status AS status,
          installation_date,
          manufacturer,
          model
        FROM equipment
        ORDER BY equipment_code
      `),


      // =====================================================
      // MAINTENANCE EVENTS
      // =====================================================

      rows(`
        SELECT
          maintenance_id,
          equipment_code AS asset_id,
          maintenance_date AS event_date,
          maintenance_type::text AS event_type,
          maintenance_status::text AS maintenance_status,
          description,
          performed_by
        FROM maintenance_events
        ORDER BY maintenance_date DESC
      `),


      // =====================================================
      // PHYSICAL SENSOR DEVICES
      //
      // Example:
      // S-L5-008
      // ABB Fusion Smart Sensor
      //
      // The BIM GlobalId belongs here.
      // =====================================================

      rows(`
        SELECT
          sensor_code AS sensor_id,
          equipment_code AS asset_id,
          global_id AS ifc_global_id,
          sensor_name,
          manufacturer,
          model,
          sensor_status AS status,
          data_source
        FROM sensors s
        WHERE EXISTS (
          SELECT 1 FROM sensor_points sp
          WHERE sp.sensor_code = s.sensor_code
            AND sp.point_status = 'Online'
        )
        ORDER BY s.sensor_code
      `),


      // =====================================================
      // SENSOR POINTS / MEASUREMENT CHANNELS
      //
      // Example:
      // S-L5-008-TEMP
      // S-L5-008-HUM
      // S-L5-008-CO2
      // =====================================================

      rows(`
        SELECT
          point_code,
          sensor_code AS sensor_id,
          measurement_type,
          unit,
          point_status AS status
        FROM sensor_points
        WHERE point_status = 'Online'
        ORDER BY
          sensor_code,
          point_code
      `),


      // =====================================================
      // LATEST READING FOR EACH MEASUREMENT POINT
      // =====================================================

      rows(`
        SELECT DISTINCT ON (point_code)
          point_code,
          reading_timestamp AS latest_update,
          reading_value AS value,
          quality
        FROM sensor_readings
        WHERE point_code IN (
          SELECT point_code FROM sensor_points WHERE point_status = 'Online'
        )
        ORDER BY
          point_code,
          reading_timestamp DESC
      `),


      // =====================================================
      // COMPLETE HISTORICAL SENSOR READINGS
      // =====================================================

      rows(`
        SELECT
          point_code,
          reading_timestamp AS timestamp,
          reading_value AS value,
          quality
        FROM sensor_readings
        WHERE point_code IN (
          SELECT point_code FROM sensor_points WHERE point_status = 'Online'
        )
        ORDER BY
          reading_timestamp,
          point_code
      `),


      // =====================================================
      // AI / ANOMALY RESULTS
      //
      // AI result
      //   ↓
      // sensor_reading
      //   ↓
      // sensor_point
      //   ↓
      // physical sensor
      //   ↓
      // equipment
      // =====================================================

      rows(`
        SELECT
          ar.ai_result_id AS anomaly_id,

          sp.point_code,

          s.sensor_code AS sensor_id,

          s.equipment_code AS asset_id,

          ar.reading_timestamp AS timestamp,

          ar.anomaly_score,

          ar.description,

          ar.prediction::text AS prediction,

          COALESCE(
            alert_info.status_name,
            'New'
          ) AS anomaly_status,

          COALESCE(
            alert_info.severity_name,
            'Medium'
          ) AS severity

        FROM ai_results ar

        JOIN sensor_readings sr
          ON sr.reading_id =
             ar.reading_id
         AND sr.reading_timestamp =
             ar.reading_timestamp

        JOIN sensor_points sp
          ON sp.point_code =
             sr.point_code
         AND sp.point_status = 'Online'

        JOIN sensors s
          ON s.sensor_code =
             sp.sensor_code

        LEFT JOIN LATERAL (

          SELECT
            ast.status_name,
            asev.severity_name

          FROM alerts al

          JOIN alert_status ast
            ON ast.alert_status_id =
               al.alert_status_id

          JOIN alert_severity asev
            ON asev.alert_severity_id =
               al.alert_severity_id

          WHERE al.ai_result_id =
                ar.ai_result_id

          ORDER BY
            al.triggered_at DESC

          LIMIT 1

        ) alert_info
          ON TRUE

        ORDER BY
          ar.reading_timestamp DESC
      `),


      // =====================================================
      // ALERT STATUS LOOKUP
      // =====================================================

      rows(`
        SELECT
          alert_status_id AS status_id,
          status_name
        FROM alert_status
        ORDER BY alert_status_id
      `),


      // =====================================================
      // ALERT SEVERITY LOOKUP
      // =====================================================

      rows(`
        SELECT
          alert_severity_id AS severity_id,
          severity_name
        FROM alert_severity
        ORDER BY alert_severity_id
      `),


      // =====================================================
      // ALERTS
      // =====================================================

      rows(`
        SELECT
          al.alert_id,

          al.ai_result_id AS anomaly_id,

          al.alert_type,

          al.message,

          al.triggered_at AS created_at,

          al.resolved_at,

          ast.status_name AS alert_status,

          asev.severity_name AS severity

        FROM alerts al

        JOIN alert_status ast
          ON ast.alert_status_id =
             al.alert_status_id

        JOIN alert_severity asev
          ON asev.alert_severity_id =
             al.alert_severity_id

        ORDER BY
          al.triggered_at DESC
      `)
    ]);


    // =======================================================
    // RETURN FRONTEND DATA
    // =======================================================

    res.json({
      meta: {
        source: "PostgreSQL",

        database:
          poolOptions.database ||
          "DATABASE_URL",

        loaded_at:
          new Date().toISOString(),

        demo_data: false
      },

      data: {
        BIM_Models,
        Buildings,
        Building_Floors,
        Spaces,
        Assets,
        Maintenance_Events,
        Sensors,
        Sensor_Points,
        Sensor_Readings,
        Historical_Sensor_Readings,
        Anomaly_Results,
        Alerts_Status,
        Alerts_Severity,
        Alerts
      }
    });

  } catch (error) {

    console.error(
      "Bootstrap database error:",
      error
    );

    res.status(503).json({
      error:
        "Unable to load Digital Twin data from PostgreSQL",

      detail:
        error.message,

      hint:
        "Check the digital_twin schema, seed data and PostgreSQL connection."
    });
  }
});


// =========================================================
// GET ALL ASSETS / EQUIPMENT
// =========================================================

app.get("/api/assets", async (_req, res) => {
  try {

    const data = await rows(`
      SELECT
        e.equipment_code AS asset_id,

        e.equipment_code AS asset_name,

        e.equipment_type AS asset_type,

        e.global_id AS ifc_global_id,

        e.equipment_status AS status,

        e.manufacturer,

        e.model,

        e.installation_date,

        l.location_code AS space_id,

        l.location_name AS space_name,

        l.location_type AS space_type,

        l.building_code || ':' ||
        l.floor_level AS floor_id,

        l.floor_level AS floor_name,

        l.floor_level

      FROM equipment e

      JOIN locations l
        ON l.location_code =
           e.location_code

      ORDER BY
        e.equipment_code
    `);

    res.json(data);

  } catch (error) {

    res.status(500).json({
      error: error.message
    });
  }
});


// =========================================================
// GET ONE ASSET
// =========================================================

app.get("/api/assets/:id", async (req, res) => {
  try {

    const assetId =
      String(
        req.params.id || ""
      ).trim();

    if (!assetId) {
      return res.status(400).json({
        error: "Invalid asset id"
      });
    }


    // =======================================================
    // ASSET
    // =======================================================

    const assetRows = await rows(`
      SELECT
        e.equipment_code AS asset_id,

        e.equipment_code AS asset_name,

        e.equipment_type AS asset_type,

        e.global_id AS ifc_global_id,

        e.equipment_status AS status,

        e.manufacturer,

        e.model,

        e.installation_date,

        l.location_code AS space_id,

        l.location_name AS space_name,

        l.location_type AS space_type,

        l.building_code || ':' ||
        l.floor_level AS floor_id,

        l.floor_level AS floor_name,

        l.floor_level

      FROM equipment e

      JOIN locations l
        ON l.location_code =
           e.location_code

      WHERE
        e.equipment_code = $1
    `, [assetId]);


    if (!assetRows.length) {
      return res.status(404).json({
        error: "Asset not found"
      });
    }


    // =======================================================
    // ASSOCIATED DATA
    // =======================================================

    const [
      sensors,
      points,
      maintenance,
      anomalies
    ] = await Promise.all([


      // -----------------------------------------------------
      // PHYSICAL SENSOR DEVICES
      // -----------------------------------------------------

      rows(`
        SELECT
          sensor_code AS sensor_id,

          equipment_code AS asset_id,

          global_id AS ifc_global_id,

          sensor_name,

          manufacturer,

          model,

          sensor_status AS status,

          data_source

        FROM sensors s

        WHERE
          equipment_code = $1
          AND EXISTS (
            SELECT 1 FROM sensor_points sp
            WHERE sp.sensor_code=s.sensor_code
              AND sp.point_status='Online'
          )

        ORDER BY
          sensor_code
      `, [assetId]),


      // -----------------------------------------------------
      // MEASUREMENT POINTS + LATEST VALUES
      // -----------------------------------------------------

      rows(`
        SELECT
          sp.point_code,

          sp.sensor_code AS sensor_id,

          sp.measurement_type,

          sp.unit,

          sp.point_status AS status,

          latest.latest_update,

          latest.value,

          latest.quality

        FROM sensor_points sp

        JOIN sensors s
          ON s.sensor_code =
             sp.sensor_code

        LEFT JOIN LATERAL (

          SELECT
            sr.reading_timestamp
              AS latest_update,

            sr.reading_value
              AS value,

            sr.quality

          FROM sensor_readings sr

          WHERE
            sr.point_code =
            sp.point_code

          ORDER BY
            sr.reading_timestamp DESC

          LIMIT 1

        ) latest
          ON TRUE

        WHERE
          s.equipment_code = $1
          AND sp.point_status = 'Online'

        ORDER BY
          sp.sensor_code,
          sp.point_code
      `, [assetId]),


      // -----------------------------------------------------
      // MAINTENANCE
      // -----------------------------------------------------

      rows(`
        SELECT
          maintenance_id,

          equipment_code AS asset_id,

          maintenance_type::text
            AS event_type,

          maintenance_date
            AS event_date,

          description,

          maintenance_status::text
            AS maintenance_status,

          performed_by

        FROM maintenance_events

        WHERE
          equipment_code = $1

        ORDER BY
          maintenance_date DESC
      `, [assetId]),


      // -----------------------------------------------------
      // AI RESULTS
      // -----------------------------------------------------

      rows(`
        SELECT
          ar.ai_result_id
            AS anomaly_id,

          sp.point_code,

          s.sensor_code
            AS sensor_id,

          ar.reading_timestamp
            AS timestamp,

          ar.prediction::text
            AS prediction,

          ar.anomaly_score,

          ar.description

        FROM ai_results ar

        JOIN sensor_readings sr
          ON sr.reading_id =
             ar.reading_id
         AND sr.reading_timestamp =
             ar.reading_timestamp

        JOIN sensor_points sp
          ON sp.point_code =
             sr.point_code
         AND sp.point_status = 'Online'

        JOIN sensors s
          ON s.sensor_code =
             sp.sensor_code

        WHERE
          s.equipment_code = $1

        ORDER BY
          ar.reading_timestamp DESC
      `, [assetId])
    ]);


    res.json({
      asset:
        assetRows[0],

      sensors,

      points,

      maintenance,

      anomalies
    });

  } catch (error) {

    res.status(500).json({
      error: error.message
    });
  }
});


// =========================================================
// SENSOR HISTORY
//
// Returns all measurement channels for one physical sensor.
//
// Example:
//
// /api/sensors/S-L5-008/history
//
// =========================================================

app.get(
  "/api/sensors/:sensorId/history",
  async (req, res) => {

    try {

      const sensorId =
        String(
          req.params.sensorId || ""
        ).trim();


      if (!sensorId) {

        return res
          .status(400)
          .json({
            error:
              "Invalid sensor id"
          });
      }


      const data = await rows(`
        SELECT
          sp.sensor_code
            AS sensor_id,

          sp.point_code,

          sp.measurement_type,

          sp.unit,

          sr.reading_timestamp
            AS timestamp,

          sr.reading_value
            AS value,

          sr.quality

        FROM sensor_points sp

        LEFT JOIN sensor_readings sr
          ON sr.point_code =
             sp.point_code

        WHERE
          sp.sensor_code = $1

        ORDER BY
          sp.point_code,
          sr.reading_timestamp
      `, [sensorId]);


      res.json(data);

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);


// =========================================================
// ANOMALIES
// =========================================================

app.get(
  "/api/anomalies",
  async (_req, res) => {

    try {

      const data =
        await rows(`

        SELECT
          ar.ai_result_id
            AS anomaly_id,

          sp.point_code,

          sp.measurement_type,

          s.sensor_code
            AS sensor_id,

          s.equipment_code
            AS asset_id,

          e.equipment_code
            AS asset_name,

          l.location_name
            AS space_name,

          l.floor_level
            AS floor_name,

          ar.reading_timestamp
            AS timestamp,

          ar.prediction::text
            AS prediction,

          ar.anomaly_score,

          ar.description,

          COALESCE(
            ast.status_name,
            'New'
          ) AS anomaly_status,

          COALESCE(
            asev.severity_name,
            'Medium'
          ) AS severity

        FROM ai_results ar

        JOIN sensor_readings sr
          ON sr.reading_id =
             ar.reading_id
         AND sr.reading_timestamp =
             ar.reading_timestamp

        JOIN sensor_points sp
          ON sp.point_code =
             sr.point_code
         AND sp.point_status = 'Online'

        JOIN sensors s
          ON s.sensor_code =
             sp.sensor_code

        LEFT JOIN equipment e
          ON e.equipment_code =
             s.equipment_code

        LEFT JOIN locations l
          ON l.location_code =
             e.location_code

        LEFT JOIN LATERAL (

          SELECT
            al.alert_status_id,
            al.alert_severity_id

          FROM alerts al

          WHERE
            al.ai_result_id =
            ar.ai_result_id

          ORDER BY
            al.triggered_at DESC

          LIMIT 1

        ) latest_alert
          ON TRUE

        LEFT JOIN alert_status ast
          ON ast.alert_status_id =
             latest_alert.alert_status_id

        LEFT JOIN alert_severity asev
          ON asev.alert_severity_id =
             latest_alert.alert_severity_id

        ORDER BY
          ar.reading_timestamp DESC
      `);


      res.json(data);

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);


// =========================================================
// UPDATE ANOMALY / ALERT STATUS
// =========================================================

app.patch(
  "/api/anomalies/:id/status",
  async (req, res) => {

    const anomalyId =
      Number(req.params.id);

    const allowed =
      new Set([
        "New",
        "Review",
        "Acknowledged",
        "Closed"
      ]);

    const status =
      String(
        req.body?.status || ""
      );


    if (!Number.isInteger(anomalyId)) {

      return res
        .status(400)
        .json({
          error:
            "Invalid anomaly id"
        });
    }


    if (!allowed.has(status)) {

      return res
        .status(400)
        .json({
          error:
            "Unsupported status"
        });
    }


    const client =
      await pool.connect();


    try {

      await client.query(
        "BEGIN"
      );


      // -----------------------------------------------------
      // LOOK UP STATUS ID
      // -----------------------------------------------------

      const statusRow =
        await client.query(
          `
            SELECT
              alert_status_id
            FROM alert_status
            WHERE
              status_name = $1
          `,
          [status]
        );


      if (!statusRow.rows.length) {

        await client.query(
          "ROLLBACK"
        );

        return res
          .status(400)
          .json({
            error:
              `Alert status '${status}' is not configured`
          });
      }


      // -----------------------------------------------------
      // UPDATE ALERT
      // -----------------------------------------------------

      const updated =
        await client.query(
          `
            UPDATE alerts

            SET
              alert_status_id = $1,

              resolved_at =
                CASE
                  WHEN $2 = 'Closed'
                  THEN COALESCE(
                    resolved_at,
                    NOW()
                  )
                  ELSE resolved_at
                END

            WHERE
              ai_result_id = $3

            RETURNING *
          `,
          [
            statusRow.rows[0]
              .alert_status_id,

            status,

            anomalyId
          ]
        );


      if (!updated.rows.length) {

        await client.query(
          "ROLLBACK"
        );

        return res
          .status(404)
          .json({
            error:
              "No alert exists for this AI result"
          });
      }


      await client.query(
        "COMMIT"
      );


      res.json({
        ok: true,
        anomaly_id:
          anomalyId,
        status
      });

    } catch (error) {

      await client.query(
        "ROLLBACK"
      );


      res
        .status(500)
        .json({
          error:
            error.message
        });

    } finally {

      client.release();
    }
  }
);


// =========================================================
// SERVE PRODUCTION BUILD IF AVAILABLE
// =========================================================

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const distDir =
  path.resolve(
    __dirname,
    "../dist"
  );


if (
  fs.existsSync(
    distDir
  )
) {

  app.use(
    express.static(
      distDir
    )
  );


  app.get(
    "*",
    (_req, res) => {

      res.sendFile(
        path.join(
          distDir,
          "index.html"
        )
      );
    }
  );
}


// =========================================================
// START SERVER
// =========================================================

app.listen(
  port,
  () => {

    console.log(
      `Asset Intelligence API listening on http://localhost:${port}`
    );

    console.log(
      `PostgreSQL database: ${
        poolOptions.database ||
        "DATABASE_URL"
      }`
    );
  }
);


// =========================================================
// GRACEFUL SHUTDOWN
// =========================================================

process.on(
  "SIGINT",
  async () => {

    mqttClient.end(true);

    await pool.end();

    process.exit(0);
  }
);