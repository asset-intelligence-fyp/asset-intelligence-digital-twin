"""Stream real IFC tessellation in metres, preserving GlobalIds and spatial parents."""
import json,sys,os
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
m=ifcopenshell.open(sys.argv[1])
def emit(data):
    print(json.dumps(data,separators=(',',':')),flush=True)
parents={}
for rel in m.by_type('IfcRelAggregates'):
    for child in rel.RelatedObjects: parents[child.id()]=rel.RelatingObject
for rel in m.by_type('IfcRelContainedInSpatialStructure'):
    for child in rel.RelatedElements: parents[child.id()]=rel.RelatingStructure
for obj in m.by_type('IfcObjectDefinition'):
    parent=parents.get(obj.id())
    emit({'kind':'meta','id':obj.GlobalId,'name':obj.Name or obj.is_a(),'type':obj.is_a(),'parent':parent.GlobalId if parent else None})
settings=ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS,True)
settings.set(settings.WELD_VERTICES,True)
settings.set(settings.MESHER_LINEAR_DEFLECTION,0.01)
settings.set(settings.MESHER_ANGULAR_DEFLECTION,0.5)
# Spaces/openings are void volumes, not physical drawable building components.
exclude=m.by_type('IfcSpace')+m.by_type('IfcOpeningElement')
it=ifcopenshell.geom.iterator(settings,m,2,exclude=exclude)
count=0
if it.initialize():
    while True:
        shape=it.get(); geom=shape.geometry; v=geom.verts
        positions=[]
        for i in range(0,len(v),3): positions.extend((v[i],v[i+2],-v[i+1]))
        color=[0.72,0.76,0.79]; opacity=1.0
        if geom.materials:
            material=geom.materials[0]
            color=[material.diffuse.r(),material.diffuse.g(),material.diffuse.b()]
            if material.has_transparency(): opacity=1.0-material.transparency
        emit({'kind':'geometry','id':shape.guid,'positions':positions,'indices':list(geom.faces),'color':color,'opacity':opacity})
        count+=1
        if count%500==0: print(f'Tessellated {count} IFC objects',file=sys.stderr,flush=True)
        if not it.next():break
print(f'Tessellation finished: {count} objects',file=sys.stderr)
