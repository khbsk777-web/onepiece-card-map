"""福岡県のお店データ（コンビニ・本屋・商業施設・カード/ホビー店）を
OpenStreetMap から取ってきて data/fukuoka.json に保存する。
GitHub Actions で毎日自動で動く。アプリはこのファイルを読むので、すぐに表示できる。
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
QUERY = ('[out:json][timeout:180];area["ISO3166-2"="JP-40"]->.a;('
         'nwr["shop"~"^(convenience|books|mall|department_store|toys|games|hobby|anime|collector)$"](area.a);'
         'nwr["shop"="supermarket"]["name"~"イオン|AEON"](area.a););out center 20000;')
KEEP = ["shop", "name", "name:ja", "name:en", "brand", "brand:ja", "brand:en", "branch", "branch:ja",
        "addr:full", "addr:province", "addr:city", "addr:suburb", "addr:quarter", "addr:neighbourhood",
        "addr:block_number", "addr:housenumber"]

def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "onepiece-card-map (github.com/khbsk777-web/onepiece-card-map)"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)["elements"]
            except Exception as e:  # 次のサーバー・次の回へ
                last = e
                print("retry:", url, e, file=sys.stderr)
        time.sleep(30)
    raise SystemExit(f"取得できませんでした: {last}")

def main():
    out = []
    for e in fetch():
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        tags = {k: v for k, v in (e.get("tags") or {}).items() if k in KEEP}
        out.append({"type": e["type"], "id": e["id"], "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags})
    if len(out) < 500:  # 少なすぎるときは失敗とみなして上書きしない
        raise SystemExit(f"件数が少なすぎます: {len(out)}")
    out.sort(key=lambda x: (x["type"], x["id"]))
    data = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "count": len(out), "elements": out}
    os.makedirs("data", exist_ok=True)
    with open("data/fukuoka.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("saved", len(out))

if __name__ == "__main__":
    main()
