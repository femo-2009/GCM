#!/usr/bin/env node
// Import church features from OpenStreetMap into the GCM churches table.
// This script only generates SQL. It does not connect to or modify Supabase.
// Run the generated SQL in Supabase after applying supabase-church-import-migration.sql.

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_FILE = path.resolve(process.cwd(), 'churches-full.sql');
const REQUEST_DELAY_MS = 2500;
const ROWS_PER_INSERT = 150;
const USER_AGENT = 'GCM-Church-Import/1.0 (https://github.com/femo-2009/GCM)';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Governorate name -> [south, west, north, east].
// The named Overpass administrative area is tried first; the bounding box is a fallback.
const GOVERNORATES = {
  'القاهرة': { english: 'Cairo', bbox: [29.85, 31.00, 30.25, 31.70] },
  'الجيزة': { english: 'Giza', bbox: [29.50, 30.80, 30.30, 31.40] },
  'الإسكندرية': { english: 'Alexandria', bbox: [30.90, 29.60, 31.40, 30.20] },
  'الدقهلية': { english: 'Dakahlia', bbox: [30.80, 31.20, 31.40, 31.90] },
  'البحر الأحمر': { english: 'Red Sea', bbox: [22.00, 32.50, 28.00, 34.50] },
  'البحيرة': { english: 'Beheira', bbox: [30.20, 29.80, 31.30, 30.80] },
  'الفيوم': { english: 'Faiyum', bbox: [29.00, 30.40, 29.80, 31.00] },
  'الغربية': { english: 'Gharbia', bbox: [30.60, 30.70, 31.20, 31.30] },
  'الإسماعيلية': { english: 'Ismailia', bbox: [30.30, 32.00, 30.80, 32.50] },
  'المنوفية': { english: 'Monufia', bbox: [30.20, 30.70, 30.80, 31.20] },
  'المنيا': { english: 'Minya', bbox: [27.80, 30.40, 28.80, 31.00] },
  'القليوبية': { english: 'Qalyubia', bbox: [30.00, 31.00, 30.40, 31.40] },
  'الوادي الجديد': { english: 'New Valley', bbox: [22.00, 27.00, 26.00, 31.00] },
  'السويس': { english: 'Suez', bbox: [29.70, 32.20, 30.20, 32.70] },
  'أسوان': { english: 'Aswan', bbox: [23.50, 32.40, 24.50, 33.20] },
  'أسيوط': { english: 'Asyut', bbox: [26.80, 30.80, 27.80, 31.50] },
  'بني سويف': { english: 'Beni Suef', bbox: [28.80, 30.80, 29.60, 31.30] },
  'بورسعيد': { english: 'Port Said', bbox: [31.10, 32.10, 31.40, 32.40] },
  'دمياط': { english: 'Damietta', bbox: [31.20, 31.50, 31.60, 31.90] },
  'الشرقية': { english: 'Sharqia', bbox: [30.30, 31.20, 30.90, 32.00] },
  'جنوب سيناء': { english: 'South Sinai', bbox: [27.50, 33.00, 29.50, 34.80] },
  'كفر الشيخ': { english: 'Kafr el-Sheikh', bbox: [31.00, 30.70, 31.60, 31.30] },
  'مطروح': { english: 'Matrouh', bbox: [29.50, 25.00, 31.50, 29.00] },
  'الأقصر': { english: 'Luxor', bbox: [25.30, 32.30, 26.00, 32.80] },
  'قنا': { english: 'Qena', bbox: [25.80, 32.20, 26.50, 32.80] },
  'شمال سيناء': { english: 'North Sinai', bbox: [30.50, 32.50, 31.30, 34.00] },
  'سوهاج': { english: 'Sohag', bbox: [26.00, 31.30, 27.00, 32.00] },
};

const CHRISTIAN_DENOMINATION = /christian|coptic|orthodox|catholic|evangel|protestant|melkite|armenian|maronite|syriac|apostolic|baptist|presbyterian|pentecostal|lutheran|methodist|reformed/i;
const NON_CHURCH_NAME = /مسجد|mosque|جامع|مصلى|زاوية|كنيس|synagogue|معبد|temple|charity|جمعية|جمعيه|معهد|مدرسة|مستشفى|hospital|school/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQuery(governorate, useArea) {
  const location = useArea
    ? `(area.searchArea)`
    : `(${governorate.bbox.join(',')})`;
  const areaPrefix = useArea
    ? `area["name"="${governorate.english}"]["admin_level"~"4|5"]->.searchArea;`
    : '';

  return `[out:json][timeout:45];${areaPrefix}(` +
    `nwr["amenity"="place_of_worship"]["religion"~"christian",i]${location};` +
    `nwr["building"="church"]${location};` +
    `nwr["amenity"="place_of_worship"]["denomination"~"(christian|coptic|orthodox|catholic|evangel|protestant|melkite|armenian|maronite|syriac|apostolic|baptist|presbyterian|pentecostal|lutheran|methodist|reformed)",i]${location};` +
    `);out center tags;`;
}

async function queryOverpass(query, governorateName, queryType) {
  let lastError;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(55_000),
      });

      if (!response.ok) {
        const details = (await response.text()).slice(0, 250);
        throw new Error(`${response.status} ${details}`);
      }

      const data = await response.json();
      if (!Array.isArray(data.elements)) {
        throw new Error('The Overpass response did not contain an elements array.');
      }
      return data.elements;
    } catch (error) {
      lastError = error;
      console.warn(`  ${queryType} query failed on ${new URL(endpoint).host}; trying another endpoint.`);
      const message = String(error?.message || error);
      // Public Overpass instances ask clients to pause after rate-limit responses.
      await sleep(/\b(429|406)\b/.test(message) ? 30_000 : 3000);
    }
  }

  throw new Error(`${governorateName}: all Overpass endpoints failed (${lastError?.message || 'unknown error'}).`);
}

function normalizeChurch(element, governorate) {
  const tags = element.tags || {};
  const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
  const lng = typeof element.lon === 'number' ? element.lon : element.center?.lon;
  const osmType = typeof element.type === 'string' ? element.type : '';
  const osmId = Number(element.id);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !osmType || !Number.isSafeInteger(osmId)) {
    return null;
  }

  const religion = String(tags.religion || '').toLowerCase();
  const denomination = String(tags.denomination || '');
  const building = String(tags.building || '').toLowerCase();
  const hasChristianReligion = religion.includes('christian');
  const hasChristianDenomination = CHRISTIAN_DENOMINATION.test(denomination);
  const isChurchBuilding = building === 'church';

  if (religion.includes('muslim') || religion.includes('jewish') || religion.includes('buddhist') || religion.includes('hindu')) {
    return null;
  }
  if (!hasChristianReligion && !hasChristianDenomination && !isChurchBuilding) {
    return null;
  }

  const rawName = tags['name:ar'] || tags['name:ar:EG'] || tags.name || tags['name:en'] || 'كنيسة بدون اسم';
  const name = String(rawName).trim().slice(0, 200) || 'كنيسة بدون اسم';
  if (NON_CHURCH_NAME.test(name)) return null;

  const address = String(
    tags['addr:full'] ||
    [tags['addr:street'], tags['addr:housenumber'], tags['addr:place']].filter(Boolean).join('، ') ||
    ''
  ).trim().slice(0, 500);

  return {
    osmType,
    osmId,
    name,
    governorate,
    lat,
    lng,
    address,
  };
}

function sqlText(value) {
  return value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${value}`);
  return Number(value).toFixed(7);
}

function churchValues(church) {
  return `(${[
    sqlText(church.name),
    sqlText(church.governorate),
    sqlNumber(church.lat),
    sqlNumber(church.lng),
    sqlText(church.address),
    sqlText(church.osmType),
    String(church.osmId),
  ].join(', ')})`;
}

function buildSql(churches, countsByGovernorate, failedGovernorates) {
  const lines = [
    '-- GCM bulk church import from OpenStreetMap.',
    `-- Generated: ${new Date().toISOString()}`,
    '-- License: Open Database License (ODbL); attribution: OpenStreetMap contributors.',
    '-- This is an idempotent upsert. It does not delete churches or group_churches statuses.',
    '-- Apply supabase-church-import-migration.sql before running this file.',
    ...(failedGovernorates.length
      ? [`-- WARNING: PARTIAL DATA. Overpass failed for: ${failedGovernorates.join(', ')}. Rerun the importer before treating this as complete.`]
      : ['-- All governorate queries completed successfully.']),
    '',
    'BEGIN;',
    '',
  ];

  for (let start = 0; start < churches.length; start += ROWS_PER_INSERT) {
    const chunk = churches.slice(start, start + ROWS_PER_INSERT);
    lines.push(
      'INSERT INTO public.churches (name, governorate, lat, lng, address, osm_type, osm_id)',
      'SELECT incoming.name, incoming.governorate, incoming.lat, incoming.lng, incoming.address, incoming.osm_type, incoming.osm_id',
      'FROM (VALUES',
      chunk.map((church) => churchValues(church)).join(',\n'),
      ') AS incoming(name, governorate, lat, lng, address, osm_type, osm_id)',
      'WHERE NOT EXISTS (',
      '  SELECT 1',
      '  FROM public.churches AS existing',
      '  WHERE existing.osm_type IS NULL',
      '    AND existing.governorate = incoming.governorate',
      '    AND lower(btrim(existing.name)) = lower(btrim(incoming.name))',
      '    AND abs(existing.lat - incoming.lat) < 0.0003',
      '    AND abs(existing.lng - incoming.lng) < 0.0003',
      ')',
      'ON CONFLICT (osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL',
      'DO UPDATE SET',
      '  name = EXCLUDED.name,',
      '  governorate = EXCLUDED.governorate,',
      '  lat = EXCLUDED.lat,',
      '  lng = EXCLUDED.lng,',
      '  address = EXCLUDED.address;',
      '',
    );
  }

  lines.push(
    'COMMIT;',
    '',
    '-- Check the imported totals by governorate.',
    'SELECT governorate, count(*) AS church_count',
    'FROM public.churches',
    'GROUP BY governorate',
    'ORDER BY governorate;',
    '',
    '-- Source records fetched during this run:',
    `-- ${churches.length} unique OpenStreetMap objects`,
    ...Object.entries(countsByGovernorate).map(([governorate, count]) => `-- ${governorate}: ${count === null ? 'QUERY FAILED' : count}`),
    '',
  );

  return lines.join('\n');
}

async function fetchGovernorateChurches(governorateName, governorate) {
  let elements = [];
  try {
    elements = await queryOverpass(buildQuery(governorate, true), governorateName, 'administrative-area');
  } catch (error) {
    console.warn(`  Administrative-area search failed: ${error.message}`);
  }

  // The bounding box is a fallback for missing/unmatched OSM administrative areas.
  if (elements.length === 0) {
    elements = await queryOverpass(buildQuery(governorate, false), governorateName, 'bounding-box');
  }

  const output = [];
  for (const element of elements) {
    const church = normalizeChurch(element, governorateName);
    if (church) output.push(church);
  }
  return output;
}

async function main() {
  const churchesByOsmId = new Map();
  const countsByGovernorate = {};
  const failedGovernorates = [];
  const entries = Object.entries(GOVERNORATES);

  console.log(`Searching OpenStreetMap for churches across ${entries.length} Egyptian governorates.`);
  console.log('This script only creates churches-full.sql; it does not change Supabase.');

  for (let index = 0; index < entries.length; index += 1) {
    const [governorateName, governorate] = entries[index];
    process.stdout.write(`\n[${index + 1}/${entries.length}] ${governorateName}: `);

    let churches;
    try {
      churches = await fetchGovernorateChurches(governorateName, governorate);
    } catch (error) {
      failedGovernorates.push(governorateName);
      countsByGovernorate[governorateName] = null;
      console.warn(`\n  Skipping ${governorateName} for now: ${error.message}`);
      if (index < entries.length - 1) await sleep(REQUEST_DELAY_MS);
      continue;
    }
    let addedForGovernorate = 0;

    for (const church of churches) {
      const key = `${church.osmType}/${church.osmId}`;
      if (churchesByOsmId.has(key)) continue;
      churchesByOsmId.set(key, church);
      addedForGovernorate += 1;
    }

    countsByGovernorate[governorateName] = addedForGovernorate;
    console.log(`${addedForGovernorate} unique churches found.`);

    if (index < entries.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const churches = [...churchesByOsmId.values()];
  if (churches.length === 0) {
    throw new Error('No church records were returned. No SQL file was written; try again later.');
  }

  fs.writeFileSync(OUTPUT_FILE, buildSql(churches, countsByGovernorate, failedGovernorates), 'utf8');

  console.log(`\nTotal unique churches: ${churches.length}`);
  console.log(`SQL file created: ${OUTPUT_FILE}`);
  if (failedGovernorates.length) {
    console.warn(`\nWARNING: this is a partial import. Failed governorates: ${failedGovernorates.join(', ')}`);
    console.warn('Rerun the script later; the generated SQL is safe to run again and updates the same OSM records.');
  } else {
    console.log('\nAll governorate queries completed.');
  }
  console.log('Next: run supabase-church-import-migration.sql in Supabase SQL Editor first,');
  console.log('then run the generated churches-full.sql in the same SQL Editor.');
}

main().catch((error) => {
  console.error(`\nImport preparation failed: ${error.message}`);
  process.exitCode = 1;
});
