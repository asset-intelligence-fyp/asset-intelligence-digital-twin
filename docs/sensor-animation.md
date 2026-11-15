# Main BIM sensor animation

Sensor markers have gentle staggered rings at their IFC anchor positions and a
glow on their numbered badges. Use the Pulse sensors checkbox to stop the effect.
The Sensor markers checkbox still hides the entire overlay. Reduced-motion
preferences disable animation through CSS even if the checkbox is enabled.

Pulsing means a valid synthetic observation was received by the API within the
last 90 real seconds, matching the telemetry status window. It does not mean an
asset is healthy, occupied or fault-free. Zero-valued occupancy and dry leakage
readings remain valid measurements. Missing values, stored bootstrap history,
browser-demo/history views and stale data do not pulse. Freshness uses the
server's receipt timestamp supplied in the SSE envelope, never the accelerated
simulation timestamp. The current same-computer setup supplies the shared wall
clock; future clocks are treated conservatively as stale.

This changes only visual feedback. It does not change sensor readings, thresholds,
anomaly results or the temporary poster studio's decorative marker animation.

Run the activity checks with `node --test tests/sensorActivity.test.mjs`.
