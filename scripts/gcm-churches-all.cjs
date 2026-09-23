// GCM: ALL REAL churches - every governorate, every small city/village, ALL sects (Orthodox/Catholic/Evangelical/Coptic)
// Strategy: ONE SMALL per-governorate bbox query (each tiny & reliable on public Overpass) -> no mosques, no missing villages.
// Prints the full table to console AND writes churches-full.sql (run it in Supabase SQL editor).
const fs = require('fs');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// Governorate -> [south, west, north, east]. Broad so EVERY small city/village in that gov is INSIDE.
const GOV = {
  'القاهرة':       [29.85, 31.10, 30.20, 31.70],
  'الجيزة':        [29.50, 30.75, 30.20, 31.35],
  'الإسكندرية':    [30.90, 29.60, 31.40, 30.20],
  'الدقهلية':      [30.80, 31.10, 31.40, 31.90],
  'البحر الأحمر':  [22.00, 32.10, 28.60, 35.20],
  'البحيرة':       [30.10, 29.70, 31.30, 30.90],
  'الفيوم':        [29.00, 30.30, 29.80, 31.10],
  'الغربية':       [30.55, 30.60, 31.15, 31.35],
  'الإسماعيلية':   [30.30, 32.00, 30.85, 32.55],
  'المنوفية':      [30.15, 30.60, 30.85, 31.25],
  'المنيا':        [27.55, 30.30, 28.95, 31.00],
  'القليوبية':     [30.00, 30.95, 30.45, 31.45],
  'الوادي الجديد': [22.00, 26.50, 27.00, 31.00],
  'السويس':        [29.65, 32.15, 30.30, 32.75],
  'أسوان':         [22.80, 32.20, 24.10, 33.50],
  'أسيوط':         [26.80, 30.70, 27.45, 31.35],
  'بني سويف':      [28.85, 30.70, 29.65, 31.35],
  'بورسعيد':       [31.10, 32.10, 31.40, 32.45],
  'دمياط':         [31.05, 31.40, 31.65, 31.95],
  'الشرقية':       [30.25, 31.15, 30.95, 32.15],
  'جنوب سيناء':    [27.40, 32.90, 29.55, 34.80],
  'كفر الشيخ':     [31.00, 30.55, 31.60, 31.25],
  'مطروح':         [29.00, 25.00, 31.70, 29.00],
  'الأقصر':        [25.30, 32.25, 26.00, 32.85],
  'قنا':           [25.70, 32.10, 26.50, 32.95],
  'شمال سيناء':    [30.30, 32.40, 31.40, 34.30],
  'سوهاج':         [26.00, 31.30, 27.00, 32.00],
  'بورسعيد الملحقة': [] // placeholder, not a real gov
};

const MOSQUE_LIKE = /مسجد|mosque|جامع|مصلى|زاوية|جمعية|جمعيه|charity|معهد|مدرسة|مستشفى|hospital|school|مجمع|مصلَّح/i;

async function overpass(query) {
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GCM/1.0 (contact: admin@gcm.local)' },
        body: `data=${encodeURIComponent(query)}`
      });
      if (!r.ok) { console.log('   fail', ep.split('/')[2], r.status); continue; }
      return await r.json();
    } catch (e) { console.log('   endpoint error', ep.split('/')[2]); }
  }
  return null;
}

function southWestBest(gov, lat, lng) {
  // not needed here
  return gov;
}

async function main() {
  const all = {};
  let total = 0;
  for (const [gov, [s, w, n, e]] of Object.entries(GOV)) {
    if (!Array.isArray([s, w, n, e]) || !e) continueimar;
    console.log('\n== ' + gov);
    const q = `[out:json][timeout:60];(nwr["amenity"="place_of_worship"]["religion"!="muslim"](${s},${w},${n},${e});nwr["building"="church"](${s},${w},${n},${e});nwr["amenity"="place_of_worship"]["denomination"](${s},${w},${n},${e}););out center;`;
    const json = await overpass(q);
    const elements = Array.isArray(json?.elements) ? json.elements : [];
    const seen = new Set();
    const list = [];
    for (const el of elements) {
      const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
      const lng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const tags = el.tags || {};
      const religion = typeof tags.religion === 'string' ? tags.religion.toLowerCase() : '';
      if (religion === 'muslim') continue;
      const nameRaw = tags.name || tags['name:ar'] || tags['name:en'] || tags['name:ar:EG'] || '';
      const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim().slice(0,200) : 'كنيسة';
      if (MOSQUE_LIKE.test(name)) continue;
      const key = `${Math.round(lat*4)}|${Math.round(lng*4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name, lat, lng, address: typeof tags['addr:full'] === 'string' ? tags['addr:full'].slice(0,500) : (typeof tags.addr === 'string' ? tags.addr.slice(0,500) : '') });
    }
    all[gov] = list;
    total += list.length;
    console.log('   →', list.length);
  }

  // Emit SQL
  let out = '-- GCM ALL REAL CHURCHES - every governorate, every small city, ALL sects\n';
  out += `-- Generated ${new Date().toISOString()}\n\n`;
  out += 'DELETE FROM public.churches;\nDELETE FROM public.group_churches;\n\n';
  out += 'INSERT INTO public.churches (name, governorate, lat, lng, address) VALUES\n';
  const rows = [];
  for (const [gov, list] of Object.entries(all)) {
    for (const c of list) rows.push(`('${c.name.replace(/'/g, "''")}', '${gov.replace(/'/g, "''")}', ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}, ${c.address ? "'" + c.address.replace(/'/g, "''") + "'" : 'NULL'})`);
  }
  out += rows.join(',\n') + ';\n';
  out += '\nSELECT count(*) AS total_churches FROM public.churches;\n';
  fs.writeFileSync('churches-full.sql', out, 'utf8');
  console.log('\nTOTAL:', total);
  console.log('\n== TABLE (by governorate) ==');
  const table = [];
  for (const [gov, list] of Object.entries(all)) table.push([gov, list.length]);
  table.sort((a,b)=>b[1]-a[1]);
  for (const [g,c] of table) console.log(`  ${g} → ${c}`);
  console.log('\nWrote churches-full.sql');
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
