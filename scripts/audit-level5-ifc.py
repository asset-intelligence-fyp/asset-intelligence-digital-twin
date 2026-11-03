#!/usr/bin/env python3
"""Inspect Level 5 IFC storeys and sensor GUIDs before converting to XKT.

Run with Python and ifcopenshell installed:
    python scripts/audit-level5-ifc.py
This is an audit of IFC spatial assignments, not a geometry-cropping tool.
"""
import re
import sys
from pathlib import Path

DEFAULT_IFC = (
    Path(__file__).resolve().parents[1]
    / "public" / "models" / "Snowdon_Level5_Model+HVAC.ifc"
)
SENSOR_GUIDS = {
    "S-L5-001": "2kuK4GGyjA5QV8NiAnXeXZ",
    "S-L5-002": "3gW6u2ne59c8oABDoS7b3j",
    "S-L5-003": "3gW6u2ne59c8oABDoS7bB3",
    "S-L5-004": "3iie255UfEvg3mun9qVzgx",
    "S-L5-005": "050uZGzlP8Yg9H1S$ofK0i",
    "S-L5-006": "050uZGzlP8Yg9H1S$ofKIe",
    "S-L5-007": "050uZGzlP8Yg9H1S$ofKRW",
    "S-L5-008": "1Rnvr0S6DA0x5eK1Aa66rR",
}


def contained_ids(container, seen=None):
    """Find physical products assigned directly or within decomposed spaces."""
    seen = set() if seen is None else seen
    if container.id() in seen:
        return set()
    seen.add(container.id())
    found = set()
    for rel in getattr(container, "ContainsElements", ()) or ():
        for product in rel.RelatedElements:
            found.add(product.id())
    for rel in getattr(container, "IsDecomposedBy", ()) or ():
        for child in rel.RelatedObjects:
            found |= contained_ids(child, seen)
    return found


def main():
    try:
        import ifcopenshell
    except ImportError:
        print("Missing dependency: run python -m pip install ifcopenshell", file=sys.stderr)
        return 2

    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IFC
    if not source.is_file():
        print(f"IFC file not found: {source}", file=sys.stderr)
        return 2
    print(f"Source IFC: {source}")
    model = ifcopenshell.open(str(source))
    storeys = model.by_type("IfcBuildingStorey")
    print(f"Declared building storeys: {len(storeys)}")
    other_storeys_with_elements = []
    for floor in storeys:
        name = str(floor.Name or "(unnamed)")
        count = len(contained_ids(floor))
        is_level5 = bool(re.search(r"(?i)(?:level|floor|storey|l)\s*0?5\b|(?<!\d)0?5(?!\d)", name))
        print(f"  {'L5' if is_level5 else '--'}  {name}: {count} assigned products")
        if count > 0 and not is_level5:
            other_storeys_with_elements.append((name, count))
    if not storeys:
        print("WARNING: No IFCBUILDINGSTOREY objects found; floor scope cannot be checked.")
    print("\nPhysical BIM sensor GUIDs:")
    missing = []
    for sensor_code, guid in SENSOR_GUIDS.items():
        try:
            element = model.by_guid(guid)
        except (RuntimeError, KeyError):
            element = None
        found = element is not None
        print(f"  {sensor_code}: {'FOUND' if found else 'MISSING'} {guid}")
        if not found:
            missing.append(sensor_code)
    if missing:
        print(f"WARNING: {len(missing)} of 8 sensor GUIDs are missing. These sensors cannot be selected by BIM GUID.")
    if other_storeys_with_elements:
        print("\nFAIL: Non-Level-5 storeys contain spatially assigned IFC products.")
        print("Re-export the model with Level 5 elements only before converting.")
        return 1
    print("\nNo products assigned to another named storey were found.")
    print("NOTE: Review unassigned geometry and the converted XKT visually; spatial assignments alone are not exhaustive.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

