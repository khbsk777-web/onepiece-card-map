"""全国のコンビニとヨドバシカメラを OpenStreetMap から取ってきて、
都道府県ごとに data/pref/JP-01.json 〜 JP-47.json に保存する。
アプリは「いま地図に映っている県」のファイルだけを読むので、スマホでも軽い。
GitHub Actions で週1回自動で動く（福岡県は data/fukuoka.json で毎日更新）。
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
PREFS = ("北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 "
         "愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県").split()
KEEP = ["shop", "name", "name:ja", "brand", "brand:ja", "branch", "branch:ja",
        "addr:full", "addr:province", "addr:city", "addr:suburb", "addr:quarter", "addr:neighbourhood",
        "addr:block_number", "addr:housenumber"]
OUT = "data/pref"

def query(code):
    return ('[out:json][timeout:240];area["ISO3166-2"="%s"]->.a;('
            'nwr["shop"="convenience"](area.a);'
            'nwr["shop"="electronics"]["name"~"ヨドバシ|Yodobashi",i](area.a);'
            'nwr["shop"="electronics"]["brand"~"ヨドバシ|Yodobashi",i](area.a););out center 30000;' % code)

def fetch(code):
    body = urllib.parse.urlencode({"data": query(code)}).encode()
    last = None
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "onepiece-card-map (github.com/khbsk777-web/onepiece-card-map)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.load(r)["elements"]
            except Exception as e:  # 次のサーバー・次の回へ
                last = e
                print("  retry:", code, url, e, file=sys.stderr)
                time.sleep(10)
        time.sleep(60)
    print(f"  {code} は取得できませんでした（前のデータを残します）: {last}", file=sys.stderr)
    return None

def main():
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, "index.json")
    try:
        index = json.load(open(idx_path, encoding="utf-8"))
    except Exception:
        index = {"prefs": {}}
    ok = 0
    for i, name in enumerate(PREFS, 1):
        code = "JP-%02d" % i
        print(code, name, flush=True)
        els = fetch(code)
        time.sleep(5)  # サーバーに負担をかけないよう少し待つ
        if els is None:
            continue
        out = []
        for e in els:
            lat = e.get("lat") or (e.get("center") or {}).get("lat")
            lon = e.get("lon") or (e.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue
            tags = {k: v for k, v in (e.get("tags") or {}).items() if k in KEEP}
            out.append({"type": e["type"], "id": e["id"], "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags})
        old = index["prefs"].get(code, {}).get("count", 0)
        if not out or len(out) < old * 0.7:  # 急に減ったときは失敗とみなして上書きしない
            print(f"  {code}: 件数が少なすぎます {len(out)}（前回 {old}）", file=sys.stderr)
            continue
        out.sort(key=lambda x: (x["type"], x["id"]))
        with open(os.path.join(OUT, code + ".json"), "w", encoding="utf-8") as f:
            json.dump({"code": code, "name": name, "count": len(out), "elements": out}, f, ensure_ascii=False, separators=(",", ":"))
        lats = [x["lat"] for x in out]; lons = [x["lon"] for x in out]
        index["prefs"][code] = {"name": name, "count": len(out),
                                "bbox": [min(lats), min(lons), max(lats), max(lons)]}
        ok += 1
        print(f"  saved {len(out)}", flush=True)
    if ok == 0:
        raise SystemExit("1件も取得できませんでした")
    index["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print("done", ok, "prefectures")

if __name__ == "__main__":
    main()
