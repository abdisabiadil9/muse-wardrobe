"""Build distributable specs and standalone skills; exclude all local runtime state."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
out = root / 'public' / 'downloads'
out.mkdir(parents=True, exist_ok=True)
skills = ['qoder-cloud-agent', 'seedream-tryon']

def members(base):
    return sorted(p for p in base.rglob('*') if p.is_file() and not any(x.startswith('.') or x == 'node_modules' for x in p.relative_to(base).parts) and p.name != 'package-lock.json')

for name in skills:
    with ZipFile(out / (name + '-skill.zip'), 'w', ZIP_DEFLATED) as archive:
        for path in members(root / 'skills' / name):
            archive.write(path, str(path.relative_to(root / 'skills')))
with ZipFile(out / 'muse-developer-kit-v1.zip', 'w', ZIP_DEFLATED) as archive:
    for name in ['SPEC.md', 'LOCAL_DEVELOPMENT.md', 'TEAM_HANDOFF.md', 'SEEDREAM_TRYON.md', 'DEVELOPER_KIT_README.md', 'VALIDATION.md', 'contracts/openapi.json']:
        path = root / 'docs' / name
        if path.exists(): archive.write(path, str(path.relative_to(root)))
    for name in skills:
        for path in members(root / 'skills' / name): archive.write(path, str(path.relative_to(root)))
print('Packaged technical specifications and two portable skills; no runtime state.')
