import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';
import type { CampusCoordinate } from '@campus/shared/src/campusGeo';
import { parseCampusMapRecord } from '@campus/shared/src/campusMapRecords';

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
      const place = parseCampusMapRecord(entry.id, entry.data(), schoolId);
      return place ? [place] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

export type MapCoordinate = CampusCoordinate;
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
var campusCenter=L.latLng(${center.lat},${center.lng});
var map=L.map('map').setView(campusCenter,16);
var tileLayer=L.tileLayer('${tile}',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
var failedTiles=0;
tileLayer.on('tileerror',function(){if(++failedTiles>=4)send({type:'error'});});
tileLayer.on('tileload',function(){failedTiles=0;});
var markers=L.layerGroup().addTo(map),userMarker=null,routeLine=null;
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
  if(data.type==='clearRoute'&&routeLine){map.removeLayer(routeLine);routeLine=null;}
  if(data.type==='route'){
   if(routeLine){map.removeLayer(routeLine);routeLine=null;}
   var start=data.start,end=data.end;
   if(start&&end&&[start.lat,start.lng,end.lat,end.lng].every(Number.isFinite)){
    routeLine=L.polyline([[start.lat,start.lng],[end.lat,end.lng]],{color:colors.accent,weight:3,opacity:.85,dashArray:'6 9',interactive:false}).addTo(map);
   }
  }
  if(data.type==='focus')map.setView([data.lat,data.lng],18);
  if(data.type==='clearLocation'&&userMarker){map.removeLayer(userMarker);userMarker=null;}
  if(data.type==='location'){
   if(userMarker)map.removeLayer(userMarker);
   userMarker=L.circleMarker([data.lat,data.lng],{radius:8,color:colors.surface,weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(map);
   userMarker.bindTooltip('目前位置');
   if(campusCenter.distanceTo([data.lat,data.lng])<=2000)map.setView([data.lat,data.lng],17);
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
