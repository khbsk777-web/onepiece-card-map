# 福岡県のコンビニを OpenStreetMap から取ってきて data/fukuoka-cvs.json に保存する
# GitHub Actions が毎週自動で動かす（手動でも実行できる）
import json, sys, time, urllib.parse, urllib.request

SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
QUERY = '[out:json][timeout:120];area["ISO3166-2"="JP-40"]->.a;nwr["shop"="convenience"](area.a);out center;'
KEEP = ["name", "name:ja", "name:en", "branch", "branch:ja", "brand", "brand:ja", "brand:en",
        "addr:full", "addr:province", "addr:city", "addr:suburb", "addr:quarter", "addr:neighbourhood",
        "addr:block_number", "addr:housenumber", "shop"]

def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for url in SERVERS:
        for _ in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "onepiece-card-map-updater"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.load(r)["elements"]
            except Exception as e:
                print("retry:", url, e, file=sys.stderr)
                time.sleep(20)
    raise SystemExit("Overpassから取得できませんでした")

out = []
for e in fetch():
    lat = e.get("lat", e.get("center", {}).get("lat"))
    lon = e.get("lon", e.get("center", {}).get("lon"))
    if lat is None or lon is None:
        continue
    tags = {k: v for k, v in (e.get("tags") or {}).items() if k in KEEP}
    out.append({"type": e["type"], "id": e["id"], "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags})

if len(out) < 500:  # 取得ミスで空っぽのデータを上書きしないため
    raise SystemExit(f"件数が少なすぎます: {len(out)}")
out.sort(key=lambda x: (x["type"], x["id"]))
with open("data/fukuoka-cvs.json", "w", encoding="utf-8") as f:
    json.dump({"updated": time.strftime("%Y-%m-%d"), "elements": out}, f, ensure_ascii=False, separators=(",", ":"))
print("保存しました:", len(out), "件")
