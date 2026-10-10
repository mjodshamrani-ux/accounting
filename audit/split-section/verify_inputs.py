"""Independent immutable-input verifier. Uses only Python standard library."""
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parent
EXPECTED_MANIFEST_SHA256='ebb1f9678384fa35ff23c28d636c240c6d1488ac483006ae85a20b019e2bc16c'
def verify():
    source=ROOT.parent.parent
    manifest_bytes=(ROOT/'INPUT-MANIFEST.json').read_bytes()
    assert hashlib.sha256(manifest_bytes).hexdigest()==EXPECTED_MANIFEST_SHA256,'input manifest changed'
    manifest=json.loads(manifest_bytes); checks=1
    assert manifest['caseCount']==55; checks+=1
    paths=set()
    for entry in manifest['files']:
        rel=Path(entry['path'])
        assert not rel.is_absolute() and '..' not in rel.parts; checks+=1
        path=source/rel
        assert path.resolve().is_relative_to((ROOT/'frozen').resolve()); checks+=1
        data=path.read_bytes()
        assert len(data)==entry['bytes'] and hashlib.sha256(data).hexdigest()==entry['sha256'],entry['path']; checks+=1
        if path.suffix=='.json':
            assert b'/Users/' not in data and b'/tmp/' not in data,'private absolute path in public fixture'; checks+=1
        paths.add(path.resolve())
    actual={p.resolve() for p in (ROOT/'frozen').rglob('*') if p.is_file()}
    assert paths==actual,'canonical input file set changed'; checks+=1
    cases=json.loads((ROOT/'frozen/CASES.json').read_text())
    assert len(cases)==55 and len({c['id'] for c in cases})==55; checks+=1
    assert sum(c['metadataMutation'] for c in cases)==5; checks+=1
    return {'passed':True,'checks':checks,'cases':55,'files':len(paths),'manifestSha256':EXPECTED_MANIFEST_SHA256,'productImports':False}
if __name__=='__main__':
    result=verify()
    if len(sys.argv)>1:
        out=Path(sys.argv[1]);assert not out.exists(),'refuse overwrite';out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
