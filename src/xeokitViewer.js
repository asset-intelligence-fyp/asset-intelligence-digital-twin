import {
  Viewer,
  XKTLoaderPlugin,
  NavCubePlugin,
  SectionPlanesPlugin
} from "@xeokit/xeokit-sdk";
import {findFloorCutFromIdentifiedSlab} from "./data/level5FloorCut.js";
import {LEVEL5_SENSORS} from "./data/level5Sensors.js";

let active = null;

export function destroyActiveViewer() {
  if (!active) return;
  try {
    if (active.loadingTimer) clearTimeout(active.loadingTimer);
    active.viewer?.destroy?.();
  } catch (error) {
    console.warn("Viewer cleanup warning:", error);
  }
  active = null;
}

export function initXeokitViewer({ stageId, onSelection = () => {} } = {}) {
  destroyActiveViewer();

  const stage = document.getElementById(stageId);
  if (!stage) return null;

  const canvas = stage.querySelector("[data-xeokit-canvas]");
  const navCanvas = stage.querySelector("[data-navcube-canvas]");
  const loading = stage.querySelector("[data-viewer-loading]");
  const floorLabel = stage.querySelector("[data-floor-label]");
  const floorSelect = stage.closest(".viewer-panel")?.querySelector("[data-floor-select]");
  const selectedLabel = stage.querySelector("[data-selected-element]");
  let hvacLoaded = false;
  let loadingTimer = null;
  const showLoadingProblem = (title, details) => {
    if (!loading) return;
    const titleEl = loading.querySelector(".viewer-loading-title");
    const subtitleEl = loading.querySelector(".viewer-loading-sub");
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = details;
  };

  if (!canvas || !navCanvas) return null;

  // Xeokit requires element IDs. Generate route-local IDs to avoid stale bindings.
  canvas.id = `xeokitCanvas_${Date.now()}`;
  navCanvas.id = `navCube_${Date.now()}`;

  const viewer = new Viewer({
    canvasId: canvas.id,
    transparent: true
  });

  viewer.cameraControl.navMode = "orbit";
  viewer.cameraControl.doublePickFlyTo = true;
  viewer.cameraControl.followPointer = true;
  viewer.cameraControl.smartPivot = true;

  // Construction-oriented selection styling: safety orange is reserved for
  // the BIM element the operator is actively inspecting.
  if (viewer.scene.selectedMaterial) {
    viewer.scene.selectedMaterial.fill = true;
    viewer.scene.selectedMaterial.fillColor = [1.0, 0.48, 0.0];
    viewer.scene.selectedMaterial.fillAlpha = 0.22;
    viewer.scene.selectedMaterial.edges = true;
    viewer.scene.selectedMaterial.edgeColor = [1.0, 0.66, 0.20];
    viewer.scene.selectedMaterial.edgeAlpha = 1.0;
  }

  const xktLoader = new XKTLoaderPlugin(viewer);
  const sectionPlanes = new SectionPlanesPlugin(viewer);
  let floorPlane = null;

  new NavCubePlugin(viewer, {
    canvasId: navCanvas.id,
    visible: true,
    cameraFly: true,
    cameraFlyDuration: 0.45,
    fitVisible: true
  });

  let model = null;
  let selectedEntity = null;
  let sensorCatalog = [];
  let architecturalModel = null;
  let architecturalIds = [];
  let showArchitecture = true;
  let floorCut = null;
  let floorCutInspected = false;
  let hvacClipConfigured = false;
  // This is the IfcSlab identified in the user's BIM screenshot as the Level 5
  // finished floor, not an automatically inferred ground or roof slab.
  const DEFAULT_LEVEL5_SLAB_GUID = "19jRsGRmHCtQuanP7b0FIs";
  let level5SlabGuid = DEFAULT_LEVEL5_SLAB_GUID;
  const physicalSensorGuids = new Set(LEVEL5_SENSORS.map(s => s.guid.toLowerCase()));
  const architecturalTypePattern = /^Ifc(?:Wall|WallStandardCase|Slab|Roof|CurtainWall|Column|Beam|Covering|Door|Window|Stair|StairFlight|Railing|BuildingElementProxy|Footing|Plate)/i;

  // The primary HVAC XKT also contains walls and slabs. Previous revisions
  // protected the whole model from clipping, which kept the lower storeys.
  // Clip architectural objects in BOTH models, but protect sensors and HVAC.
  function preserveHVACVisibility(force = false) {
    if (!model) return;
    if (!hvacClipConfigured || force) {
      const clipIds = [];
      const protectedIds = [];
      for (const id of model.objectIds || []) {
        const type = viewer.metaScene.metaObjects[id]?.type || "";
        const guid = id.split(/[.#]/).pop().toLowerCase();
        if (architecturalTypePattern.test(type) && !physicalSensorGuids.has(guid)) {
          clipIds.push(id);
        } else {
          protectedIds.push(id);
        }
      }
      // Enable clipping at model level before setting per-object exemptions.
      model.clippable = true;
      if (typeof viewer.scene.setObjectsClippable === "function") {
        if (clipIds.length) viewer.scene.setObjectsClippable(clipIds, true);
        if (protectedIds.length) viewer.scene.setObjectsClippable(protectedIds, false);
      } else {
        for (const id of clipIds) {
          const entity = viewer.scene.objects[id];
          if (entity) entity.clippable = true;
        }
        for (const id of protectedIds) {
          const entity = viewer.scene.objects[id];
          if (entity) entity.clippable = false;
        }
      }
      hvacClipConfigured = true;
      console.info("Primary XKT clipping configuration", {
        architectural: clipIds.length,
        protectedHVACAndSensors: protectedIds.length
      });
    }
    if (force || model.visible === false) model.visible = true;
  }

  function findSceneObjectByIFCGuid(guid) {
    if (!guid) return null;
    const normalized = String(guid).toLowerCase();
    const objects = viewer.scene.objects;
    let id = objects[guid] ? guid : null;
    if (!id) {
      id = Object.keys(objects).find(key => key.toLowerCase() === normalized ||
        key.split(/[.#]/).pop().toLowerCase() === normalized);
    }
    if (!id) return null;
    const object = objects[id];
    const meta = viewer.metaScene.metaObjects[id] ||
      viewer.metaScene.metaObjects[guid];
    return {
      id, type: meta?.type || "", aabb: object?.aabb
    };
  }

  function updateArchitectureStatus(value, warning = false) {
    const el = stage.querySelector("[data-architecture-status]");
    if (el) {
      el.textContent = value;
      el.classList.toggle("warning", warning);
    }
  }

  function toggleArchitecture(enabled) {
    showArchitecture = Boolean(enabled);
    if (architecturalModel) architecturalModel.visible = showArchitecture;
    if (architecturalIds.length) viewer.scene.setObjectsVisible(architecturalIds, showArchitecture);
    // Restore the verified floor cut only when architecture is switched on.
    if (showArchitecture && floorCutInspected && floorCut && floorPlane && !floorPlane.active) {
      floorPlane.active = true;
    }
    const checkbox = stage.querySelector("[data-architecture-toggle]");
    if (checkbox) checkbox.checked = showArchitecture;
    preserveHVACVisibility();
    updateArchitectureStatus(showArchitecture ? "Architecture visible" : "HVAC-only view");
  }

  function updateFloorUnderlay() {
    if (!model?.aabb || !architecturalModel?.aabb) return;
    if (!floorCutInspected) {
      const reference = findSceneObjectByIFCGuid(level5SlabGuid);
      floorCut = findFloorCutFromIdentifiedSlab(architecturalModel.aabb, reference);
      floorCutInspected = true;
      console.info("Level 5 floor cut from selected slab", {
        requestedGuid: level5SlabGuid,
        found: reference ? {id:reference.id, type:reference.type, aabb:Array.from(reference.aabb || [])} : null,
        selected: floorCut,
        architectureBounds: Array.from(architecturalModel.aabb)
      });
    }
    if (!floorCut) {
      if (floorPlane) floorPlane.active = false;
      preserveHVACVisibility();
      updateArchitectureStatus("Level 5 reference slab not found — showing the complete model", true);
      return;
    }
    const h = model.aabb;
    const pos = [(h[0] + h[3])/2, floorCut.y, (h[2] + h[5])/2];
    if (!floorPlane) {
      floorPlane = sectionPlanes.createSectionPlane({
        id: "underLevel5",
        pos,
        dir: [0, 1, 0],
        active: true
      });
    } else {
      floorPlane.pos = pos;
      floorPlane.dir = [0, 1, 0];
      floorPlane.active = true;
    }
    preserveHVACVisibility();
    updateArchitectureStatus("Showing upper building above selected Level 5 slab");
  }

  function loadArchitecturalContext() {
    updateArchitectureStatus("Loading walls and floor…");
    // Existing repository architectural XKT; not created from the new HVAC-only IFC.
    // Globalized IFC ids prevent collisions with the unprefixed live-sensor model.
    try {
      architecturalModel = xktLoader.load({
        id: "Level5Architecture",
        src: "/models/Snowdon Towers Sample Architectural.xkt",
        globalizeObjectIds: true,
        includeTypes: [
          "IfcWall", "IfcWallStandardCase", "IfcSlab", "IfcCurtainWall",
          "IfcColumn", "IfcBeam", "IfcCovering", "IfcDoor", "IfcWindow",
          "IfcStair", "IfcStairFlight", "IfcRailing", "IfcBuildingElementProxy"
        ],
        objectDefaults: {
          IfcWall: { colorize: [0.69, 0.76, 0.81], opacity: 0.45, pickable: false },
          IfcWallStandardCase: { colorize: [0.69, 0.76, 0.81], opacity: 0.45, pickable: false },
          IfcSlab: { colorize: [0.62, 0.68, 0.73], opacity: 0.75, pickable: false },
          IfcCurtainWall: { colorize: [0.6, 0.72, 0.78], opacity: 0.36, pickable: false },
          IfcWindow: { opacity: 0.18, pickable: false },
          IfcSpace: { visible: false, pickable: false },
          DEFAULT: { opacity: 0.55, pickable: false }
        },
        edges: true,
        saoEnabled: true,
        dtxEnabled: true
      });
      architecturalModel.on("loaded", () => {
        // Architecture objects have globalized IDs; they are not sensor targets.
        architecturalIds = Object.keys(viewer.scene.objects).filter(id =>
          id.startsWith("Level5Architecture#") ||
          id.startsWith("Level5Architecture.")
        );
        if (!architecturalIds.length && architecturalModel.objectIds) {
          architecturalIds = Array.from(architecturalModel.objectIds);
        }
        if (!architecturalIds.length) {
          console.warn("Architectural XKT loaded, but no supported walls/slabs were found. Check IFC type metadata.");
          updateArchitectureStatus("No architectural geometry in XKT", true);
          return;
        }
        toggleArchitecture(showArchitecture);
        updateFloorUnderlay();
        preserveHVACVisibility();
        console.info("Loaded architectural context:", { objects: architecturalIds.length, aabb: Array.from(architecturalModel.aabb) });
      });
      architecturalModel.on("error", error => {
        console.error("Architectural XKT could not load:", error);
        updateArchitectureStatus("Architectural XKT failed to load", true);
      });
    } catch (error) {
      console.error("Could not initialize architectural context:", error);
      updateArchitectureStatus("Architecture unavailable", true);
    }
  }

  function selectSensor(guid) {
    const entity = viewer.scene.objects[guid];
    if (!entity) return false;
    if (selectedEntity && selectedEntity !== entity) selectedEntity.selected = false;
    selectedEntity = entity;
    entity.visible = true;
    entity.selected = true;
    const sensor = sensorCatalog.find(item => item.guid === guid);
    if (selectedLabel) selectedLabel.textContent = sensor?.label || guid;
    viewer.cameraControl.navMode = "orbit";
    viewer.cameraFlight.flyTo({ aabb: entity.aabb, projection: "perspective", duration: 0.7, fitFOV: 45 });
    onSelection({ entityId: guid, name: sensor?.label || guid, type: "Sensor", metaObject: viewer.metaScene.metaObjects[guid] });
    return true;
  }

  function configureSensors(items) {
    sensorCatalog = items || [];
    let matched = 0;
    sensorCatalog.forEach(item => {
      const entity = viewer.scene.objects[item.guid];
      if (!entity) return;
      entity.highlighted = true;
      matched++;
    });
    return { matched, total: sensorCatalog.length };
  }

  function resetAllCuts() {
    // Emergency recovery must actually disable ALL clipping and show BOTH models.
    toggleArchitecture(true);
    // Recovery intentionally shows all geometry without any floor cut.
    if (floorPlane) floorPlane.active = false;
    if (architecturalModel) architecturalModel.visible = true;
    if (architecturalIds.length) viewer.scene.setObjectsVisible(architecturalIds, true);
    preserveHVACVisibility(true);
    updateArchitectureStatus("All geometry restored — clipping disabled");
    showWholeBuilding();
  }


  function showWholeBuilding() {
    if (!model) return;
    if (floorLabel) floorLabel.textContent = "Level 5";
    viewer.cameraControl.navMode = "orbit";
    // Keep the floor band active; never expose the full-height architecture.
    viewer.cameraFlight.flyTo({
      aabb: model.aabb, projection: "perspective", duration: 0.7, fitFOV: 50
    });
  }

  function planView() {
    if (!model?.aabb) return;
    const box = model.aabb;
    const x = (box[0] + box[3]) / 2;
    const y = (box[1] + box[4]) / 2;
    const z = (box[2] + box[5]) / 2;
    const distance = Math.max(box[3] - box[0], box[5] - box[2], 20) * 1.6;
    viewer.cameraFlight.flyTo({
      eye: [x, y + distance, z],
      look: [x, y, z],
      up: [0, 0, -1],
      projection: "ortho",
      duration: 0.7
    });
    viewer.cameraControl.navMode = "planView";
  }

  const actionHandlers = {
    home: showWholeBuilding,
    resetAllCuts,
    fit: showWholeBuilding,
    all: showWholeBuilding,
    plan: planView,
    threeD: showWholeBuilding,
    focus: () => {
      if (!selectedEntity) return;
      viewer.cameraControl.navMode = "orbit";
      viewer.cameraFlight.flyTo({
        aabb:selectedEntity.aabb, projection:"perspective", duration:0.65, fitFOV:35
      });
    }
  };
  stage.querySelectorAll("[data-viewer-action]").forEach(button => {
    button.addEventListener("click", () => actionHandlers[button.dataset.viewerAction]?.());
  });
  stage.querySelector("[data-architecture-toggle]")?.addEventListener("change", event => toggleArchitecture(event.target.checked));


  viewer.scene.input.on("mouseclicked", (canvasPos) => {
    const hit = viewer.scene.pick({ canvasPos, pickSurface: true });
    if (!hit?.entity?.isObject) return;

    if (selectedEntity) selectedEntity.selected = false;
    selectedEntity = hit.entity;
    selectedEntity.selected = true;

    const metaObject = viewer.metaScene.metaObjects[selectedEntity.id];
    const readableName = metaObject?.name || metaObject?.type || selectedEntity.id;
    if (selectedLabel) selectedLabel.textContent = String(readableName);

    onSelection({
      entityId: selectedEntity.id,
      name: readableName,
      type: metaObject?.type || "BIM Element",
      metaObject
    });
  });


  // Never leave an uninformative spinner running indefinitely.
  // A slow XKT may still load later; this warning does not cancel it.
  loadingTimer = setTimeout(() => {
    if (!hvacLoaded) {
      console.warn("Level 5 HVAC XKT has not reported loaded after 25s.");
      showLoadingProblem(
        "BIM model is taking longer than expected",
        "Check browser Console / Network for XKT errors. The model may still be processing."
      );
    }
  }, 25000);

  try {
    model = xktLoader.load({
      id: "SnowdonTowers",
      src: "/models/Snowdon_Level5_Model+HVAC.xkt",
      edges: true,
      saoEnabled: true,
      dtxEnabled: true
    });

    model.on("loaded", () => {
      hvacLoaded = true;
      clearTimeout(loadingTimer);
      loading?.remove();
      try {
        preserveHVACVisibility();
        console.info("HVAC XKT loaded", { aabb: Array.from(model.aabb), objects: model.objectIds?.length });
        if (floorLabel) floorLabel.textContent = "Level 5";
        // Load architectural context only after the HVAC has become usable.
        showWholeBuilding();
        loadArchitecturalContext();
      } catch (error) {
        console.error("BIM viewer post-load initialization failed:", error);
        updateArchitectureStatus("Viewer loaded; architectural setup failed (see Console)", true);
      }
    });

    model.on("error", (error) => {
      clearTimeout(loadingTimer);
      console.error("Level 5 HVAC XKT loading failed:", error);
      showLoadingProblem(
        "BIM model could not load",
        "Verify public/models/Snowdon_Level5_Model+HVAC.xkt and see browser Console for details."
      );
    });
  } catch (error) {
    clearTimeout(loadingTimer);
    console.error("Could not start xeokit XKT loader:", error);
    showLoadingProblem("Could not start BIM viewer", String(error?.message || error));
  }

  active = { viewer, model, loadingTimer };
  return { viewer, model, showWholeBuilding, selectSensor, configureSensors, resetAllCuts, toggleArchitecture };
}

