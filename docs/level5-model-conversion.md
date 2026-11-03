# Level 5 IFC -> XKT model

The **active web viewer** reads `/models/Snowdon_Level5_Model+HVAC.xkt`.

- Source: `public/models/Snowdon_Level5_Model+HVAC.ifc`
- Output: `public/models/Snowdon_Level5_Model+HVAC.xkt`
- Older `_S.ifc` and `_S.xkt` models are preserved as separate files.
- The viewer displays **Level 5** in the floor label and selects the Level 5 storey when the XKT contains multiple named storeys.

## Conversion on a developer computer

From the repository root:

```bash
npm ci
python -m pip install ifcopenshell   # optional, for spatial/GUID audit
python scripts/audit-level5-ifc.py   # check for non-L5 geometry and sensor GUIDs
npm run convert:model
ls -lh public/models/Snowdon_Level5_Model+HVAC.xkt
npm run dev
```

Open **http://localhost:5173/bim-viewer**.

If the full-stack app cannot reach PostgreSQL, start the configured database and backend first. The viewer is initialized after `/api/bootstrap` returns successfully.

## Critical distinctions

**IFC -> XKT does not trim a multi-floor IFC down to Level 5.** The source IFC must have been exported from Revit with Level 5 elements only. The audit reports explicit IFC storey assignments, but cannot guarantee that every unassigned object belongs to Level 5. Inspect the resulting XKT visually.

To re-export if needed, use a Level 5-focused 3D view with a section box, and ensure IFC export includes only visible elements in that view. Verify exported contents before conversion.

## Sensor identifiers

The viewer uses `src/data/level5Sensors.js`, which maps eight physical sensor IDs to IFC GlobalIds. `FS-501A` has no physical IFC GUID, so it remains equipment telemetry without a model marker. The ABB device `S-L5-008` maps to one object and three readings.

The sensor navigator indicates how many of the eight GUIDs match XKT scene objects. Missing GUIDs can result from the IFC export omitting a device or the IFC-XKT converter dropping its geometry/IDs.

## Publishing the XKT

After confirming it displays correctly:

```bash
git add public/models/Snowdon_Level5_Model+HVAC.xkt
git commit -m "feat(model): add converted Level 5 BIM viewer asset"
git push
```

Large Git files may need Git LFS or a hosted asset instead. Do not commit secrets, venvs or generated simulator CSV data.

