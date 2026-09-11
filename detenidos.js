const detaineeForm = document.getElementById('detaineeForm');
const crimeList = document.getElementById('crimeList');
const detaineeRecordModal = document.getElementById('detaineeRecordModal');
let selectedDetainee = null;
let editingDetaineeId = null;
let editingDetaineeReason = '';

function detaineeValue(name) {
  const value = new FormData(detaineeForm).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function nullable(value) {
  return value === '' ? null : value;
}

function isDetaineeAdmin() { return currentProfile?.rol === 'administrador'; }
function setDetaineeField(name, value) {
  const field = detaineeForm.elements.namedItem(name);
  if (field) field.value = value ?? '';
}
function detailField(label, value) {
  return `<div class="detail-field"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === null || value === undefined || value === '' ? '—' : String(value))}</strong></div>`;
}
function samePayload(current, next) {
  return Object.keys(next).every(key => String(current?.[key] ?? '') === String(next[key] ?? ''));
}
async function assignAuditReason(table, id, reason) {
  if (!reason || !id) return;
  const { error } = await supabaseClient.rpc('asignar_motivo_auditoria', { p_tabla: table, p_registro_id: String(id), p_motivo: reason });
  if (error) console.warn('No se pudo asociar el motivo de auditoría:', error);
}

function moduleUnavailable(error) {
  return error?.code === '42P01' || /relation .* does not exist|schema cache/i.test(error?.message || '');
}

function addCrimeRow(values = {}) {
  const order = crimeList.children.length + 1;
  const row = document.createElement('article');
  row.className = 'crime-row';
  row.innerHTML = `<div class="crime-row-heading"><strong>Delito ${order}</strong><button type="button" class="remove-crime" aria-label="Quitar delito">×</button></div>
    <div class="grid cols-5">
      <label>Tentativa<select data-field="attempt"><option value="false">No</option><option value="true">Sí</option></select></label>
      <label>Fuero/Ley especial<select data-field="jurisdiction"><option value="">Seleccionar fuero o ley</option></select></label>
      <label>Delito general<select data-field="general" disabled><option value="">Seleccione primero un fuero</option></select></label><label>Delito específico<select data-field="specific" disabled><option value="">Seleccione primero el delito general</option></select></label><label>Subtipo<select data-field="subtype" disabled><option value="">Seleccione primero el delito específico</option></select></label>
    </div>`;
  row.querySelector('[data-field="attempt"]').value = String(values.es_tentativa ?? false);
  window.createCrimeCascade?.(row, values);
  row.querySelector('.remove-crime').addEventListener('click', () => {
    if (crimeList.children.length === 1) return;
    row.remove();
    [...crimeList.children].forEach((item, index) => { item.querySelector('strong').textContent = `Delito ${index + 1}`; });
  });
  crimeList.appendChild(row);
}

function readCrimes() {
  return [...crimeList.querySelectorAll('.crime-row')].map((row, index) => ({
    orden: index + 1,
    es_tentativa: row.querySelector('[data-field="attempt"]').value === 'true',
    fuero_ley_especial: nullable(row.querySelector('[data-field="jurisdiction"]').value.trim()),
    delito_general: nullable(row.querySelector('[data-field="general"]').value.trim()),
    delito_especifico: nullable(row.querySelector('[data-field="specific"]').value.trim()),
    subtipo: nullable(row.querySelector('[data-field="subtype"]').value.trim())
  })).filter(item => item.delito_general || item.delito_especifico || item.subtipo || item.fuero_ley_especial);
}

window.initializeDetaineeForm = function initializeDetaineeForm() {
  if (!crimeList.children.length) addCrimeRow();
};

async function findOrCreatePerson() {
  const documentNumber = detaineeValue('numeroDocumento');
  const documentType = detaineeValue('tipoDocumento');
  if (documentNumber && documentType) {
    const { data, error } = await supabaseClient.from('personas').select('id').eq('tipo_documento', documentType).ilike('numero_documento', documentNumber).maybeSingle();
    if (error) throw error;
    if (data) return { id: data.id, created: false };
  }
  const person = {
    apellido_paterno: detaineeValue('apellidoPaterno'), apellido_materno: nullable(detaineeValue('apellidoMaterno')), nombres: detaineeValue('nombres'),
    edad: nullable(detaineeValue('edad')) ? Number(detaineeValue('edad')) : null, genero: nullable(detaineeValue('genero')), nacionalidad: nullable(detaineeValue('nacionalidad')),
    tipo_documento: nullable(documentType), numero_documento: nullable(documentNumber), departamento: nullable(detaineeValue('departamento')), provincia: nullable(detaineeValue('provincia')), distrito: nullable(detaineeValue('distrito')),
    unidad: currentProfile.unidad, creado_por: currentProfile.id
  };
  const { data, error } = await supabaseClient.from('personas').insert(person).select('id').single();
  if (error) throw error;
  return { id: data.id, created: true };
}

async function saveDetainee(event) {
  event.preventDefault();
  const status = document.getElementById('detaineeStatus');
  const button = document.getElementById('saveDetaineeButton');
  if (!detaineeForm.reportValidity()) return;
  if (!currentProfile) { status.textContent = 'La sesión no está disponible.'; return; }
  button.disabled = true; button.textContent = 'Guardando…'; status.className = '';
  let personResult;
  let detentionId;
  try {
    personResult = editingDetaineeId ? { id: selectedDetainee.persona_id, created: false } : await findOrCreatePerson();
    const belongsToOrganization = detaineeValue('integraOrganizacion') === 'true';
    const organizationRole = belongsToOrganization ? detaineeValue('rolOrganizacion') : '';
    const organizationName = belongsToOrganization ? detaineeValue('nombreOrganizacion') : '';
    const detention = {
      persona_id: personResult.id, fecha: detaineeValue('fecha'), hora: nullable(detaineeValue('hora')),
      es_funcionario_publico: detaineeValue('esFuncionario') === 'true', entidad_publica: nullable(detaineeValue('entidadPublica')), detalle_entidad_publica: nullable(detaineeValue('detalleEntidad')), motivo_detencion: nullable(detaineeValue('motivoDetencion')),
      direccion_policial: nullable(detaineeValue('direccionPolicial')), direccion_especializada_region: nullable(detaineeValue('direccionRegion')), division_policial: nullable(detaineeValue('divisionPolicial')), departamento_policial: nullable(detaineeValue('departamentoPolicial')), unidad_area_equipo: nullable(detaineeValue('unidadArea')),
      integra_organizacion: belongsToOrganization, rol_organizacion: nullable(organizationRole), nombre_organizacion: nullable(organizationName), situacion_actual: nullable(detaineeValue('situacionActual')), documento_libertad: nullable(detaineeValue('documentoLibertad')), documento_disposicion: nullable(detaineeValue('documentoDisposicion')),
      fiscal_nombre: nullable(detaineeValue('fiscalNombre')), fiscalia: nullable(detaineeValue('fiscalia')), disposicion_direccion: nullable(detaineeValue('disposicionDireccion')), disposicion_region: nullable(detaineeValue('disposicionRegion')), disposicion_division: nullable(detaineeValue('disposicionDivision')), disposicion_departamento: nullable(detaineeValue('disposicionDepartamento')), disposicion_unidad: nullable(detaineeValue('disposicionUnidad')), nota_sicpip: nullable(detaineeValue('notaSicpip')),
      unidad: currentProfile.unidad, creado_por: currentProfile.id
    };
    if (editingDetaineeId) {
      const person = {
        apellido_paterno: detaineeValue('apellidoPaterno'), apellido_materno: nullable(detaineeValue('apellidoMaterno')), nombres: detaineeValue('nombres'),
        edad: nullable(detaineeValue('edad')) ? Number(detaineeValue('edad')) : null, genero: nullable(detaineeValue('genero')), nacionalidad: nullable(detaineeValue('nacionalidad')),
        tipo_documento: nullable(detaineeValue('tipoDocumento')), numero_documento: nullable(detaineeValue('numeroDocumento')), departamento: nullable(detaineeValue('departamento')), provincia: nullable(detaineeValue('provincia')), distrito: nullable(detaineeValue('distrito'))
      };
      delete detention.persona_id; delete detention.unidad; delete detention.creado_por;
      if (!samePayload(selectedDetainee.personas, person)) {
        const { error: personError } = await supabaseClient.from('personas').update(person).eq('id', personResult.id);
        if (personError) throw personError;
        await assignAuditReason('personas', personResult.id, editingDetaineeReason);
      }
      if (!samePayload(selectedDetainee, detention)) {
        const { error: detentionError } = await supabaseClient.from('detenciones').update(detention).eq('id', editingDetaineeId);
        if (detentionError) throw detentionError;
        await assignAuditReason('detenciones', editingDetaineeId, editingDetaineeReason);
      }

      const nextCrimes = readCrimes();
      const previousCrimes = selectedDetainee.detencion_delitos || [];
      for (let index = 0; index < nextCrimes.length; index += 1) {
        const previous = previousCrimes[index]; const next = nextCrimes[index];
        if (previous) {
          if (!samePayload(previous, next)) {
            const { error } = await supabaseClient.from('detencion_delitos').update(next).eq('id', previous.id); if (error) throw error;
            await assignAuditReason('detencion_delitos', previous.id, editingDetaineeReason);
          }
        } else { const { error } = await supabaseClient.from('detencion_delitos').insert({ ...next, detencion_id: editingDetaineeId }); if (error) throw error; }
      }
      for (const previous of previousCrimes.slice(nextCrimes.length)) {
        const { error } = await supabaseClient.from('detencion_delitos').delete().eq('id', previous.id); if (error) throw error;
        await assignAuditReason('detencion_delitos', previous.id, editingDetaineeReason);
      }
      const nextWeapon = detaineeValue('armaCategoria') ? { categoria: detaineeValue('armaCategoria'), tipo: nullable(detaineeValue('armaTipo')), cantidad: Number(detaineeValue('armaCantidad') || 1), observacion: nullable(detaineeValue('armaObservacion')) } : null;
      const previousWeapon = selectedDetainee.detencion_armas?.[0];
      if (nextWeapon && previousWeapon && !samePayload(previousWeapon, nextWeapon)) { const { error } = await supabaseClient.from('detencion_armas').update(nextWeapon).eq('id', previousWeapon.id); if (error) throw error; await assignAuditReason('detencion_armas', previousWeapon.id, editingDetaineeReason); }
      else if (nextWeapon && !previousWeapon) { const { error } = await supabaseClient.from('detencion_armas').insert({ ...nextWeapon, detencion_id: editingDetaineeId }); if (error) throw error; }
      else if (!nextWeapon && previousWeapon) { const { error } = await supabaseClient.from('detencion_armas').delete().eq('id', previousWeapon.id); if (error) throw error; await assignAuditReason('detencion_armas', previousWeapon.id, editingDetaineeReason); }
      status.className = 'success-text'; status.textContent = `✓ Detenido ${selectedDetainee.codigo} actualizado correctamente.`;
      editingDetaineeId = null; editingDetaineeReason = ''; selectedDetainee = null;
      detaineeForm.reset(); window.resetDetaineeDependencies?.(); crimeList.innerHTML = ''; addCrimeRow();
      button.textContent = 'Registrar detenido';
      return;
    }
    const { data, error } = await supabaseClient.from('detenciones').insert(detention).select('id,codigo').single();
    if (error) throw error;
    detentionId = data.id;
    const crimes = readCrimes().map(crime => ({ ...crime, detencion_id: detentionId }));
    if (crimes.length) { const { error: crimeError } = await supabaseClient.from('detencion_delitos').insert(crimes); if (crimeError) throw crimeError; }
    const weaponCategory = detaineeValue('armaCategoria');
    if (weaponCategory) {
      const { error: weaponError } = await supabaseClient.from('detencion_armas').insert({ detencion_id: detentionId, categoria: weaponCategory, tipo: nullable(detaineeValue('armaTipo')), cantidad: Number(detaineeValue('armaCantidad') || 1), observacion: nullable(detaineeValue('armaObservacion')) });
      if (weaponError) throw weaponError;
    }
    status.className = 'success-text'; status.textContent = `✓ Detenido registrado correctamente con código ${data.codigo}.`;
    detaineeForm.reset(); window.resetDetaineeDependencies?.(); crimeList.innerHTML = ''; addCrimeRow();
  } catch (error) {
    console.error(error);
    if (detentionId) await supabaseClient.from('detenciones').delete().eq('id', detentionId);
    if (personResult?.created && !detentionId) await supabaseClient.from('personas').delete().eq('id', personResult.id);
    status.className = 'error-text';
    status.textContent = moduleUnavailable(error) ? 'El módulo está diseñado, pero falta ejecutar la migración SQL en Supabase.' : `No se pudo guardar: ${error.message || 'error inesperado'}`;
  } finally { button.disabled = false; button.textContent = 'Registrar detenido'; }
}

window.loadDetaineeRecords = async function loadDetaineeRecords() {
  const result = document.getElementById('detaineeRecordsResult');
  result.innerHTML = '<div class="empty-state"><span>▤</span><h3>Cargando detenidos…</h3></div>';
  let query = supabaseClient.from('detenciones').select('id,codigo,fecha,hora,motivo_detencion,situacion_actual,unidad,personas(apellido_paterno,apellido_materno,nombres,tipo_documento,numero_documento),detencion_delitos(delito_general,delito_especifico)').order('fecha', { ascending: false }).limit(100);
  const from = document.getElementById('detaineeDateFrom').value; const to = document.getElementById('detaineeDateTo').value;
  if (from) query = query.gte('fecha', from); if (to) query = query.lte('fecha', to);
  const { data, error } = await query;
  if (error) { result.innerHTML = `<p class="records-error">${moduleUnavailable(error) ? 'Falta habilitar las tablas del módulo en Supabase.' : 'No se pudieron consultar los detenidos.'}</p>`; return; }
  const search = document.getElementById('detaineeSearch').value.trim().toLocaleLowerCase('es');
  const situation = document.getElementById('detaineeSituation').value.trim().toLocaleLowerCase('es');
  const filtered = data.filter(row => { const p = row.personas || {}; const haystack = [row.codigo,p.apellido_paterno,p.apellido_materno,p.nombres,p.numero_documento].join(' ').toLocaleLowerCase('es'); return (!search || haystack.includes(search)) && (!situation || String(row.situacion_actual || '').toLocaleLowerCase('es').includes(situation)); });
  if (!filtered.length) { result.innerHTML = '<div class="empty-state"><span>⌕</span><h3>No se encontraron detenidos</h3><p>Pruebe con otros filtros.</p></div>'; return; }
  result.innerHTML = `<div class="records-count"><strong>${filtered.length} registro${filtered.length === 1 ? '' : 's'}</strong><span>Máximo 100 resultados</span></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Persona</th><th>Documento</th><th>Fecha</th><th>Delito</th><th>Situación</th><th>Unidad</th></tr></thead><tbody>${filtered.map(row => { const p=row.personas||{}; const crime=row.detencion_delitos?.[0]||{}; return `<tr class="detainee-record-row" data-detainee-id="${escapeHtml(row.id)}" tabindex="0"><td><span class="record-code">${escapeHtml(row.codigo)}</span></td><td><span class="record-name">${escapeHtml(`${p.apellido_paterno||''} ${p.apellido_materno||''}, ${p.nombres||''}`)}</span></td><td>${escapeHtml(p.tipo_documento||'—')} ${escapeHtml(p.numero_documento||'')}</td><td>${escapeHtml(formatDate(row.fecha))}</td><td>${escapeHtml(crime.delito_especifico||crime.delito_general||'—')}</td><td>${escapeHtml(row.situacion_actual||'—')}</td><td>${escapeHtml(row.unidad)}</td></tr>`; }).join('')}</tbody></table></div>`;
  result.querySelectorAll('[data-detainee-id]').forEach(row => { const open = () => openDetaineeRecord(row.dataset.detaineeId); row.addEventListener('click', open); row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); }); });
};

async function openDetaineeRecord(id) {
  document.getElementById('detaineeRecordDetail').innerHTML = '<div class="empty-state"><h3>Cargando detalle…</h3></div>';
  detaineeRecordModal.showModal();
  const { data, error } = await supabaseClient.from('detenciones').select('*,personas(*),detencion_delitos(*),detencion_armas(*)').eq('id', id).single();
  if (error) { document.getElementById('detaineeRecordDetail').innerHTML = '<p class="records-error">No se pudo cargar el registro.</p>'; return; }
  selectedDetainee = data; const p = data.personas || {};
  document.getElementById('detaineeRecordModalCode').textContent = data.codigo || 'Registro de detenido';
  const crimes = (data.detencion_delitos || []).sort((a,b) => a.orden-b.orden).map((crime,index) => detailField(`Delito ${index+1}`, [crime.es_tentativa?'Tentativa':null,crime.fuero_ley_especial,crime.delito_general,crime.delito_especifico,crime.subtipo].filter(Boolean).join(' · '))).join('');
  const weapons = (data.detencion_armas || []).map(weapon => detailField('Arma o hallazgo', [weapon.categoria,weapon.tipo,`Cantidad: ${weapon.cantidad||1}`,weapon.observacion].filter(Boolean).join(' · '))).join('');
  document.getElementById('detaineeRecordDetail').innerHTML = `<div class="detail-section">Identificación</div>${detailField('Apellidos y nombres',`${p.apellido_paterno||''} ${p.apellido_materno||''}, ${p.nombres||''}`)}${detailField('Documento',[p.tipo_documento,p.numero_documento].filter(Boolean).join(' '))}${detailField('Edad / género',[p.edad,p.genero].filter(Boolean).join(' · '))}${detailField('Nacionalidad',p.nacionalidad)}${detailField('Ubicación',[p.departamento,p.provincia,p.distrito].filter(Boolean).join(' / '))}<div class="detail-section">Detención</div>${detailField('Fecha y hora',[formatDate(data.fecha),data.hora].filter(Boolean).join(' · '))}${detailField('Motivo',data.motivo_detencion)}${detailField('Situación actual',data.situacion_actual)}${detailField('Funcionario público',data.es_funcionario_publico?'Sí':'No')}${detailField('Entidad pública',[data.entidad_publica,data.detalle_entidad_publica].filter(Boolean).join(' · '))}<div class="detail-section">Delitos atribuidos</div>${crimes||detailField('Delitos','No registrados')}<div class="detail-section">Unidad, organización y hallazgos</div>${detailField('Dependencia',[data.direccion_policial,data.direccion_especializada_region,data.division_policial,data.departamento_policial,data.unidad_area_equipo].filter(Boolean).join(' / '))}${detailField('Banda u organización',data.integra_organizacion?[data.rol_organizacion,data.nombre_organizacion].filter(Boolean).join(' · '):'No')}${weapons||detailField('Armas o hallazgos','Ninguno')}<div class="detail-section">Puesta a disposición</div>${detailField('Documentos',[data.documento_libertad,data.documento_disposicion].filter(Boolean).join(' · '))}${detailField('Fiscal / Fiscalía',[data.fiscal_nombre,data.fiscalia].filter(Boolean).join(' · '))}${detailField('Dependencia receptora',[data.disposicion_direccion,data.disposicion_region,data.disposicion_division,data.disposicion_departamento,data.disposicion_unidad].filter(Boolean).join(' / '))}${detailField('Nota SICPIP',data.nota_sicpip)}`;
  document.getElementById('editDetaineeButton').classList.toggle('hidden-control', !isDetaineeAdmin());
  document.getElementById('deleteDetaineeButton').classList.toggle('hidden-control', !isDetaineeAdmin());
}

function beginDetaineeEdit() {
  if (!selectedDetainee || !isDetaineeAdmin()) return;
  const reason = prompt('Indique el motivo de la modificación. Este texto quedará guardado en Auditoría:');
  if (!reason?.trim()) return alert('El motivo es obligatorio para editar un detenido.');
  editingDetaineeId = selectedDetainee.id; editingDetaineeReason = reason.trim(); const p = selectedDetainee.personas || {}; const weapon = selectedDetainee.detencion_armas?.[0] || {};
  const values = { apellidoPaterno:p.apellido_paterno,apellidoMaterno:p.apellido_materno,nombres:p.nombres,edad:p.edad,genero:p.genero,nacionalidad:p.nacionalidad,tipoDocumento:p.tipo_documento,numeroDocumento:p.numero_documento,fecha:selectedDetainee.fecha,hora:selectedDetainee.hora,motivoDetencion:selectedDetainee.motivo_detencion,esFuncionario:String(Boolean(selectedDetainee.es_funcionario_publico)),entidadPublica:selectedDetainee.entidad_publica,detalleEntidad:selectedDetainee.detalle_entidad_publica,direccionPolicial:selectedDetainee.direccion_policial,direccionRegion:selectedDetainee.direccion_especializada_region,divisionPolicial:selectedDetainee.division_policial,departamentoPolicial:selectedDetainee.departamento_policial,unidadArea:selectedDetainee.unidad_area_equipo,integraOrganizacion:String(Boolean(selectedDetainee.integra_organizacion)),rolOrganizacion:selectedDetainee.rol_organizacion,nombreOrganizacion:selectedDetainee.nombre_organizacion,armaCategoria:weapon.categoria,armaTipo:weapon.tipo,armaCantidad:weapon.cantidad||1,armaObservacion:weapon.observacion,situacionActual:selectedDetainee.situacion_actual,documentoLibertad:selectedDetainee.documento_libertad,documentoDisposicion:selectedDetainee.documento_disposicion,fiscalNombre:selectedDetainee.fiscal_nombre,fiscalia:selectedDetainee.fiscalia,disposicionDireccion:selectedDetainee.disposicion_direccion,disposicionRegion:selectedDetainee.disposicion_region,disposicionDivision:selectedDetainee.disposicion_division,disposicionDepartamento:selectedDetainee.disposicion_departamento,disposicionUnidad:selectedDetainee.disposicion_unidad,notaSicpip:selectedDetainee.nota_sicpip};
  Object.entries(values).forEach(([name,value]) => setDetaineeField(name,value));
  window.setDetaineeDependencies?.({ departamento:p.departamento,provincia:p.provincia,distrito:p.distrito,direccion_policial:selectedDetainee.direccion_policial,direccion_especializada_region:selectedDetainee.direccion_especializada_region,division_policial:selectedDetainee.division_policial,departamento_policial:selectedDetainee.departamento_policial,integra_organizacion:selectedDetainee.integra_organizacion,rol_organizacion:selectedDetainee.rol_organizacion,nombre_organizacion:selectedDetainee.nombre_organizacion,arma_categoria:weapon.categoria,arma_tipo:weapon.tipo });
  crimeList.innerHTML=''; (selectedDetainee.detencion_delitos?.length ? selectedDetainee.detencion_delitos.sort((a,b)=>a.orden-b.orden) : [{}]).forEach(addCrimeRow);
  document.getElementById('saveDetaineeButton').textContent='Guardar cambios'; document.getElementById('detaineeStatus').textContent=`Editando ${selectedDetainee.codigo}. El motivo quedará registrado en Auditoría.`;
  detaineeRecordModal.close(); document.querySelector('[data-view="detaineeFormView"]')?.click(); window.scrollTo({top:0,behavior:'smooth'});
}

async function deleteDetainee() {
  if (!selectedDetainee || !isDetaineeAdmin()) return;
  const reason = prompt('Indique el motivo de la eliminación. Este texto quedará guardado en Auditoría:');
  if (!reason?.trim()) return alert('El motivo es obligatorio para eliminar un detenido.');
  if (!confirm(`¿Eliminar el registro ${selectedDetainee.codigo}? Esta acción no se puede deshacer.`)) return;
  const record = selectedDetainee;
  for (const child of record.detencion_delitos || []) { const { error } = await supabaseClient.from('detencion_delitos').delete().eq('id',child.id); if (error) return alert(`No se pudo eliminar: ${error.message}`); await assignAuditReason('detencion_delitos',child.id,reason.trim()); }
  for (const child of record.detencion_armas || []) { const { error } = await supabaseClient.from('detencion_armas').delete().eq('id',child.id); if (error) return alert(`No se pudo eliminar: ${error.message}`); await assignAuditReason('detencion_armas',child.id,reason.trim()); }
  const { error } = await supabaseClient.from('detenciones').delete().eq('id',record.id); if (error) return alert(`No se pudo eliminar: ${error.message}`);
  await assignAuditReason('detenciones',record.id,reason.trim()); detaineeRecordModal.close(); selectedDetainee=null; await window.loadDetaineeRecords();
}

window.loadDetaineeDashboard = async function loadDetaineeDashboard() {
  const status = document.getElementById('detaineeDashboardStatus');
  status.textContent = 'Consultando información…'; status.classList.add('visible');
  let query = supabaseClient.from('detenciones').select('id,persona_id,fecha,motivo_detencion,situacion_actual,personas(nacionalidad,genero,departamento,provincia,distrito),detencion_delitos(delito_general)');
  const from = document.getElementById('detaineeDashboardFrom').value;
  const to = document.getElementById('detaineeDashboardTo').value;
  if (from) query = query.gte('fecha', from);
  if (to) query = query.lte('fecha', to);
  const { data, error } = await query;
  if (error) { status.textContent = 'No se pudo cargar el dashboard de detenidos.'; return; }
  const records = data || [];
  const now = new Date();
  const currentMonth = records.filter(item => { const date = new Date(`${item.fecha}T00:00:00`); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }).length;
  document.getElementById('detaineeDashboardTotal').textContent = records.length.toLocaleString('es-PE');
  document.getElementById('detaineeDashboardPeople').textContent = new Set(records.map(item => item.persona_id)).size.toLocaleString('es-PE');
  document.getElementById('detaineeDashboardFlagrancy').textContent = records.filter(item => /flagrancia/i.test(item.motivo_detencion || '')).length.toLocaleString('es-PE');
  document.getElementById('detaineeDashboardMonth').textContent = currentMonth.toLocaleString('es-PE');
  const count = selector => records.reduce((result, item) => { const values = selector(item); for (const value of (Array.isArray(values) ? values : [values])) { const key = dashboardCategory(value); result[key] = (result[key] || 0) + 1; } return result; }, {});
  const renderCounts = (id, counts) => renderBarChart(id, counts);
  renderCounts('detaineeNationalityChart', count(item => item.personas?.nacionalidad));
  renderCounts('detaineeSituationChart', count(item => item.situacion_actual));
  renderCounts('detaineeGenderChart', count(item => item.personas?.genero));
  renderCounts('detaineeCrimeChart', count(item => item.detencion_delitos?.length ? item.detencion_delitos.map(crime => crime.delito_general) : [null]));
  window.renderCrimeMap?.('detaineeCrimeMap', records.map(item => ({ department:item.personas?.departamento, province:item.personas?.provincia, district:item.personas?.distrito })), 'detenciones');
  status.textContent = `${records.length.toLocaleString('es-PE')} detención${records.length === 1 ? '' : 'es'} en el periodo seleccionado.`;
};

document.getElementById('addCrimeButton').addEventListener('click', () => addCrimeRow());
document.getElementById('clearDetaineeButton').addEventListener('click', () => { editingDetaineeId=null; editingDetaineeReason=''; selectedDetainee=null; detaineeForm.reset(); window.resetDetaineeDependencies?.(); crimeList.innerHTML=''; addCrimeRow(); document.getElementById('saveDetaineeButton').textContent='Registrar detenido'; document.getElementById('detaineeStatus').textContent='Formulario limpio.'; });
document.getElementById('searchDetaineesButton').addEventListener('click', window.loadDetaineeRecords);
document.getElementById('refreshDetaineeDashboard').addEventListener('click', window.loadDetaineeDashboard);
document.getElementById('applyDetaineeDashboard').addEventListener('click', window.loadDetaineeDashboard);
document.getElementById('closeDetaineeRecordModal').addEventListener('click', () => detaineeRecordModal.close());
document.getElementById('closeDetaineeButton').addEventListener('click', () => detaineeRecordModal.close());
document.getElementById('editDetaineeButton').addEventListener('click', beginDetaineeEdit);
document.getElementById('deleteDetaineeButton').addEventListener('click', deleteDetainee);
detaineeForm.addEventListener('submit', saveDetainee);
window.initializeDetaineeForm();
