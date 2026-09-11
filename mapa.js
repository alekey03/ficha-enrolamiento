(function initializeCrimeMaps() {
  const urls = { department:'assets/maps/departamentos.geojson', province:'assets/maps/provincias.geojson', district:'assets/maps/distritos.geojson' };
  const cache = {}; const instances = new Map();
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const title = value => String(value || '').toLocaleLowerCase('es-PE').replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase('es-PE'));
  const color = (value, maximum) => !value ? '#e7edf2' : value / Math.max(maximum, 1) > .75 ? '#b42318' : value / maximum > .5 ? '#ef5b3f' : value / maximum > .25 ? '#f6a95f' : '#f8d88a';
  async function dataset(level) {
    if (!cache[level]) cache[level] = fetch(urls[level]).then(response => { if (!response.ok) throw new Error('No se pudo cargar el mapa.'); return response.json(); });
    return cache[level];
  }
  function featureInfo(level, feature) {
    const p = feature.properties || {};
    if (level === 'department') return { code:String(p.FIRST_IDDP || ''), name:p.NOMBDEP };
    if (level === 'province') return { code:String(p.FIRST_IDPR || ''), parent:String(p.FIRST_IDPR || '').slice(0,2), name:p.NOMBPROV };
    return { code:String(p.IDDIST || ''), parent:String(p.IDPROV || ''), department:String(p.IDDPTO || ''), name:p.NOMBDIST };
  }
  const recordKey = (record, level) => level === 'department' ? normalize(record.department) : level === 'province' ? `${normalize(record.department)}|${normalize(record.province)}` : `${normalize(record.department)}|${normalize(record.province)}|${normalize(record.district)}`;
  function featureKey(feature, level) {
    const p = feature.properties || {};
    return level === 'department' ? normalize(p.NOMBDEP) : level === 'province' ? `${normalize(p.FIRST_NOMB)}|${normalize(p.NOMBPROV)}` : `${normalize(p.NOMBDEP)}|${normalize(p.NOMBPROV)}|${normalize(p.NOMBDIST)}`;
  }
  function counts(records, level) { return records.reduce((result, record) => { const key=recordKey(record,level); if (key && !key.startsWith('|')) result[key]=(result[key]||0)+1; return result; },{}); }
  function ensure(id) {
    if (instances.has(id)) return instances.get(id);
    const map=L.map(id,{zoomControl:true}).setView([-9.2,-75.1],5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(map);
    const instance={map,layer:null,records:[],level:'department',department:null,province:null,label:'casos'}; instances.set(id,instance); return instance;
  }
  function summary(id, instance, shown, located) {
    const element=document.querySelector(`[data-map-summary="${id}"]`); const place=instance.province?.name||instance.department?.name||'Perú';
    if (element) element.innerHTML=`<strong>${title(place)}</strong><span>${shown.toLocaleString('es-PE')} ${instance.label}</span><small>${located.toLocaleString('es-PE')} con ubicación reconocida en este nivel.</small>`;
    const back=document.querySelector(`[data-map-back="${id}"]`); if(back){back.hidden=instance.level==='department';back.textContent=instance.level==='district'?`← Volver a ${title(instance.department?.name)}`:'← Volver al Perú';}
  }
  async function draw(id) {
    const instance=ensure(id); const source=await dataset(instance.level); let features=source.features||[];
    if(instance.level==='province') features=features.filter(feature=>featureInfo('province',feature).parent===instance.department.code);
    if(instance.level==='district') features=features.filter(feature=>featureInfo('district',feature).parent===instance.province.code);
    const relevant=instance.records.filter(record=>instance.level==='department'||(normalize(record.department)===normalize(instance.department.name)&&(instance.level==='province'||normalize(record.province)===normalize(instance.province.name))));
    const totals=counts(relevant,instance.level); const maximum=Math.max(0,...Object.values(totals)); if(instance.layer) instance.layer.remove();
    instance.layer=L.geoJSON({type:'FeatureCollection',features},{style:feature=>({color:'#a87916',weight:1.2,fillColor:color(totals[featureKey(feature,instance.level)]||0,maximum),fillOpacity:.82}),onEachFeature:(feature,layer)=>{
      const info=featureInfo(instance.level,feature); const amount=totals[featureKey(feature,instance.level)]||0; layer.bindTooltip(`<strong>${title(info.name)}</strong><br>${amount} ${instance.label}`,{sticky:true});
      layer.on({mouseover:()=>layer.setStyle({weight:2.5,color:'#155c3d'}),mouseout:()=>instance.layer.resetStyle(layer),click:()=>{if(instance.level==='department'){instance.department=info;instance.level='province';draw(id);}else if(instance.level==='province'){instance.province=info;instance.level='district';draw(id);}else layer.openTooltip();}});
    }}).addTo(instance.map); if(features.length) instance.map.fitBounds(instance.layer.getBounds(),{padding:[18,18]}); summary(id,instance,relevant.length,Object.values(totals).reduce((sum,value)=>sum+value,0)); setTimeout(()=>instance.map.invalidateSize(),0);
  }
  window.renderCrimeMap=async(id,records,label='casos')=>{if(!window.L||!document.getElementById(id))return;const instance=ensure(id);instance.records=records||[];instance.label=label;try{await draw(id);}catch(error){console.error(error);document.getElementById(id).innerHTML='<div class="map-error">No se pudo cargar el mapa.</div>';}};
  document.addEventListener('click',event=>{const button=event.target.closest('[data-map-back]');if(!button)return;const instance=instances.get(button.dataset.mapBack);if(!instance)return;if(instance.level==='district'){instance.level='province';instance.province=null;}else{instance.level='department';instance.department=null;}draw(button.dataset.mapBack);});
}());
