import {
  Viewer,
  XKTLoaderPlugin,
  NavCubePlugin,
  SectionPlanesPlugin
} from "@xeokit/xeokit-sdk";

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
  let sectionPlane = null;
  let lowerPlane = null;
  let upperPlane = null;

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
  // Automatic Level 5 cropping applies to architecture, not HVAC. Users can
  // explicitly cut both models with the extra-section control.
  let clipHVACOnDemand = false;
  let showArchitecturalBand = true;
  let lowerPadding = 3.5;
  let upperPadding = 1.5;

  function setHVACClippable(enabled) {
    if (!model) return;
    model.clippable = enabled;
    for (const id of model.objectIds || []) {
      const entity = viewer.scene.objects[id];
      if (entity) entity.clippable = enabled;
    }
  }

  // IFC and xeokit normally use +Y as the vertical scene direction.
  // Clip the architectural building to the floor band around Level 5 HVAC.
  // The offsets can be adjusted in the UI to match actual floor heights.
  function updateLevel5Band() {
    if (!model?.aabb) return;
    // The HVAC layer must never disappear due to an architectural floor crop.
    setHVACClippable(clipHVACOnDemand);
    const box = model.aabb;
    if (![...box].every(Number.isFinite) || box[4] < box[1]) {
      console.warn("Invalid HVAC bounding box: architectural slicing deferred", box);
      return;
    }
    if (lowerPlane) lowerPlane.active = showArchitecturalBand;
    if (upperPlane) upperPlane.active = showArchitecturalBand;
    const x = (box[0] + box[3]) / 2;
    const z = (box[2] + box[5]) / 2;
    const floorY = box[1] - lowerPadding;
    const ceilingY = box[4] + upperPadding;
    if (!lowerPlane) {
      lowerPlane = sectionPlanes.createSectionPlane({
        id: "level5LowerBound", pos: [x, floorY, z], dir: [0, -1, 0], active: true
      });
    } else {
      lowerPlane.pos = [x, floorY, z];
    }
    if (!upperPlane) {
      upperPlane = sectionPlanes.createSectionPlane({
        id: "level5UpperBound", pos: [x, ceilingY, z], dir: [0, 1, 0], active: true
      });
    } else {
      upperPlane.pos = [x, ceilingY, z];
    }
  }

  function updateArchitectureStatus(value, warning = false) {
    const element = stage.querySelector("[data-architecture-status]");
    if (element) {
      element.textContent = value;
      element.classList.toggle("warning", warning);
    }
  }

  function toggleArchitecture(enabled) {
    showArchitecture = Boolean(enabled);
    if (architecturalIds.length) {
      viewer.scene.setObjectsVisible(architecturalIds, showArchitecture);
    }
    const toggle = stage.querySelector("[data-architecture-toggle]");
    if (toggle) toggle.checked = showArchitecture;
    updateArchitectureStatus(
      !architecturalModel ? "Architecture unavailable or loading" :
      showArchitecture ? "Walls and slabs shown" : "HVAC-only view"
    );
  }

  function validateAlignment() {
    if (!model?.aabb || !architecturalModel?.aabb) return;
    const hvac = model.aabb, arch = architecturalModel.aabb;
    const overlapX = hvac[0] <= arch[3] && arch[0] <= hvac[3];
    const overlapZ = hvac[2] <= arch[5] && arch[2] <= hvac[5];
    const floorY = hvac[1] - lowerPadding, ceilingY = hvac[4] + upperPadding;
    const overlapY = floorY <= arch[4] && arch[1] <= ceilingY;
    if (!overlapX || !overlapZ || !overlapY) {
      console.warn("Architectural and HVAC XKT geometry do not overlap. Verify shared Revit coordinates and exports.", {hvac, arch});
      updateArchitectureStatus("Models not aligned; check coordinates", true);
    } else {
      updateArchitectureStatus(showArchitecture ? "Walls and slabs shown" : "HVAC-only view");
    }
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
        validateAlignment();
        console.info("Loaded architectural context:", architecturalIds.length, "objects");
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
    sectionPlane?.destroy();
    sectionPlane = null;
    clipHVACOnDemand = false;
    setHVACClippable(false);
  }

  function resetAllCuts() {
    clearSection();
    if (lowerPlane) lowerPlane.active = false;
    if (upperPlane) upperPlane.active = false;
    showArchitecturalBand = false;
    if (model) {
      setHVACClippable(false);
      model.visible = true;
    }
    if (architecturalModel) architecturalModel.visible = showArchitecture;
    updateArchitectureStatus("Clipping disabled — full models shown");
    showWholeBuilding();
  }

  function setSection(axis = "y", fraction = 0.5) {
    if (!model?.aabb) return;
    clipHVACOnDemand = true;
    setHVACClippable(true);
    const box = model.aabb;
    const index = axis === "x" ? 0 : axis === "z" ? 2 : 1;
    const position = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
    const min = index === 1 ? box[1] - lowerPadding : box[index];
    const max = index === 1 ? box[4] + upperPadding : box[index + 3];
    position[index] = min + Math.max(0, Math.min(1, Number(fraction))) * (max - min);
    const direction = [0, 0, 0];
    direction[index] = 1; // Discard one side of the section cut.
    clearSection();
    sectionPlane = sectionPlanes.createSectionPlane({
      id: "level5InteractiveCut", pos: position, dir: direction, active: true
    });
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
    home: () => { clearSection(); showWholeBuilding(); },
    resetAllCuts,
    section: () => setSection(
      stage.querySelector("[data-section-axis]")?.value || "y",
      Number(stage.querySelector("[data-section-range]")?.value || 50) / 100
    ),
    clearSection,
    fit: showWholeBuilding,
    all: showWholeBuilding,
    plan: planView,
    threeD: showWholeBuilding,
    focus: () => {
      if (!selectedEntity) return;
      viewer.cameraControl.navMode = "orbit";
      viewer.cameraFlight.flyTo({
        aabb: selectedEntity.aabb, projection: "perspective", duration: 0.65, fitFOV: 35
      });
    }
  };

  stage.querySelectorAll("[data-viewer-action]").forEach((button) => {
    const action = button.dataset.viewerAction;
    button.addEventListener("click", () => actionHandlers[action]?.());
  });

  stage.querySelector("[data-section-range]")?.addEventListener("input", event =>
    setSection(stage.querySelector("[data-section-axis]")?.value || "y", Number(event.target.value) / 100)
  );
  stage.querySelector("[data-section-axis]")?.addEventListener("change", event =>
    setSection(event.target.value, Number(stage.querySelector("[data-section-range]")?.value || 50) / 100)
  );

  stage.querySelector("[data-architecture-toggle]")?.addEventListener("change", event => {
    toggleArchitecture(event.target.checked);
  });
  for (const [selector, property] of [
    ["[data-slice-below]", "below"], ["[data-slice-above]", "above"]
  ]) {
    stage.querySelector(selector)?.addEventListener("input", event => {
      const metres = Number(event.target.value);
      if (!Number.isFinite(metres)) return;
      if (property === "below") lowerPadding = metres;
      else upperPadding = metres;
      const label = stage.querySelector(property === "below" ? "[data-slice-below-value]" : "[data-slice-above-value]");
      if (label) label.textContent = metres.toFixed(1) + " m";
      showArchitecturalBand = true;
      updateLevel5Band();
      validateAlignment();
    });
  }
  if (floorSelect) floorSelect.disabled = true;

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
    setHVACClippable(false);
    model.visible = true;
    console.info("HVAC model loaded", {aabb: Array.from(model.aabb), objects: model.objectIds?.length});
    if (floorLabel) floorLabel.textContent = "Level 5";
    updateLevel5Band();
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
  return { viewer, model, showWholeBuilding, selectSensor, configureSensors, setSection, clearSection, resetAllCuts, toggleArchitecture, updateLevel5Band };
}
