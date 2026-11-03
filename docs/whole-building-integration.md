# Whole-building integration

The supplied IFC replaces the previous model in the active React viewer. Its 18 existing markers are linked to the supplied simulator without changing the IFC or the simulator equations.

## Mapping

The simulator groups all virtual rooms on Level 03, whereas the IFC markers occupy Levels 2–5. These are demonstration aliases based on matching room and measurement types, not verified installed sensor locations. Power is an illustrative aggregate represented by the Level 5 electrical marker.

| Simulator sensor | IFC Sensor_ID | IFC GlobalId | IFC storey |
| --- | --- | --- | --- |
| TEMP-L03-OPEN-01 | L02-OPEN-TEMP-01 | 1SeKazYdH2rQolfStu06kz | Level_02 |
| RH-L03-OPEN-01 | L02-OPEN-HUM-01 | 2J3UxEq8H3yg74O2eIMhe9 | Level_02 |
| CO2-L03-OPEN-01 | L02-OPEN-CO2-01 | 2J3UxEq8H3yg74O2eIMhiQ | Level_02 |
| PIR-L03-OPEN-01 | L02-OPEN-OCC-01 | 2J3UxEq8H3yg74O2eIMhd8 | Level_02 |
| LUX-L03-OPEN-01 | L02-OPEN-LIGHT-01 | 2J3UxEq8H3yg74O2eIMhxv | Level_02 |
| TEMP-L03-MEET-01 | L03-MEET-TEMP-01 | 2xyFYpYs98cvNm6CN8AI7g | Level_03 |
| RH-L03-MEET-01 | L03-MEET-HUM-01 | 2xyFYpYs98cvNm6CN8AI0R | Level_03 |
| CO2-L03-MEET-01 | L03-MEET-CO2-01 | 2xyFYpYs98cvNm6CN8AIE0 | Level_03 |
| PIR-L03-MEET-01 | L03-MEET-OCC-01 | 2xyFYpYs98cvNm6CN8AICT | Level_03 |
| LUX-L03-MEET-01 | L03-MEET-LIGHT-01 | 2xyFYpYs98cvNm6CN8AICa | Level_03 |
| PIR-L03-WC-01 | L04-WC-OCC-01 | 17xfmxP1v9Xu9I5OOlCJ4P | Level_04 |
| LUX-L03-WC-01 | L04-WC-LIGHT-01 | 17xfmxP1v9Xu9I5OOlCJ8T | Level_04 |
| RH-L03-WC-01 | L04-WC-HUM-01 | 17xfmxP1v9Xu9I5OOlCJEr | Level_04 |
| LEAK-L03-WC-01 | L04-WC-LEAK-01 | 17xfmxP1v9Xu9I5OOlCJC2 | Level_04 |
| PIR-L03-CLEAN-01 | L04-CLEAN-OCC-01 | 29ndvmKU9CTBQdrp2wp749 | Level_04 |
| LUX-L03-CLEAN-01 | L04-CLEAN-LIGHT-01 | 29ndvmKU9CTBQdrp2wp7Rg | Level_04 |
| LEAK-L03-CLEAN-01 | L04-CLEAN-LEAK-01 | 066e6KlO92k8ji_EB_9Iss | Level_04 |
| PWR-L03-PWR-POINT-01 | L05-ELEC-POWER-01 | 3HWYwwb5v4jO1h2$i8P0t4 | Level_05 |

## Data path

`npm run demo` starts the Python simulator, Node API and React website. The simulator delivers batches of 18 readings to `/api/sensor-readings`; the API validates each batch and publishes committed readings through `/api/events` using server-sent events. The dashboard restores recent history through `/api/bootstrap`.

Temporary demo storage is explicitly labelled and is cleared on restart. Persistent mode uses an additive PostgreSQL `twin18` schema. Existing project tables are preserved. This profile uses HTTP and SSE; it does not claim to implement the project's planned MQTT/WebSocket production path.

## Model conversion

IfcOpenShell 0.9.0 tessellates real IFC geometry into metres, rotating Z-up to Y-up. xeokit packages it as XKT. The delivered model contains 10,276 drawable objects and 2,721,484 triangles, including all 18 sensor GlobalIds. Spatial metadata preserves the storey hierarchy for floor filters. Voids (`IfcSpace`, `IfcOpeningElement`) are omitted from rendering. The source IFC remains available losslessly compressed.

Some complex meshes have no calculated edge outlines because xeokit caps edge calculations at 10,000 indices. Surface triangles are retained. Tessellation uses a 0.01-m linear deflection, so the browser model is a visualisation and not a fabrication export. Multi-material geometry currently uses its first material; this may simplify colours.

## Future Qwen integration

The AI panel remains a disabled placeholder for the Qwen energy model being trained in Google Colab. No prompts are sent and no predictions are invented. Colab produces a PEFT adapter, not a persistent serving endpoint. After validation, load it with its matching base model in a PyTorch inference service, implement the same preprocessing and baseline/residual reconstruction as training, and expose the forecast through the backend. A forecasting adapter must not be presented as a general building chatbot without separate evaluation.

## Verification limits

The preview verified incoming HTTP readings for all 18 channels, sensor selection, and the Qwen placeholder. The cloud preview browser has no WebGL 2 support, so rendered 3D appearance and model picking still require a graphics-capable browser. The XKT integrity test independently checks the embedded geometry IDs and floor ancestry.

The included integration tests exercise the actual simulator format, batch validation, streaming, atomic persistence, retries, database rollback, and restoration using PGlite. They do not establish connectivity to your own PostgreSQL server. See README for local startup and persistent database setup.

## Friendly viewing and sensor colours

The viewer groups the 18 sensor objects into named monitoring locations rather than numbered pins. Room labels show a sensor type and current reading. The left location list and the sensor picker also use room names; the underlying IFC IDs and simulator aliases remain unchanged.

- Choose a named room or a sensor to focus its actual IFC floor and see its reading. The request starts one cancellable camera transition.
- Building restores normal materials. X-ray now uses an explicitly configured dark, unlit SDK emphasis fill and dark edge lines; it does not use the SDK's default pale fill. Wall shading controls fill alpha from 8–85%. Floor slabs use separate, subdued transparency (10–34%), rather than the former 64% minimum. All architectural edges are explicitly enabled in X-ray / Heatmap modes.
- Open ceilings and Hide roof reveal the interior. Clipping uses the installed renderer's actual convention: fragments with `dot(-dir, position-planePosition) > 0` are removed. Lower-plane direction is +Y; upper-plane direction is -Y. This corrects the reversed cuts that removed entire floors in the previous update.
- Scroll or pinch over the viewer to zoom. Shift + scroll moves the camera; drag rotates it. Non-passive capture handlers prevent the same wheel/pinch gesture from scrolling or magnifying the webpage. These handlers are attached only to the viewer and are removed on unmount. Explicit Zoom in / Zoom out buttons are also available.
- Reset restores the whole building. Fit frames the current scope. Top uses an orthographic plan and 3D restores orbit viewing. Escape closes the enlarged viewer. Reduced-motion preferences disable animated camera transitions.
- Foundation exists as IFC storey metadata but has no drawable objects, so its option is disabled and labelled.

### Sensor colours

Sensor colours overlays small 3D colour areas near the sensor locations. Choose Temperature, Humidity, CO₂, Occupancy, Water leakage, Light or Virtual power. The colour values are driven by current readings; missing values have no coloured area and are labelled No reading.

Temperature, humidity and CO₂ use explicitly labelled demo display bands. These are not calibrated building alarms or safety limits. Occupancy shows Vacant / Occupied; leakage shows Dry / Leak detected. Light and virtual power show reading intensity, not a fault diagnosis. The power point remains the simulator's illustrative aggregate, not a measured floor meter.

The overlay is a visual aid around discrete sensors, not a room-wide measured temperature field or a thermal simulation. It uses concentric translucent meshes, not extrapolated measurements. No AI output is generated by these colours.

### Model navigation data and checks

`shared/modelNavigation.json` holds nine IFC storey elevations and 18 world-space sensor centres in metres and Y-up axes. `npm run model:convert` regenerates the model and its navigation metadata; `npm run model:navigation` regenerates navigation metadata alone.

The tests cover all 18 sensor positions against the installed renderer's clipping equation, one camera movement per request, cancellation of stale arrivals, perspective and orthographic zoom, shifted scrolling, viewer-only wheel/pinch capture and cleanup, named room grouping, reduced motion and colour/no-data semantics. Scene/controller tests substitute scene operations and do not replace GPU visual testing.

The reported rendering issues were reproduced on the connected localhost and diagnosed against the SDK source. The new GPU appearance needs checking after installing this updated ZIP on the Mac because the cloud preview has no WebGL 2 support.


## Room boundary and X-ray clarity update

`shared/roomFootprints.json` contains actual floor-face triangles and perimeter edges extracted from the source IFC spaces, without replacing them with rectangles. Selecting a supported marker adds a tinted floor footprint and an outline of its space. Camera framing uses the whole room boundary; “Room plan” gives a top-down view. The outline can be toggled independently of wall shading. Changing floor, metric or display mode removes stale outlines.

Coverage: 15 of 18 markers have a source IfcSpace association, spanning six spaces. The meeting temperature, humidity and CO₂ markers belong to the storey instead of an IfcSpace; a geometric containment check also found no unique space at their positions. Their interface explicitly says the room boundary is unavailable. The meeting occupancy and light markers have a space association. These distinctions are preserved per marker; sharing the same dashboard room alias does not prove that every marker belongs to the same geometric space. Existing simulator-to-IFC demonstration aliases remain unverified physical mappings.

To regenerate the footprint data after an IFC change, install IfcOpenShell (this extraction used 0.8.4) and run `python3 scripts/export-room-footprints.py`. Viewing the packaged data requires no Python geometry dependencies. Floor surfaces follow the IFC triangles, including non-rectangular outlines; vertical outline guides are capped at 2.5 m to stay within the cutaway.

Verification covers slider range, separate floor transparency, solid-mode restoration, room framing/cleanup and perimeter edges without triangle diagonals. A real WebGL 2 browser is still required to assess the rendered result visually.
