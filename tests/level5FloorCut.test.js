import test from "node:test";
import assert from "node:assert/strict";
import {findLevel5FloorCut, findFloorCutFromIdentifiedSlab} from "../src/data/level5FloorCut.js";

const architecture = [0, 0, 0, 60, 60, 60];
const hvac = [10, 42, 10, 35, 46, 35];
const geometry = [
  {id:"bottom",type:"IfcSlab",aabb:[5,0.3,5,40,0.7,40]},
  {id:"level4",type:"IfcSlab",aabb:[5,35,5,40,35.4,40]},
  {id:"level5",type:"IfcSlab",aabb:[5,40,5,40,40.4,40]},
  {id:"roof",type:"IfcSlab",aabb:[5,50,5,40,50.5,40]},
  {id:"wall",type:"IfcWall",aabb:[5,0,5,40,55,40]}
];

test("selects slab beneath Level 5 HVAC, not ground slabs or roof", () => {
  const cut = findLevel5FloorCut(hvac, architecture, geometry);
  assert.ok(cut);
  assert.equal(cut.slabId, "level5");
  assert.ok(cut.y < 40);
  assert.ok(cut.y > 39.8);
});

test("rejects models with no usable slab, preserving full architecture", () => {
  assert.equal(findLevel5FloorCut(hvac, architecture, geometry.filter(x=>x.type!=="IfcSlab")), null);
});

test("rejects disjoint model coordinates", () => {
  assert.equal(findLevel5FloorCut([300,42,300,310,46,310],architecture,geometry),null);
});

test("rejects a slab at architectural minimum instead of cutting everything", () => {
  assert.equal(findLevel5FloorCut([10,2,10,35,4,35],architecture,[geometry[0]]),null);
});


test("cuts just under the selected Level 5 floor, not the ground floor", () => {
  const identified = {
    id:"19jRsGRmHCtQuanP7b0FIs",
    type:"IfcSlab",
    aabb:[5,40,5,40,40.4,40]
  };
  const cut = findFloorCutFromIdentifiedSlab(architecture, identified);
  assert.ok(cut);
  assert.equal(cut.slabId, identified.id);
  assert.ok(cut.y < identified.aabb[1]);
  assert.ok(cut.y > 39.8);
  assert.equal(cut.source, "operator-identified-IfcSlab");
});

test("does not clip without a valid slab reference", () => {
  assert.equal(findFloorCutFromIdentifiedSlab(architecture, null), null);
  assert.equal(findFloorCutFromIdentifiedSlab(architecture, {
    id:"not-floor", type:"IfcWall", aabb:[5,40,5,40,40.4,40]
  }), null);
  assert.equal(findFloorCutFromIdentifiedSlab(architecture, {
    id:"wrong-coordinates", type:"IfcSlab", aabb:[5,70,5,40,70.4,40]
  }), null);
});

