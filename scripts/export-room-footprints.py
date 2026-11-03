"""Extract IFC space floor triangles. Never substitute a bounding box for a room shape."""
import gzip, json, pathlib, tempfile
import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element

root = pathlib.Path(__file__).resolve().parent.parent
with tempfile.NamedTemporaryFile(suffix='.ifc') as source:
    source.write(gzip.decompress((root/'public/models/FYP_WholeBuilding_18Sensors.ifc.gz').read_bytes()))
    source.flush()
    model = ifcopenshell.open(source.name)
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
navigation = json.loads((root/'shared/modelNavigation.json').read_text())
registry = json.loads((root/'shared/sensorRegistry.json').read_text())

def footprint(space):
    try:
        shape = ifcopenshell.geom.create_shape(settings, space)
        raw, faces = shape.geometry.verts, shape.geometry.faces
        verts = [[raw[i], raw[i+2], -raw[i+1]] for i in range(0, len(raw), 3)]
        bottom = min(v[1] for v in verts)
        # Only actual horizontal bottom faces, including holes and non-rectangular outlines.
        triangles = [faces[i:i+3] for i in range(0, len(faces), 3)
                     if all(abs(verts[j][1]-bottom) < .015 for j in faces[i:i+3])]
        if not triangles:
            return None
        positions, indices, lookup = [], [], {}
        for triangle in triangles:
            for index in triangle:
                v = verts[index]
                key = tuple(round(x, 5) for x in v)
                if key not in lookup:
                    lookup[key] = len(positions)//3
                    positions.extend(key)
                indices.append(lookup[key])
        counts = {}
        for i in range(0, len(indices), 3):
            a,b,c = indices[i:i+3]
            for edge in [(a,b),(b,c),(c,a)]:
                key = tuple(sorted(edge)); counts[key] = counts.get(key,0)+1
        boundary = [list(edge) for edge,count in counts.items() if count == 1]
        return {'guid':space.GlobalId, 'name':space.LongName or space.Name or 'IFC space',
                'positions':positions,'indices':indices,'boundary':boundary,
                'height':round(max(v[1] for v in verts)-bottom,5)}
    except RuntimeError:
        return None

cache = {}
def contains(room, position):
    p=room['positions']; x,y,z=position
    if not p[1]-.05 <= y <= p[1]+room['height']+.05:
        return False
    for i in range(0,len(room['indices']),3):
        a,b,c=[room['indices'][i+j]*3 for j in range(3)]
        signs=[(x-p[u])*(p[v+2]-p[u+2])-(z-p[u+2])*(p[v]-p[u]) for u,v in [(a,b),(b,c),(c,a)]]
        area=(p[b]-p[a])*(p[c+2]-p[a+2])-(p[c]-p[a])*(p[b+2]-p[a+2])
        if abs(area)>1e-8 and (all(s>=-1e-7 for s in signs) or all(s<=1e-7 for s in signs)):
            return True
    return False

out = {'source':'Actual horizontal bottom-face triangles of source IfcSpace geometry; metres, Y-up', 'rooms':{}, 'sensors':{}}
for point in registry:
    sensor = model.by_guid(point['guid'])
    container = ifcopenshell.util.element.get_container(sensor)
    room = None
    if container and container.is_a('IfcSpace'):
        if container.GlobalId not in cache:
            cache[container.GlobalId] = footprint(container)
        room = cache[container.GlobalId]
    status='IFC spatial containment' if room else 'No IFC room boundary linked to this marker'
    if not room:
        position=next(s['position'] for s in navigation['sensors'] if s['guid']==point['guid'])
        candidates=[]
        for space in model.by_type('IfcSpace'):
            if space.GlobalId not in cache: cache[space.GlobalId]=footprint(space)
            candidate=cache[space.GlobalId]
            if candidate and contains(candidate,position): candidates.append(candidate)
        if len(candidates)==1:
            room=candidates[0]
            status='Geometric space match at marker; room name unverified'
    if room:
        out['rooms'][room['guid']] = room
    out['sensors'][point['guid']] = {'roomGuid':room['guid'] if room else None,
        'status':status}
(root/'shared/roomFootprints.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print('Exported',len(out['rooms']),'actual IFC room footprints for',sum(bool(s['roomGuid']) for s in out['sensors'].values()),'of',len(registry),'markers')
