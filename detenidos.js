const detaineeForm = document.getElementById('detaineeForm');
const crimeList = document.getElementById('crimeList');

function detaineeValue(name) {
  const value = new FormData(detaineeForm).get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function nullable(value) {
  return value === '' ? null : value;
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
      <label>Fuero/Ley especial<select data-field="jurisdiction"><option value="">Seleccionar</option><option>Fuero común</option><option>Leyes especiales</option></select></label>
      <label>Delito general<input data-field="general"></label><label>Delito específico<input data-field="specific"></label><label>Subtipo<input data-field="subtype"></label>
    </div>`;
  row.querySelector('[data-field="attempt"]').value = String(values.es_tentativa ?? false);
  row.querySelector('[data-field="jurisdiction"]').value = values.fuero_ley_especial || '';
  row.querySelector('[data-field="general"]').value = values.delito_general || '';
  row.querySelector('[data-field="specific"]').value = values.delito_especifico || '';
  row.querySelector('[data-field="subtype"]').value = values.subtipo || '';
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
    personResult = await findOrCreatePerson();
    const detention = {
      persona_id: personResult.id, fecha: detaineeValue('fecha'), hora: nullable(detaineeValue('hora')),
      es_funcionario_publico: detaineeValue('esFuncionario') === 'true', entidad_publica: nullable(detaineeValue('entidadPublica')), detalle_entidad_publica: nullable(detaineeValue('detalleEntidad')), motivo_detencion: nullable(detaineeValue('motivoDetencion')),
      direccion_policial: nullable(detaineeValue('direccionPolicial')), direccion_especializada_region: nullable(detaineeValue('direccionRegion')), division_policial: nullable(detaineeValue('divisionPolicial')), departamento_policial: nullable(detaineeValue('departamentoPolicial')), unidad_area_equipo: nullable(detaineeValue('unidadArea')),
      integra_organizacion: detaineeValue('integraOrganizacion') === 'true', nombre_organizacion: nullable(detaineeValue('nombreOrganizacion')), situacion_actual: nullable(detaineeValue('situacionActual')), documento_libertad: nullable(detaineeValue('documentoLibertad')), documento_disposicion: nullable(detaineeValue('documentoDisposicion')),
      fiscal_nombre: nullable(detaineeValue('fiscalNombre')), fiscalia: nullable(detaineeValue('fiscalia')), disposicion_direccion: nullable(detaineeValue('disposicionDireccion')), disposicion_region: nullable(detaineeValue('disposicionRegion')), disposicion_division: nullable(detaineeValue('disposicionDivision')), disposicion_departamento: nullable(detaineeValue('disposicionDepartamento')), disposicion_unidad: nullable(detaineeValue('disposicionUnidad')), nota_sicpip: nullable(detaineeValue('notaSicpip')),
      unidad: currentProfile.unidad, creado_por: currentProfile.id
    };
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
    detaineeForm.reset(); crimeList.innerHTML = ''; addCrimeRow();
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
  result.innerHTML = `<div class="records-count"><strong>${filtered.length} registro${filtered.length === 1 ? '' : 's'}</strong><span>Máximo 100 resultados</span></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Persona</th><th>Documento</th><th>Fecha</th><th>Delito</th><th>Situación</th><th>Unidad</th></tr></thead><tbody>${filtered.map(row => { const p=row.personas||{}; const crime=row.detencion_delitos?.[0]||{}; return `<tr><td><span class="record-code">${escapeHtml(row.codigo)}</span></td><td><span class="record-name">${escapeHtml(`${p.apellido_paterno||''} ${p.apellido_materno||''}, ${p.nombres||''}`)}</span></td><td>${escapeHtml(p.tipo_documento||'—')} ${escapeHtml(p.numero_documento||'')}</td><td>${escapeHtml(formatDate(row.fecha))}</td><td>${escapeHtml(crime.delito_especifico||crime.delito_general||'—')}</td><td>${escapeHtml(row.situacion_actual||'—')}</td><td>${escapeHtml(row.unidad)}</td></tr>`; }).join('')}</tbody></table></div>`;
};

window.loadDetaineeDashboard = async function loadDetaineeDashboard() {
  const status = document.getElementById('detaineeDashboardStatus');
  status.textContent = 'Consultando información…'; status.classList.add('visible');
  let query = supabaseClient.from('detenciones').select('id,persona_id,fecha,motivo_detencion,situacion_actual,personas(nacionalidad,genero),detencion_delitos(delito_general)');
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
  status.textContent = `${records.length.toLocaleString('es-PE')} detención${records.length === 1 ? '' : 'es'} en el periodo seleccionado.`;
};

document.getElementById('addCrimeButton').addEventListener('click', () => addCrimeRow());
document.getElementById('clearDetaineeButton').addEventListener('click', () => { detaineeForm.reset(); crimeList.innerHTML=''; addCrimeRow(); document.getElementById('detaineeStatus').textContent='Formulario limpio.'; });
document.getElementById('searchDetaineesButton').addEventListener('click', window.loadDetaineeRecords);
document.getElementById('refreshDetaineeDashboard').addEventListener('click', window.loadDetaineeDashboard);
document.getElementById('applyDetaineeDashboard').addEventListener('click', window.loadDetaineeDashboard);
detaineeForm.addEventListener('submit', saveDetainee);
window.initializeDetaineeForm();
