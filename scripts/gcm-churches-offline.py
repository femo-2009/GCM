#!/usr/bin/env python3
"""Build a Supabase SQL import from a local Egypt OpenStreetMap PBF extract.

This script downloads the complete Geofabrik Egypt extract and the current
geoBoundaries ADM1 polygons, filters church/place-of-worship features locally
with Osmium, assigns them to governorates by point-in-polygon, and writes
churches-full.sql. It never connects to or modifies Supabase.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape

OUTPUT_FILE = Path.cwd() / "churches-full.sql"
PBF_URL = "https://download.geofabrik.de/africa/egypt-latest.osm.pbf"
BOUNDARIES_API_URL = "https://www.geoboundaries.org/api/current/gbOpen/EGY/ADM1/"
USER_AGENT = "GCM-Church-Import/2.0 (https://github.com/femo-2009/GCM)"
ROWS_PER_INSERT = 150
EXPECTED_GOVERNORATES = 27

# Stable geoBoundaries shapeISO -> Arabic label already used by public.churches.
ISO_TO_ARABIC = {
    "EG-SIN": "شمال سيناء",
    "EG-JS": "جنوب سيناء",
    "EG-ASN": "أسوان",
    "EG-BA": "البحر الأحمر",
    "EG-MT": "مطروح",
    "EG-WAD": "الوادي الجديد",
    "EG-ALX": "الإسكندرية",
    "EG-IS": "الإسماعيلية",
    "EG-SUZ": "السويس",
    "EG-GH": "الغربية",
    "EG-FYM": "الفيوم",
    "EG-BNS": "بني سويف",
    "EG-MN": "المنيا",
    "EG-AST": "أسيوط",
    "EG-SHG": "سوهاج",
    "EG-KN": "قنا",
    "EG-LX": "الأقصر",
    "EG-GZ": "الجيزة",
    "EG-MNF": "المنوفية",
    "EG-BH": "البحيرة",
    "EG-C": "القاهرة",
    "EG-KB": "القليوبية",
    "EG-DK": "الدقهلية",
    "EG-DT": "دمياط",
    "EG-KFS": "كفر الشيخ",
    "EG-PTS": "بورسعيد",
    "EG-SHR": "الشرقية",
}

CHURCH_BUILDING_TYPES = {"church", "chapel", "cathedral", "basilica"}
CHRISTIAN_DENOMINATION = re.compile(
    r"christian|coptic|orthodox|catholic|evangel|protestant|melkite|armenian|"
    r"maronite|syriac|apostolic|baptist|presbyterian|pentecostal|lutheran|"
    r"methodist|reformed",
    re.IGNORECASE,
)
NON_CHURCH_NAME = re.compile(
    r"مسجد|mosque|جامع|مصلى|زاوية|كنيس(?!ة)|synagogue|معبد|temple|charity|"
    r"جمعية|جمعيه|معهد|مدرسة|مستشفى|hospital|school",
    re.IGNORECASE,
)
NON_CHRISTIAN_RELIGIONS = ("muslim", "islam", "jewish", "judaism", "buddhist", "hindu")


def log(message: str) -> None:
    print(message, flush=True)


def download_file(url: str, destination: Path, label: str) -> None:
    """Download a source with retries and visible progress; fail rather than use a partial file."""
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response:
                total = int(response.headers.get("Content-Length", "0") or 0)
                received = 0
                last_report = 0
                with destination.open("wb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                        received += len(chunk)
                        if received - last_report >= 25 * 1024 * 1024:
                            if total:
                                log(f"  {label}: {received / 1024 / 1024:.0f}/{total / 1024 / 1024:.0f} MB")
                            else:
                                log(f"  {label}: {received / 1024 / 1024:.0f} MB downloaded")
                            last_report = received
                if received == 0 or (total and received != total):
                    raise RuntimeError(
                        f"Incomplete {label} download: received {received} bytes; expected {total}."
                    )
            log(f"  {label}: downloaded {received / 1024 / 1024:.1f} MB")
            return
        except Exception as error:  # retry network and interrupted-transfer failures
            last_error = error
            destination.unlink(missing_ok=True)
            log(f"  {label} download attempt {attempt}/3 failed: {error}")
            if attempt < 3:
                time.sleep(attempt * 3)
    raise RuntimeError(f"Could not download {label} after 3 attempts: {last_error}")


def load_boundaries(temp_dir: Path) -> list[tuple[str, Any]]:
    """Fetch and validate the official geoBoundaries Egypt ADM1 GeoJSON."""
    metadata_path = temp_dir / "egypt-adm1-metadata.json"
    download_file(BOUNDARIES_API_URL, metadata_path, "Egypt ADM1 metadata")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("boundaryISO") != "EGY" or metadata.get("boundaryType") != "ADM1":
        raise RuntimeError("The geoBoundaries API did not return Egypt ADM1 metadata.")
    if int(metadata.get("admUnitCount", 0)) != EXPECTED_GOVERNORATES:
        raise RuntimeError(
            f"Expected {EXPECTED_GOVERNORATES} Egypt ADM1 units; API reports {metadata.get('admUnitCount')}."
        )

    geojson_url = metadata.get("gjDownloadURL")
    if not isinstance(geojson_url, str) or not geojson_url.startswith("https://"):
        raise RuntimeError("The geoBoundaries API did not provide a valid GeoJSON download URL.")

    geojson_path = temp_dir / "egypt-adm1.geojson"
    download_file(geojson_url, geojson_path, "Egypt governorate boundaries")
    collection = json.loads(geojson_path.read_text(encoding="utf-8"))
    features = collection.get("features")
    if not isinstance(features, list) or len(features) != EXPECTED_GOVERNORATES:
        raise RuntimeError(
            f"Expected {EXPECTED_GOVERNORATES} boundary features; received "
            f"{len(features) if isinstance(features, list) else 'invalid data'}."
        )

    boundaries: list[tuple[str, Any]] = []
    seen_codes: set[str] = set()
    for feature in features:
        properties = feature.get("properties") or {}
        code = properties.get("shapeISO")
        if code not in ISO_TO_ARABIC:
            raise RuntimeError(f"Unexpected or unmapped geoBoundaries shapeISO: {code!r}.")
        if code in seen_codes:
            raise RuntimeError(f"Duplicate geoBoundaries shapeISO: {code}.")
        geometry = shape(feature.get("geometry"))
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        if geometry.is_empty:
            raise RuntimeError(f"Empty governorate boundary for {properties.get('shapeName', code)}.")
        boundaries.append((ISO_TO_ARABIC[code], geometry))
        seen_codes.add(code)

    if seen_codes != set(ISO_TO_ARABIC):
        missing = sorted(set(ISO_TO_ARABIC) - seen_codes)
        raise RuntimeError(f"Missing governorate boundaries: {', '.join(missing)}.")

    log(f"Loaded and validated all {len(boundaries)} governorate boundaries.")
    return boundaries


def run_osmium(input_pbf: Path, temp_dir: Path) -> Path:
    """Filter relevant OSM objects, retaining way/relation members, then export streamable GeoJSON."""
    osmium = shutil.which("osmium")
    if not osmium:
        raise RuntimeError("The 'osmium' command is missing. Install the osmium-tool package first.")

    candidates = temp_dir / "church-candidates.osm.pbf"
    features = temp_dir / "church-features.geojsonseq"
    filters = [
        "nwr/amenity=place_of_worship",
        "nwr/building=church,chapel,cathedral,basilica",
        "nwr/place_of_worship=church",
    ]
    log("Filtering church/place-of-worship candidates from the local Egypt PBF...")
    subprocess.run(
        [osmium, "tags-filter", "--overwrite", "--remove-tags", "-o", str(candidates), str(input_pbf), *filters],
        check=True,
    )
    if not candidates.is_file() or candidates.stat().st_size == 0:
        raise RuntimeError("Osmium produced no candidate PBF file.")

    log("Converting candidates to streamed GeoJSONSeq (including OSM type and ID)...")
    subprocess.run(
        [
            osmium,
            "export",
            "--overwrite",
            "--output-format=geojsonseq",
            "--attributes=type,id",
            "--output",
            str(features),
            str(candidates),
        ],
        check=True,
    )
    if not features.is_file() or features.stat().st_size == 0:
        raise RuntimeError("Osmium produced no GeoJSONSeq features.")
    return features


def is_church(tags: dict[str, Any]) -> bool:
    religion = str(tags.get("religion", "")).casefold()
    denomination = str(tags.get("denomination", ""))
    building = str(tags.get("building", "")).casefold()
    place_of_worship = str(tags.get("place_of_worship", "")).casefold()

    if any(term in religion for term in NON_CHRISTIAN_RELIGIONS):
        return False
    return (
        "christian" in religion
        or bool(CHRISTIAN_DENOMINATION.search(denomination))
        or building in CHURCH_BUILDING_TYPES
        or place_of_worship == "church"
    )


def choose_governorate(point: Point, boundaries: list[tuple[str, Any]]) -> str | None:
    matches = [(name, polygon) for name, polygon in boundaries if polygon.covers(point)]
    if not matches:
        return None
    # Rare shared-boundary points: prefer the smaller polygon so a border point
    # does not get assigned to a much larger adjacent governorate.
    matches.sort(key=lambda item: item[1].area)
    return matches[0][0]


def normalized_record(feature: dict[str, Any], boundaries: list[tuple[str, Any]]) -> tuple[dict[str, Any] | None, str | None]:
    properties = feature.get("properties") or {}
    tags = properties
    if not is_church(tags):
        return None, None

    osm_type = properties.get("@type") or properties.get("type")
    osm_id_raw = properties.get("@id") or properties.get("id")
    try:
        osm_id = int(osm_id_raw)
    except (TypeError, ValueError):
        return None, "A matching feature did not include an integer OSM ID."
    if osm_type not in {"node", "way", "relation"}:
        return None, f"OSM object {osm_id} has an unexpected type {osm_type!r}."

    geometry_data = feature.get("geometry")
    if not geometry_data:
        return None, f"OSM object {osm_type}/{osm_id} has no geometry."
    try:
        geometry = shape(geometry_data)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        if geometry.is_empty:
            return None, f"OSM object {osm_type}/{osm_id} has empty geometry."
        point = geometry.representative_point()
    except Exception as error:
        return None, f"Could not read geometry for {osm_type}/{osm_id}: {error}"

    if not (-180 <= point.x <= 180 and -90 <= point.y <= 90):
        return None, f"OSM object {osm_type}/{osm_id} has invalid coordinates."
    governorate = choose_governorate(point, boundaries)
    if governorate is None:
        return None, f"OSM object {osm_type}/{osm_id} falls outside all 27 governorate polygons."

    raw_name = (
        tags.get("name:ar")
        or tags.get("name:ar:EG")
        or tags.get("name")
        or tags.get("name:en")
        or "كنيسة بدون اسم"
    )
    name = str(raw_name).strip()[:200] or "كنيسة بدون اسم"
    if NON_CHURCH_NAME.search(name):
        return None, None

    raw_address = tags.get("addr:full") or "، ".join(
        str(tags[key]).strip()
        for key in ("addr:street", "addr:housenumber", "addr:place")
        if tags.get(key)
    )
    address = str(raw_address).strip()[:500]

    return {
        "osm_type": osm_type,
        "osm_id": osm_id,
        "name": name,
        "governorate": governorate,
        "lat": float(point.y),
        "lng": float(point.x),
        "address": address,
        "geometry_rank": 3 if geometry.geom_type in {"Polygon", "MultiPolygon"} else 2,
    }, None


def read_churches(features_path: Path, boundaries: list[tuple[str, Any]]) -> tuple[list[dict[str, Any]], Counter[str], list[str]]:
    by_osm_id: dict[tuple[str, int], dict[str, Any]] = {}
    counts: Counter[str] = Counter({name: 0 for name, _ in boundaries})
    errors: list[str] = []
    objects_read = 0
    candidate_count = 0

    with features_path.open("rb") as stream:
        for raw_line in stream:
            line = raw_line.strip().lstrip(b"\x1e").strip()
            if not line:
                continue
            try:
                feature = json.loads(line)
            except json.JSONDecodeError as error:
                errors.append(f"Invalid GeoJSONSeq record: {error}")
                continue
            objects_read += 1
            if objects_read % 5000 == 0:
                log(f"  Processed {objects_read:,} GeoJSONSeq features; matched {candidate_count:,} church candidates so far.")

            record, error = normalized_record(feature, boundaries)
            if error:
                if len(errors) < 100:
                    errors.append(error)
                candidate_count += 1
                continue
            if record is None:
                continue
            candidate_count += 1
            key = (record["osm_type"], record["osm_id"])
            previous = by_osm_id.get(key)
            if previous is None or record["geometry_rank"] > previous["geometry_rank"]:
                by_osm_id[key] = record

    churches = list(by_osm_id.values())
    churches.sort(key=lambda item: (item["governorate"], item["name"].casefold(), item["osm_type"], item["osm_id"]))
    for church in churches:
        counts[church["governorate"]] += 1
    return churches, counts, errors


def sql_text(value: Any) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def sql_number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError(f"Invalid coordinate value: {value}")
    return f"{value:.7f}"


def church_values(church: dict[str, Any]) -> str:
    values = [
        sql_text(church["name"]),
        sql_text(church["governorate"]),
        sql_number(church["lat"]),
        sql_number(church["lng"]),
        sql_text(church["address"]),
        sql_text(church["osm_type"]),
        str(church["osm_id"]),
    ]
    return "(" + ", ".join(values) + ")"


def build_sql(churches: list[dict[str, Any]], counts: Counter[str], errors: list[str]) -> str:
    lines = [
        "-- GCM bulk church import from OpenStreetMap.",
        f"-- Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        "-- OSM extract: Geofabrik Egypt latest PBF; OpenStreetMap data license: ODbL 1.0.",
        "-- Governorate polygons: geoBoundaries EGY ADM1 (27 units; ODbL 1.0; source: OpenStreetMap/Wambacher).",
        "-- Attribution: OpenStreetMap contributors; https://www.openstreetmap.org/copyright",
        "-- This is an idempotent upsert. It does not delete churches or group_churches statuses.",
        "-- Apply supabase-church-import-migration.sql before running this file.",
    ]
    if errors:
        lines.append(
            f"-- WARNING: PARTIAL DATA. {len(errors)} matching feature(s) could not be safely assigned; "
            "see importer log and rerun after investigating."
        )
    else:
        lines.append("-- All matching church features were processed and assigned to one of the 27 governorates.")
    lines.extend(["", "BEGIN;", ""])

    for start in range(0, len(churches), ROWS_PER_INSERT):
        chunk = churches[start : start + ROWS_PER_INSERT]
        lines.extend(
            [
                "INSERT INTO public.churches (name, governorate, lat, lng, address, osm_type, osm_id)",
                "SELECT incoming.name, incoming.governorate, incoming.lat, incoming.lng, incoming.address, incoming.osm_type, incoming.osm_id",
                "FROM (VALUES",
                ",\n".join(church_values(church) for church in chunk),
                ") AS incoming(name, governorate, lat, lng, address, osm_type, osm_id)",
                "WHERE NOT EXISTS (",
                "  SELECT 1",
                "  FROM public.churches AS existing",
                "  WHERE existing.osm_type IS NULL",
                "    AND existing.governorate = incoming.governorate",
                "    AND lower(btrim(existing.name)) = lower(btrim(incoming.name))",
                "    AND abs(existing.lat - incoming.lat) < 0.0003",
                "    AND abs(existing.lng - incoming.lng) < 0.0003",
                ")",
                "ON CONFLICT (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL",
                "DO UPDATE SET",
                "  name = EXCLUDED.name,",
                "  governorate = EXCLUDED.governorate,",
                "  lat = EXCLUDED.lat,",
                "  lng = EXCLUDED.lng,",
                "  address = EXCLUDED.address;",
                "",
            ]
        )

    lines.extend(
        [
            "COMMIT;",
            "",
            "-- Current churches by governorate after import.",
            "SELECT governorate, count(*) AS church_count",
            "FROM public.churches",
            "GROUP BY governorate",
            "ORDER BY governorate;",
            "",
            "-- Unique OpenStreetMap objects prepared in this run:",
            f"-- {len(churches)}",
            "-- Per-governorate OpenStreetMap church counts:",
        ]
    )
    for governorate in sorted(counts):
        lines.append(f"-- {governorate}: {counts[governorate]}")
    if errors:
        lines.extend(["", "-- First importer warnings (full details are in the GitHub Actions log):"])
        for warning in errors[:25]:
            lines.append("-- " + warning.replace("\n", " ")[:500])
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    if not shutil.which("osmium"):
        raise RuntimeError("Osmium is not installed. The workflow must install osmium-tool before running this script.")

    with tempfile.TemporaryDirectory(prefix="gcm-egypt-osm-") as temp_name:
        temp_dir = Path(temp_name)
        pbf_path = temp_dir / "egypt-latest.osm.pbf"
        log("Source: official Geofabrik Egypt OSM extract; no Overpass queries will be sent.")
        download_file(PBF_URL, pbf_path, "Egypt OSM PBF")
        boundaries = load_boundaries(temp_dir)
        features_path = run_osmium(pbf_path, temp_dir)
        churches, counts, errors = read_churches(features_path, boundaries)

    if not churches:
        raise RuntimeError("No church records were found in the Egypt OSM extract; no SQL file was written.")

    OUTPUT_FILE.write_text(build_sql(churches, counts, errors), encoding="utf-8")
    log("")
    log(f"Unique OpenStreetMap church objects: {len(churches):,}")
    for governorate in sorted(counts):
        log(f"  {governorate}: {counts[governorate]:,}")
    log(f"SQL file created: {OUTPUT_FILE}")
    log("This script only generates SQL; it does not connect to or modify Supabase.")

    if errors:
        log(f"WARNING: {len(errors)} matching features need review; the SQL contains PARTIAL DATA warning.")
        for warning in errors[:25]:
            log(f"  - {warning}")
        sys.exit(2)

    log("All matching features were assigned to the 27 governorates. This is OSM coverage, not a guarantee that OSM lists every real-world church.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
