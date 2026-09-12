function excelSafe(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'boolean') return value ? 'SÍ' : 'NO';
  if (typeof value === 'number') return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function excelDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function excelDateTime(value) {
  if (!value) return '';
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(source);
  const datePart = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return new Date(datePart.year, datePart.month - 1, datePart.day, datePart.hour, datePart.minute, datePart.second);
}

async function fetchAllRows(table, select, configure = query => query) {
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    let query = supabaseClient.from(table).select(select).range(start, start + pageSize - 1);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function downloadWorkbook(rows, sheetName, filePrefix) {
  if (!window.XLSX) throw new Error('No se pudo cargar el generador de Excel. Revise su conexión.');
  const sanitized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, excelSafe(value)])));
  const sheet = XLSX.utils.json_to_sheet(sanitized, { cellDates: true });
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r, c: range.e.c } }) };
  const headers = Object.keys(sanitized[0] || {});
  headers.forEach((header, column) => {
    const dateFormat = ['Fecha de registro', 'Última actualización'].includes(header)
      ? 'dd/mm/yyyy hh:mm:ss'
      : (header === 'Fecha' || header.startsWith('Fecha de ')) ? 'dd/mm/yyyy' : '';
    if (!dateFormat) return;
    for (let row = 1; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && (cell.t === 'd' || cell.t === 'n')) cell.z = dateFormat;
    }
  });
  sheet['!cols'] = headers.map(header => {
    const longest = Math.max(header.length, ...sanitized.slice(0, 300).map(row => String(row[header] ?? '').length));
    return { wch: Math.min(Math.max(longest + 2, 12), 42) };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filePrefix}_${date}.xlsx`, { compression: true });
}

async function withExportButton(button, work) {
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Preparando Excel…';
  try { await work(); }
  catch (error) { console.error(error); alert(`No se pudo exportar el Excel: ${error.message || 'error inesperado'}`); }
  finally { button.disabled = false; button.textContent = original; }
}

async function exportVictimsExcel() {
  const button = document.getElementById('exportVictimsExcel');
  await withExportButton(button, async () => {
    const from = document.getElementById('recordDateFrom').value;
    const to = document.getElementById('recordDateTo').value;
    const records = await fetchAllRows('fichas', '*', query => {
      if (from) query = query.gte('fecha_intervencion', from);
      if (to) query = query.lte('fecha_intervencion', to);
      return query.order('creado_en', { ascending: false });
    });
    const search = document.getElementById('recordSearch').value.trim().toLocaleLowerCase('es');
    const nationality = document.getElementById('recordNationality').value;
    const documentType = document.getElementById('recordDocumentType').value;
    const unit = document.getElementById('recordUnit').value.trim().toLocaleLowerCase('es');
    const minimumAge = document.getElementById('recordAgeMin').value;
    const maximumAge = document.getElementById('recordAgeMax').value;
    const filtered = records.filter(record => (!search || [record.codigo,record.apellido_paterno,record.apellido_materno,record.nombres,record.numero_documento].some(value => String(value ?? '').toLocaleLowerCase('es').includes(search)))
      && (!nationality || dashboardCategory(record.nacionalidad) === nationality)
      && (!documentType || record.tipo_documento === documentType)
      && (!unit || String(record.unidad || '').toLocaleLowerCase('es').includes(unit))
      && (minimumAge === '' || (recordAge(record) !== null && recordAge(record) >= Number(minimumAge)))
      && (maximumAge === '' || (recordAge(record) !== null && recordAge(record) <= Number(maximumAge))));
    if (!filtered.length) throw new Error('No existen registros con los filtros actuales.');
    const rows = filtered.map((r, index) => ({
      'N°': index + 1, 'Código': r.codigo, 'Apellido paterno': r.apellido_paterno, 'Apellido materno': r.apellido_materno, 'Nombres': r.nombres,
      'Fecha de nacimiento': excelDate(r.fecha_nacimiento), 'Edad': r.edad_registro, 'Estado civil': r.estado_civil, 'Nombre de la madre': r.nombre_madre, 'Nombre del padre': r.nombre_padre,
      'Nacionalidad': r.nacionalidad, 'Ocupación': r.ocupacion, 'Grado de instrucción': r.grado_instruccion, 'Teléfono': r.telefono, 'Domicilio': r.domicilio, 'Correo electrónico': r.correo, 'Redes sociales': r.redes_sociales,
      'Estatura': r.estatura, 'Cabello': r.cabello, 'Color de cabello': r.color_cabello, 'Características físicas': r.caracteristicas_fisicas, 'Cicatrices o tatuajes': r.cicatrices_tatuajes,
      'Tipo de documento': r.tipo_documento, 'Número de documento': r.numero_documento, 'Motivo de intervención': r.motivo_intervencion, 'Fecha de intervención': excelDate(r.fecha_intervencion), 'Lugar de intervención': r.lugar_intervencion,
      'Departamento registrador': r.departamento_registro, 'Área registradora': r.unidad, 'Grado del responsable': r.responsable_grado, 'Apellidos del responsable': r.responsable_apellidos, 'Nombres del responsable': r.responsable_nombres, 'Fecha de registro': excelDateTime(r.creado_en), 'Última actualización': excelDateTime(r.actualizado_en)
    }));
    downloadWorkbook(rows, 'Victimas', `victimas_${currentProfile?.unidad || 'unidad'}`);
  });
}

async function exportDetaineesExcel() {
  const button = document.getElementById('exportDetaineesExcel');
  await withExportButton(button, async () => {
    const from = document.getElementById('detaineeDateFrom').value;
    const to = document.getElementById('detaineeDateTo').value;
    const records = await fetchAllRows('detenciones', '*,personas(*),detencion_delitos(*),detencion_armas(*)', query => {
      if (from) query = query.gte('fecha', from);
      if (to) query = query.lte('fecha', to);
      return query.order('fecha', { ascending: false });
    });
    const search = document.getElementById('detaineeSearch').value.trim().toLocaleLowerCase('es');
    const situation = document.getElementById('detaineeSituation').value.trim().toLocaleLowerCase('es');
    const filtered = records.filter(r => { const p=r.personas||{}; return (!search || [r.codigo,p.apellido_paterno,p.apellido_materno,p.nombres,p.numero_documento].join(' ').toLocaleLowerCase('es').includes(search)) && (!situation || String(r.situacion_actual||'').toLocaleLowerCase('es').includes(situation)); });
    if (!filtered.length) throw new Error('No existen registros con los filtros actuales.');
    const rows = filtered.map((r, index) => {
      const p = r.personas || {}; const crimes = [...(r.detencion_delitos || [])].sort((a,b) => a.orden-b.orden); const c1=crimes[0]||{}; const c2=crimes[1]||{}; const weapon=(r.detencion_armas||[])[0]||{};
      return {
        'N°': index + 1, 'Código': r.codigo, 'Mes': r.fecha ? Number(r.fecha.slice(5,7)) : '', 'Fecha': excelDate(r.fecha), 'Hora detención': r.hora,
        'Apellido paterno': p.apellido_paterno, 'Apellido materno': p.apellido_materno, 'Nombres': p.nombres, 'Edad': p.edad, 'Género': p.genero, 'Nacionalidad (país)': p.nacionalidad, 'Tipo documento de identidad': p.tipo_documento, 'N° documento de identidad': p.numero_documento,
        'Departamento': p.departamento, 'Provincia': p.provincia, 'Distrito': p.distrito, 'Funcionario/servidor público': r.es_funcionario_publico, 'Entidad pública': r.entidad_publica, 'Detalle entidad pública': r.detalle_entidad_publica, 'Motivo de la detención': r.motivo_detencion,
        'Delito 1 - Tentativa': c1.es_tentativa, 'Delito 1 - Fuero/Ley especial': c1.fuero_ley_especial, 'Delito 1 - General': c1.delito_general, 'Delito 1 - Específico': c1.delito_especifico, 'Delito 1 - Subtipo': c1.subtipo,
        'Delito 2 - Tentativa': c2.es_tentativa, 'Delito 2 - Fuero/Ley especial': c2.fuero_ley_especial, 'Delito 2 - General': c2.delito_general, 'Delito 2 - Específico': c2.delito_especifico, 'Delito 2 - Subtipo': c2.subtipo,
        'Delitos adicionales': crimes.slice(2).map(c => [c.delito_general,c.delito_especifico,c.subtipo].filter(Boolean).join(' / ')).join(' | '),
        'Dirección DIRNIC/DIRNOS': r.direccion_policial, 'Dirección especializada/Región/Frente': r.direccion_especializada_region, 'División policial': r.division_policial, 'Departamento policial': r.departamento_policial, 'Unidad/Área/Equipo': r.unidad_area_equipo,
        'Integra BBCC/OOCC': r.integra_organizacion, 'Nombre BBCC/OOCC': r.nombre_organizacion, 'Armas': weapon.categoria || 'Ninguna', 'Tipo de arma': weapon.tipo, 'Cantidad de armas': weapon.cantidad, 'Observación de armas': weapon.observacion,
        'Situación actual del detenido': r.situacion_actual, 'Documento de libertad': r.documento_libertad, 'Documento de puesta a disposición': r.documento_disposicion, 'Nombre fiscal': r.fiscal_nombre, 'Fiscalía': r.fiscalia,
        'Puesta a disposición Dirección': r.disposicion_direccion, 'Puesta a disposición Región/Frente': r.disposicion_region, 'Puesta a disposición División': r.disposicion_division, 'Puesta a disposición Departamento': r.disposicion_departamento, 'Puesta a disposición Unidad/Área/Equipo': r.disposicion_unidad,
        'Nota informativa SICPIP': r.nota_sicpip, 'Departamento registrador': r.departamento_registro, 'Área registradora': r.unidad, 'Fecha de registro': excelDateTime(r.creado_en), 'Última actualización': excelDateTime(r.actualizado_en)
      };
    });
    downloadWorkbook(rows, 'Detenidos', `detenidos_${currentProfile?.unidad || 'unidad'}`);
  });
}

document.getElementById('exportVictimsExcel').addEventListener('click', exportVictimsExcel);
document.getElementById('exportDetaineesExcel').addEventListener('click', exportDetaineesExcel);
