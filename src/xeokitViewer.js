import {
  Viewer,
  XKTLoaderPlugin,
  NavCubePlugin,
  SectionPlanesPlugin
} from "@xeokit/xeokit-sdk";
import {findLevel5FloorCut} from "./data/level5FloorCut.js";

let active = null;

export function destroyActiveViewer() {
  if (!active) return;
  try {
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
  let cameraPlane = null;

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
  let viewMode = "walls";
  let floorCut = null;
  let floorCutInspected = false;
  let hvacClipConfigured = false;

  // Avoid changing the visibility/clippability of every HVAC object repeatedly.
  // Doing so for a large XKT can block the browser's main thread.
  function preserveHVACVisibility(force = false) {
    if (!model) return;
    if (!hvacClipConfigured || force) {
      model.clippable = false;
      if (viewer.scene.setObjectsClippable && model.objectIds) {
        viewer.scene.setObjectsClippable(model.objectIds, false);
      } else {
        for (const id of model.objectIds || []) {
          const object = viewer.scene.objects[id];
          if (object && object.clippable !== false) object.clippable = false;
        }
      }
      hvacClipConfigured = true;
    }
    if (force || model.visible === false) model.visible = true;
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
    if (cameraPlane) cameraPlane.active = viewMode === "camera" && showArchitecture;
    if (showArchitecture && viewMode === "camera") updateCameraSection();
    updateArchitectureStatus(showArchitecture ? "Architecture visible" : "HVAC-only view");
  }

  function updateFloorUnderlay() {
    if (!model?.aabb || !architecturalModel?.aabb || !architecturalIds.length) return;
    if (!floorCutInspected) {
      // Calculate this once after architectural metadata and geometry have loaded.
      // MetaObject.type is the original IFC classification stored in the XKT.
      const candidates = architecturalIds.map(id => {
        const object = viewer.scene.objects[id];
        const meta = viewer.metaScene.metaObjects[id];
        return {
          id,
          type: meta?.type || "",
          aabb: object?.aabb
        };
      });
      floorCut = findLevel5FloorCut(model.aabb, architecturalModel.aabb, candidates);
      floorCutInspected = true;
      console.info("Level 5 architectural floor-cut selection:", {
        selected: floorCut,
        slabObjects: candidates.filter(c => /IfcSlab/i.test(c.type)).length,
        architectureObjects: candidates.length,
        hvacBounds: Array.from(model.aabb),
        architectureBounds: Array.from(architecturalModel.aabb)
      });
    }
    if (!floorCut) {
      if (floorPlane) floorPlane.active = false;
      preserveHVACVisibility();
      updateArchitectureStatus("Floor not identified — architecture visible without cut", true);
      return;
    }
    const h = model.aabb;
    const pos = [(h[0] + h[3])/2, floorCut.y, (h[2] + h[5])/2];
    if (!floorPlane) {
      floorPlane = sectionPlanes.createSectionPlane({
        id: "underLevel5",
        pos,
        dir: [0, -1, 0], // xeokit discards geometry BELOW the plane
        active: true
      });
    } else {
      floorPlane.pos = pos;
      floorPlane.dir = [0, -1, 0];
      floorPlane.active = true;
    }
    preserveHVACVisibility();
    updateArchitectureStatus("Lower floors trimmed at Level 5 slab");
  }

  function updateCameraSection() {
    // Camera sections affect architecture ONLY. Never cut sensor/HVAC geometry.
    if (viewMode !== "camera" || !architecturalModel?.aabb || !showArchitecture) {
      if (cameraPlane) cameraPlane.active = false;
      return;
    }
    const a = architecturalModel.aabb;
    if (![...a].every(Number.isFinite)) return;
    const eye = viewer.scene.camera.eye, look = viewer.scene.camera.look;
    const dx = eye[0] - look[0], dz = eye[2] - look[2];
    const d = Math.hypot(dx,dz);
    if (d < 1e-5) return;
    // Position inside the ARCHITECTURAL bounds, not the separate HVAC bounds.
    const pos = [(a[0]+a[3])/2, (a[1]+a[4])/2, (a[2]+a[5])/2];
    const dir = [dx/d,0,dz/d];
    if (!cameraPlane) {
      cameraPlane = sectionPlanes.createSectionPlane({
        id:"cameraAlignedSection", pos, dir, active:true
      });
    } else {
      cameraPlane.pos = pos;
      cameraPlane.dir = dir;
      cameraPlane.active = true;
    }
  }

  function setViewMode(value) {
    viewMode = value === "camera" ? "camera" : "walls";
    const select = stage.querySelector("[data-bim-view-mode]");
    if (select) select.value = viewMode;
    if (cameraPlane) cameraPlane.active = viewMode === "camera" && showArchitecture;
    preserveHVACVisibility();
    if (viewMode === "camera") updateCameraSection();
    else updateArchitectureStatus(showArchitecture ? "Walls and floor view" : "HVAC-only view");
  }

  // xeokit fires this event during interactive orbiting and camera flights.
  viewer.scene.camera.on("viewMatrix", updateCameraSection);


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
        if (viewMode === "camera") updateCameraSection();
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

  function clearSection() {
    setViewMode("walls");
  }

  function resetAllCuts() {
    // Emergency recovery must actually disable ALL clipping and show BOTH models.
    setViewMode("walls");
    if (floorPlane) floorPlane.active = false;
    if (cameraPlane) cameraPlane.active = false;
    toggleArchitecture(true);
    // toggleArchitecture can reactivate the automatic floor cut. Recovery must
    // finish with clipping OFF, so both models are guaranteed to be visible.
    if (floorPlane) floorPlane.active = false;
    if (cameraPlane) cameraPlane.active = false;
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
    home: () => { setViewMode("walls"); showWholeBuilding(); },
    resetAllCuts,
    clearSection,
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
  stage.querySelector("[data-bim-view-mode]")?.addEventListener("change", event => setViewMode(event.target.value));
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


  model = xktLoader.load({
    id: "SnowdonTowers",
    src: "/models/Snowdon_Level5_Model+HVAC.xkt",
    edges: true,
    saoEnabled: true,
    dtxEnabled: true
  });

  model.on("loaded", () => {
    loading?.remove();
    preserveHVACVisibility();
    console.info("HVAC model loaded", {aabb: Array.from(model.aabb), objects: model.objectIds?.length});
    if (floorLabel) floorLabel.textContent = "Level 5";
    // Under-floor cut is applied once architecture finishes loading.
    showWholeBuilding();
    loadArchitecturalContext();
  });

  model.on("error", (error) => {
    console.error("XKT load failed:", error);
    if (loading) {
      loading.innerHTML = `
        <div class="viewer-loading-card viewer-error">
          <div class="viewer-loading-title">BIM model could not load</div>
          <div class="viewer-loading-sub">Check the XKT path and xeokit dependency.</div>
        </div>`;
    }
  });

  active = { viewer, model };
  return { viewer, model, showWholeBuilding, selectSensor, configureSensors, setViewMode, clearSection, resetAllCuts, toggleArchitecture };
}
