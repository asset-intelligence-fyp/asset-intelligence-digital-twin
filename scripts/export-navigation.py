"""Export light navigation metadata from the source IFC; viewing needs no Python IFC tools."""
import gzip,json,pathlib,tempfile
import ifcopenshell,ifcopenshell.geom,ifcopenshell.util.element,ifcopenshell.util.unit
root=pathlib.Path(__file__).resolve().parent.parent
with tempfile.NamedTemporaryFile(suffix='.ifc') as tmp:
    tmp.write(gzip.decompress((root/'public/models/FYP_WholeBuilding_18Sensors.ifc.gz').read_bytes()));tmp.flush()
    model=ifcopenshell.open(tmp.name)
scale=ifcopenshell.util.unit.calculate_unit_scale(model)
settings=ifcopenshell.geom.settings();settings.set(settings.USE_WORLD_COORDS,True)
def bounds(obj):
    shape=ifcopenshell.geom.create_shape(settings,obj);v=shape.geometry.verts
    # Same Z-up -> Y-up transform as the delivered XKT conversion.
    return [min(v[0::3]),min(v[2::3]),-max(v[1::3]),max(v[0::3]),max(v[2::3]),-min(v[1::3])]
levels=sorted([{'id':s.Name,'label':s.Name.replace('_',' '),'elevation':round(s.Elevation*scale,5)} for s in model.by_type('IfcBuildingStorey')],key=lambda s:s['elevation'])
for i,level in enumerate(levels):level['ceiling']=levels[i+1]['elevation'] if i+1<len(levels) else level['elevation']+5
points=[];rooms={}
for p in json.loads((root/'shared/sensorRegistry.json').read_text()):
    obj=model.by_guid(p['guid']);a=bounds(obj);container=ifcopenshell.util.element.get_container(obj)
    room=None
    if container and container.is_a('IfcSpace'):
        if container.GlobalId not in rooms:rooms[container.GlobalId]=bounds(container)
        room=rooms[container.GlobalId]
    points.append({'guid':p['guid'],'code':p['code'],'floor':p['floor'],'position':[(a[i]+a[i+3])/2 for i in range(3)],'aabb':a,'roomAabb':room})
out={'source':'IFC spatial hierarchy and world geometry; metres, Y-up','levels':levels,'sensors':points}
(root/'shared/modelNavigation.json').write_text(json.dumps(out,indent=2)+'\n')
print('Exported',len(levels),'IFC storeys and',len(points),'sensor positions')
