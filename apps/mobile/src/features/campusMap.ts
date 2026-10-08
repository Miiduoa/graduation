import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';

export type CampusMapPlace = {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  building?: string;
  floor?: string;
  facilities: string[];
};
const categoryNames: Record<string, string> = {
  academic: '教學',
  building: '大樓',
  research: '研究',
  lab: '實驗室',
  library: '圖書館',
  admin: '行政',
  office: '行政',
  cafeteria: '餐飲',
  food: '餐飲',
  dormitory: '住宿',
  sports: '運動',
  parking: '停車',
  convenience: '生活',
  medical: '健康',
  religious: '宗教',
  gate: '交通',
  other: '其他',
};

export async function loadCampusMapPlaces(schoolId: string): Promise<CampusMapPlace[]> {
  if (!schoolId || schoolId.includes('/') || isFirebaseMockMode())
    throw new Error('Map source unavailable');
  const db = getDb();
  let snapshot = await getDocsFromServer(collection(db, 'schools', schoolId, 'pois'));
  // A failed canonical read stays an error; only a confirmed empty result uses the migration source.
  if (snapshot.empty)
    snapshot = await getDocsFromServer(
      query(collection(db, 'pois'), where('schoolId', '==', schoolId)),
    );
  return snapshot.docs
    .flatMap((entry) => {
      const data = entry.data();
      if (data.schoolId != null && data.schoolId !== schoolId)
        throw new Error('Invalid map school');
      if (
        typeof data.name !== 'string' ||
        !data.name.trim() ||
        typeof data.lat !== 'number' ||
        !Number.isFinite(data.lat) ||
        Math.abs(data.lat) > 90 ||
        typeof data.lng !== 'number' ||
        !Number.isFinite(data.lng) ||
        Math.abs(data.lng) > 180
      )
        return [];
      const category = typeof data.category === 'string' ? data.category.trim() : '';
      return [
        {
          id: entry.id,
          name: data.name.trim(),
          category: categoryNames[category] ?? (category || '其他'),
          description: typeof data.description === 'string' ? data.description : '',
          lat: data.lat,
          lng: data.lng,
          building: typeof data.building === 'string' ? data.building : undefined,
          floor:
            typeof data.floor === 'string' || typeof data.floor === 'number'
              ? String(data.floor)
              : undefined,
          facilities: Array.isArray(data.facilities)
            ? data.facilities.filter(
                (value): value is string => typeof value === 'string' && Boolean(value.trim()),
              )
            : [],
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

export type MapCoordinate = { lat: number; lng: number };
export type CampusMapPalette = {
  background: string;
  accent: string;
  surface: string;
  text: string;
};

export function buildWalkingDirectionsUrl(
  destination: MapCoordinate,
  origin?: MapCoordinate,
): string {
  const destinationValue = encodeURIComponent(`${destination.lat},${destination.lng}`);
  const originValue = origin ? `&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${destinationValue}&travelmode=walking${originValue}`;
}

export function buildCampusMapHtml(
  palette: CampusMapPalette,
  dark: boolean,
  center: MapCoordinate,
): string {
  // The bridge receives POI names as text, never as executable HTML.
  const colors = JSON.stringify(palette).replace(/</g, '\\u003c');
  const tile = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;margin:0;background:${palette.background}}.leaflet-tooltip{font-family:system-ui;font-size:13px}${dark ? '.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.8) contrast(.85)}' : ''}</style>
</head><body><div id="map" role="img" aria-label="校園地點"></div>
<script>
function send(data){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(data));}
window.onerror=function(){send({type:'error'});};
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="send({type:'error'})"></script>
<script>
if(typeof L!=='undefined'){
var colors=${colors};
var map=L.map('map').setView([${center.lat},${center.lng}],16);
var tileLayer=L.tileLayer('${tile}',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
tileLayer.on('tileerror',function(){send({type:'error'});});
var markers=L.layerGroup().addTo(map),userMarker=null;
document.addEventListener('message',function(event){
 try{
  var data=JSON.parse(event.data);
  if(data.type==='places'){
   markers.clearLayers();
   data.places.forEach(function(place){
    var marker=L.circleMarker([place.lat,place.lng],{radius:place.id===data.selectedId?10:6,color:colors.surface,weight:2,fillColor:colors.accent,fillOpacity:1}).addTo(markers);
    var label=document.createElement('span');label.textContent=place.name;
    marker.bindTooltip(label);
    marker.on('click',function(){send({type:'select',id:place.id});});
   });
  }
  if(data.type==='focus')map.setView([data.lat,data.lng],18);
  if(data.type==='clearLocation'&&userMarker){map.removeLayer(userMarker);userMarker=null;}
  if(data.type==='location'){
   if(userMarker)map.removeLayer(userMarker);
   userMarker=L.circleMarker([data.lat,data.lng],{radius:8,color:colors.surface,weight:3,fillColor:colors.accent,fillOpacity:1}).addTo(map);
   userMarker.bindTooltip('目前位置');map.setView([data.lat,data.lng],17);
  }
 }catch(error){}
});
send({type:'ready'});
}
</script></body></html>`;
}

export function mapPlacesPayload(places: CampusMapPlace[], selectedId: string | null) {
  return {
    type: 'places',
    selectedId,
    places: places.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
  };
}
