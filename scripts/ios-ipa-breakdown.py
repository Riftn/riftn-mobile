"""Opens an .ipa and prints what takes the space, grouped the way it ships.

Usage: python3 ios-ipa-breakdown.py app.ipa >> summary.md
"""
import collections
import re
import sys
import zipfile

path = sys.argv[1]
z = zipfile.ZipFile(path)
infos = [i for i in z.infolist() if not i.is_dir()]
total = sum(i.file_size for i in infos)
packed = sum(i.compress_size for i in infos)
mb = lambda b: f"{b / 1e6:.1f} MB"

def group(name):
    m = re.match(r"Payload/[^/]+\.app/(.*)", name)
    if not m:
        return name.split("/")[0]
    rest = m.group(1)
    for pattern in (r"(PlugIns/[^/]+\.appex/Frameworks/[^/]+)", r"(PlugIns/[^/]+\.appex)",
                    r"(Frameworks/[^/]+)", r"([^/]+\.bundle)", r"(assets)/", r"([^/]+\.lproj)/"):
        g = re.match(pattern, rest)
        if g:
            return g.group(1)
    return rest if "/" not in rest else rest.split("/")[0] + "/"

groups = collections.defaultdict(lambda: [0, 0, 0])
for i in infos:
    g = groups[group(i.filename)]
    g[0] += i.file_size
    g[1] += i.compress_size
    g[2] += 1

print("")
print(f"## Inside the .ipa: {mb(total)} unzipped, {mb(packed)} zipped, {len(infos)} files")
print("")
print("| Part | Unzipped | Zipped | Files |")
print("|---|---:|---:|---:|")
for name, (size, comp, n) in sorted(groups.items(), key=lambda kv: -kv[1][0])[:45]:
    print(f"| {name} | {mb(size)} | {mb(comp)} | {n} |")

print("")
print("## 40 largest single files")
print("")
print("| File | Unzipped | Zipped |")
print("|---|---:|---:|")
for i in sorted(infos, key=lambda i: -i.file_size)[:40]:
    short = re.sub(r"^Payload/[^/]+\.app/", "", i.filename)
    print(f"| {short} | {mb(i.file_size)} | {mb(i.compress_size)} |")

assets = [i for i in infos if "/assets/" in i.filename]
by_ext = collections.Counter()
for i in assets:
    by_ext[i.filename.rsplit(".", 1)[-1].lower()] += i.file_size
print("")
print("## JS bundled assets by type")
print("")
for ext, size in by_ext.most_common(15):
    print(f"- {ext}: {mb(size)}")
