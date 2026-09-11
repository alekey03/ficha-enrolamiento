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
    const map=L.map(id,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:12,zoomSnap:.25}).setView([-9.2,-75.1],5);
    const instance={map,layer:null,records:[],level:'department',department:null,province:null,label:'casos',animating:false}; instances.set(id,instance); return instance;
  }
  function summary(id, instance, shown, located) {
    const element=document.querySelector(`[data-map-summary="${id}"]`); const place=instance.province?.name||instance.department?.name||'Perú';
    if (element) element.innerHTML=`<strong>${title(place)}</strong><span>${shown.toLocaleString('es-PE')} ${instance.label}</span><small>${located.toLocaleString('es-PE')} con ubicación reconocida en este nivel.</small>`;
    const back=document.querySelector(`[data-map-back="${id}"]`); if(back){back.hidden=instance.level==='department';back.textContent=instance.level==='district'?`← Volver a ${title(instance.department?.name)}`:'← Volver al Perú';}
  }
  function enterZone(id, instance, layer, info) {
    if(instance.animating)return;
    if(instance.level==='district'){layer.openTooltip();return;}
    instance.animating=true; layer.closeTooltip(); layer.setStyle({weight:4,color:'#075c39',fillOpacity:1});
    instance.map.flyToBounds(layer.getBounds(),{padding:[55,55],duration:.55,maxZoom:instance.level==='department'?7:10});
    setTimeout(()=>{if(instance.level==='department'){instance.department=info;instance.level='province';}else{instance.province=info;instance.level='district';}draw(id).finally(()=>{instance.animating=false;});},430);
  }
  async function draw(id) {
    const instance=ensure(id); const source=await dataset(instance.level); let features=source.features||[];
    if(instance.level==='province') features=features.filter(feature=>featureInfo('province',feature).parent===instance.department.code);
    if(instance.level==='district') features=features.filter(feature=>featureInfo('district',feature).parent===instance.province.code);
    const relevant=instance.records.filter(record=>instance.level==='department'||(normalize(record.department)===normalize(instance.department.name)&&(instance.level==='province'||normalize(record.province)===normalize(instance.province.name))));
    const totals=counts(relevant,instance.level); const maximum=Math.max(0,...Object.values(totals)); if(instance.layer) instance.layer.remove();
    instance.map.invalidateSize({pan:false});
    instance.layer=L.geoJSON({type:'FeatureCollection',features},{style:feature=>({color:'#b88718',weight:1.25,fillColor:color(totals[featureKey(feature,instance.level)]||0,maximum),fillOpacity:.9}),onEachFeature:(feature,layer)=>{
      const info=featureInfo(instance.level,feature); const amount=totals[featureKey(feature,instance.level)]||0;
      layer.bindTooltip(`<span>${instance.level==='department'?'Departamento':instance.level==='province'?'Provincia':'Distrito'}</span><strong>${title(info.name)}</strong><b>${amount.toLocaleString('es-PE')} ${instance.label}</b>`,{sticky:true,className:'crime-map-tooltip',opacity:1,direction:'top',offset:[0,-10]});
      layer.once('add',()=>{
        const shape=layer.getElement(); if(!shape)return; shape.style.pointerEvents='auto'; shape.style.cursor='pointer';
        const position=event=>instance.map.mouseEventToLatLng(event);
        shape.addEventListener('pointerenter',event=>{layer.setStyle({weight:3,color:'#0f7048',fillOpacity:1});layer.bringToFront();layer.openTooltip(position(event));});
        shape.addEventListener('pointermove',event=>layer.getTooltip()?.setLatLng(position(event)));
        shape.addEventListener('pointerleave',()=>{instance.layer?.resetStyle(layer);layer.closeTooltip();});
        shape.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();enterZone(id,instance,layer,info);});
      });
    }}).addTo(instance.map); summary(id,instance,relevant.length,Object.values(totals).reduce((sum,value)=>sum+value,0));
    if(features.length){const bounds=instance.layer.getBounds();instance.map.setMaxBounds(null);instance.map.setMaxBounds(bounds.pad(.35));setTimeout(()=>{instance.map.invalidateSize({pan:false});instance.map.fitBounds(bounds,{padding:[24,24],animate:true,duration:.55});},80);}
  }
  window.renderCrimeMap=async(id,records,label='casos')=>{if(!window.L||!document.getElementById(id))return;const instance=ensure(id);instance.records=records||[];instance.label=label;try{await draw(id);}catch(error){console.error(error);document.getElementById(id).innerHTML='<div class="map-error">No se pudo cargar el mapa.</div>';}};
  document.addEventListener('click',event=>{const button=event.target.closest('[data-map-back]');if(!button)return;const instance=instances.get(button.dataset.mapBack);if(!instance)return;if(instance.level==='district'){instance.level='province';instance.province=null;}else{instance.level='department';instance.department=null;}draw(button.dataset.mapBack);});
}());
