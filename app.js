const form = document.getElementById('enrolmentForm');
const photo = document.getElementById('photo');
const photoLabel = document.getElementById('photoLabel');
const toast = document.getElementById('toast');
const status = document.getElementById('status');
const loginScreen = document.getElementById('loginScreen');
const loginError = document.getElementById('loginError');
const loginButton = document.getElementById('loginButton');
const registerButton = document.getElementById('registerButton');
let currentProfile = null;
let selectedRecord = null;
let editingRecordId = null;
let editingRecordCode = null;
let pendingMarkFiles = [];
let pendingDocumentFiles = [];
let dashboardRecords = [];
let duplicateApprovedSignature = '';
const capturePreviewUrls = { marksFiles: [], documentsFiles: [] };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

async function compressImage(file) {
  const maxDimension = 1600;
  const targetBytes = 700 * 1024;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let quality = 0.82;
  let blob;
  do {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    quality -= 0.1;
  } while (blob && blob.size > targetBytes && quality >= 0.42);

  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return blob;
}

async function uploadRecordFiles(recordId) {
  const groups = [
    { files: [...photo.files], type: 'foto_principal' },
    { files: pendingMarkFiles, type: 'tatuaje' },
    { files: pendingDocumentFiles, type: 'documento' }
  ];
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const uploadedMetadata = [];
  let failed = 0;

  for (const group of groups) {
    for (const file of group.files) {
      if (!allowedTypes.has(file.type) || file.size > 25 * 1024 * 1024) {
        failed += 1;
        continue;
      }

      let compressedFile;
      try {
        compressedFile = await compressImage(file);
      } catch (error) {
        console.error(error);
        failed += 1;
        continue;
      }

      const path = `${currentProfile.unidad}/${recordId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabaseClient.storage
        .from('ficha-archivos')
        .upload(path, compressedFile, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) {
        console.error(uploadError);
        failed += 1;
        continue;
      }

      uploadedMetadata.push({
        ficha_id: recordId,
        tipo: group.type,
        ruta_privada: path,
        creado_por: currentProfile.id
      });
    }
  }

  if (uploadedMetadata.length) {
    const { error: metadataError } = await supabaseClient.from('archivos').insert(uploadedMetadata);
    if (metadataError) {
      console.error(metadataError);
      await supabaseClient.storage.from('ficha-archivos').remove(uploadedMetadata.map(item => item.ruta_privada));
      failed += uploadedMetadata.length;
      return { uploaded: 0, failed };
    }
  }

  return { uploaded: uploadedMetadata.length, failed };
}

async function loadRecords() {
  const result = document.getElementById('recordsResult');
  result.innerHTML = '<div class="empty-state"><span>▤</span><h3>Cargando registros…</h3><p>Consultando la base de datos segura.</p></div>';

  let query = supabaseClient
    .from('fichas')
    .select('id, codigo, apellido_paterno, apellido_materno, nombres, tipo_documento, numero_documento, fecha_nacimiento, edad_registro, nacionalidad, fecha_intervencion, creado_en, unidad')
    .order('creado_en', { ascending: false })
    .limit(100);

  const dateFrom = document.getElementById('recordDateFrom').value;
  const dateTo = document.getElementById('recordDateTo').value;
  if (dateFrom) query = query.gte('fecha_intervencion', dateFrom);
  if (dateTo) query = query.lte('fecha_intervencion', dateTo);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    result.innerHTML = '<p class="records-error">No se pudieron consultar los registros.</p>';
    return;
  }

  const search = document.getElementById('recordSearch').value.trim().toLocaleLowerCase('es');
  const nationality = document.getElementById('recordNationality').value;
  const documentType = document.getElementById('recordDocumentType').value;
  const unit = document.getElementById('recordUnit').value.trim().toLocaleLowerCase('es');
  const minimumAge = document.getElementById('recordAgeMin').value;
  const maximumAge = document.getElementById('recordAgeMax').value;
  const filtered = data.filter(record => (!search || [
    record.codigo,
    record.apellido_paterno,
    record.apellido_materno,
    record.nombres,
    record.numero_documento
  ].some(value => String(value ?? '').toLocaleLowerCase('es').includes(search)))
    && (!nationality || dashboardCategory(record.nacionalidad) === nationality)
    && (!documentType || record.tipo_documento === documentType)
    && (!unit || String(record.unidad || '').toLocaleLowerCase('es').includes(unit))
    && (minimumAge === '' || (recordAge(record) !== null && recordAge(record) >= Number(minimumAge)))
    && (maximumAge === '' || (recordAge(record) !== null && recordAge(record) <= Number(maximumAge))));

  if (!filtered.length) {
    result.innerHTML = '<div class="empty-state"><span>⌕</span><h3>No se encontraron registros</h3><p>Pruebe con otro nombre, código, documento o rango de fechas.</p></div>';
    return;
  }

  const rows = filtered.map(record => `
    <tr>
      <td><span class="record-code">${escapeHtml(record.codigo)}</span></td>
      <td><span class="record-name">${escapeHtml(`${record.apellido_paterno} ${record.apellido_materno}, ${record.nombres}`)}</span></td>
      <td>${escapeHtml(record.tipo_documento || '—')} ${escapeHtml(record.numero_documento || '')}</td>
      <td>${escapeHtml(formatDate(record.fecha_intervencion))}</td>
      <td>${escapeHtml(record.unidad)}</td>
      <td><button class="table-action view-record" data-record-id="${escapeHtml(record.id)}" type="button">Ver ficha</button></td>
    </tr>`).join('');

  result.innerHTML = `
    <div class="records-count"><strong>${filtered.length} registro${filtered.length === 1 ? '' : 's'}</strong><span>Máximo 100 resultados</span></div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Persona</th><th>Documento</th><th>Intervención</th><th>Unidad</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  result.querySelectorAll('.view-record').forEach(button => {
    button.addEventListener('click', () => openRecord(button.dataset.recordId));
  });
}

const recordModal = document.getElementById('recordModal');
const recordDetail = document.getElementById('recordDetail');
const printSheet = document.getElementById('printSheet');

function detailField(label, value) {
  return `<div class="detail-field"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || 'No registrado')}</strong></div>`;
}

function printField(label, value, className = '') {
  return `<div class="print-field ${className}"><b>${escapeHtml(label)}</b><span>${escapeHtml(value || '—')}</span></div>`;
}

async function loadRecordImages(recordId) {
  const { data: files, error } = await supabaseClient
    .from('archivos')
    .select('tipo, ruta_privada, creado_en')
    .eq('ficha_id', recordId)
    .order('creado_en', { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  const images = [];
  for (const file of files || []) {
    const { data, error: signedUrlError } = await supabaseClient.storage
      .from('ficha-archivos')
      .createSignedUrl(file.ruta_privada, 600);

    if (signedUrlError) {
      console.error(signedUrlError);
      continue;
    }

    images.push({ ...file, url: data.signedUrl });
  }
  return images;
}

async function openRecord(recordId) {
  recordDetail.innerHTML = '<div class="empty-state"><h3>Cargando ficha…</h3></div>';
  recordModal.showModal();

  const { data: record, error } = await supabaseClient
    .from('fichas')
    .select('*')
    .eq('id', recordId)
    .single();

  if (error) {
    console.error(error);
    recordDetail.innerHTML = '<p class="records-error">No se pudo abrir la ficha.</p>';
    return;
  }

  const images = await loadRecordImages(recordId);
  const mainPhoto = images.find(image => image.tipo === 'foto_principal');
  const tattooImages = images.filter(image => image.tipo === 'tatuaje');
  const tattooGallery = tattooImages.length
    ? tattooImages.map((image, index) => `
        <figure class="print-evidence-item">
          <img src="${escapeHtml(image.url)}" alt="Fotografía de tatuaje o cicatriz ${index + 1}">
          <figcaption>Imagen ${index + 1} · Tatuaje o cicatriz registrada</figcaption>
        </figure>`).join('')
    : '<div class="print-evidence-empty">No se adjuntaron fotografías de tatuajes o cicatrices.</div>';

  selectedRecord = record;
  document.getElementById('deleteRecordButton').classList.toggle('hidden-control', currentProfile?.rol !== 'administrador');
  document.getElementById('editRecordButton').classList.toggle(
    'hidden-control',
    currentProfile?.rol !== 'administrador' && record.creado_por !== currentProfile?.id
  );

  document.getElementById('recordModalCode').textContent = record.codigo;
  recordDetail.innerHTML = `
    <div class="detail-photo">
      ${mainPhoto
        ? `<img src="${escapeHtml(mainPhoto.url)}" alt="Fotografía de la persona registrada">`
        : '<span>Sin fotografía registrada</span>'}
    </div>
    <div class="detail-section">Datos personales</div>
    ${detailField('Apellido paterno', record.apellido_paterno)}
    ${detailField('Apellido materno', record.apellido_materno)}
    ${detailField('Nombres', record.nombres)}
    ${detailField('Fecha de nacimiento', formatDate(record.fecha_nacimiento))}
    ${detailField('Edad al registrar', record.edad_registro)}
    ${detailField('Estado civil', record.estado_civil)}
    ${detailField('Madre', record.nombre_madre)}
    ${detailField('Padre', record.nombre_padre)}
    ${detailField('Nacionalidad', record.nacionalidad)}
    ${detailField('Ocupación', record.ocupacion)}
    ${detailField('Grado de instrucción', record.grado_instruccion)}
    ${detailField('Teléfono', record.telefono)}
    ${detailField('Domicilio', record.domicilio)}
    ${detailField('Correo', record.correo)}
    ${detailField('Redes sociales', record.redes_sociales)}
    <div class="detail-section">Características y documento</div>
    ${detailField('Estatura', record.estatura)}
    ${detailField('Cabello', record.cabello)}
    ${detailField('Color de cabello', record.color_cabello)}
    ${detailField('Características físicas', record.caracteristicas_fisicas)}
    ${detailField('Cicatrices o tatuajes', record.cicatrices_tatuajes)}
    ${detailField('Documento', `${record.tipo_documento || ''} ${record.numero_documento || ''}`)}
    <div class="detail-section">Intervención</div>
    ${detailField('Motivo', record.motivo_intervencion)}
    ${detailField('Lugar', record.lugar_intervencion)}
    ${detailField('Fecha', formatDate(record.fecha_intervencion))}
    ${detailField('Unidad', record.unidad)}
    ${detailField('Grado del responsable', record.responsable_grado)}
    ${detailField('Responsable', `${record.responsable_apellidos || ''} ${record.responsable_nombres || ''}`)}
  `;

  printSheet.innerHTML = `
    <div class="print-page">
    <header class="print-header"><h1>Ficha voluntaria de identificación</h1><p>DIVINTRAP · DIRCTPTIM PNP &nbsp;|&nbsp; Código: ${escapeHtml(record.codigo)}</p></header>
    <div class="print-top">
      <div class="print-photo">${mainPhoto
        ? `<img src="${escapeHtml(mainPhoto.url)}" alt="Fotografía de la persona registrada">`
        : 'FOTOGRAFÍA<br><br>Sin imagen registrada'}</div>
      <section class="print-block"><h2>Datos personales</h2><div class="print-grid">
        ${printField('Apellido paterno', record.apellido_paterno)}${printField('Apellido materno', record.apellido_materno)}${printField('Nombres', record.nombres)}
        ${printField('Fecha de nacimiento', formatDate(record.fecha_nacimiento))}${printField('Edad', record.edad_registro)}${printField('Estado civil', record.estado_civil)}
        ${printField('Madre', record.nombre_madre, 'print-wide')}${printField('Nacionalidad', record.nacionalidad)}
        ${printField('Padre', record.nombre_padre, 'print-wide')}${printField('Ocupación', record.ocupacion)}
        ${printField('Grado de instrucción', record.grado_instruccion)}${printField('Teléfono', record.telefono)}${printField('Correo', record.correo)}
        ${printField('Domicilio', record.domicilio, 'print-full')}${printField('Redes sociales', record.redes_sociales, 'print-full')}
      </div></section>
    </div>
    <section class="print-block"><h2>Características físicas y documento</h2><div class="print-grid">
      ${printField('Estatura', record.estatura)}${printField('Cabello', record.cabello)}${printField('Color de cabello', record.color_cabello)}
      ${printField('Características físicas', record.caracteristicas_fisicas)}${printField('Tipo de documento', record.tipo_documento)}${printField('Número', record.numero_documento)}
      ${printField('Cicatrices / tatuajes', record.cicatrices_tatuajes, 'print-full')}
    </div></section>
    <section class="print-block"><h2>Datos de la intervención</h2><div class="print-grid">
      ${printField('Motivo de intervención', record.motivo_intervencion, 'print-wide')}${printField('Fecha', formatDate(record.fecha_intervencion))}
      ${printField('Lugar', record.lugar_intervencion, 'print-wide')}${printField('Unidad', record.unidad)}
      ${printField('Grado del responsable', record.responsable_grado)}${printField('Apellidos', record.responsable_apellidos)}${printField('Nombres', record.responsable_nombres)}
    </div></section>
    <p class="print-note">La presente información es proporcionada de forma voluntaria, observando el irrestricto respeto a los derechos humanos.</p>
    <div class="print-signatures"><div>Firma de la persona registrada</div><div>Firma del responsable</div></div>
    </div>
    <div class="print-page print-evidence-page">
      <header class="print-header"><h1>Registro fotográfico</h1><p>Tatuajes y cicatrices &nbsp;|&nbsp; Código: ${escapeHtml(record.codigo)}</p></header>
      <section class="print-evidence-description"><b>Descripción registrada</b><p>${escapeHtml(record.cicatrices_tatuajes || 'Sin descripción registrada')}</p></section>
      <div class="print-evidence-grid count-${Math.min(tattooImages.length, 6)}">${tattooGallery}</div>
      <p class="print-evidence-footer">Anexo fotográfico correspondiente a la ficha voluntaria de identificación.</p>
    </div>
  `;
}

function setFormView() {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'formView'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'formView'));
  document.getElementById('pageEyebrow').textContent = editingRecordId ? 'EDICIÓN' : 'NUEVO REGISTRO';
  document.getElementById('pageHeading').textContent = editingRecordId ? `Editar ${editingRecordCode}` : 'Ficha voluntaria de identificación';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditing() {
  editingRecordId = null;
  editingRecordCode = null;
  form.reset();
  document.getElementById('cancelEditButton').classList.add('hidden-control');
  registerButton.textContent = 'Registrar ficha';
  status.textContent = '';
  setFormView();
}

document.getElementById('editRecordButton').addEventListener('click', () => {
  if (!selectedRecord) return;
  const fieldMap = {
    apellidoPaterno: 'apellido_paterno', apellidoMaterno: 'apellido_materno', nombres: 'nombres',
    fechaNacimiento: 'fecha_nacimiento', edad: 'edad_registro', madre: 'nombre_madre', padre: 'nombre_padre',
    estadoCivil: 'estado_civil', ocupacion: 'ocupacion', instruccion: 'grado_instruccion', nacionalidad: 'nacionalidad',
    redes: 'redes_sociales', domicilio: 'domicilio', telefono: 'telefono', correo: 'correo', estatura: 'estatura',
    cabello: 'cabello', colorCabello: 'color_cabello', caracteristicas: 'caracteristicas_fisicas', marcas: 'cicatrices_tatuajes',
    tipoDocumento: 'tipo_documento', numeroDocumento: 'numero_documento', motivo: 'motivo_intervencion', lugar: 'lugar_intervencion',
    fechaIntervencion: 'fecha_intervencion', unidad: 'unidad', grado: 'responsable_grado',
    responsableApellidos: 'responsable_apellidos', responsableNombres: 'responsable_nombres'
  };

  Object.entries(fieldMap).forEach(([formName, column]) => {
    const field = form.elements.namedItem(formName);
    let value = selectedRecord[column] ?? '';
    if (formName === 'nacionalidad' && /^peru$/i.test(value)) value = 'Perú';
    if (field) field.value = value;
  });
  document.getElementById('consent').checked = true;
  editingRecordId = selectedRecord.id;
  editingRecordCode = selectedRecord.codigo;
  registerButton.textContent = 'Guardar cambios';
  document.getElementById('cancelEditButton').classList.remove('hidden-control');
  recordModal.close();
  setFormView();
});

document.getElementById('cancelEditButton').addEventListener('click', cancelEditing);

document.getElementById('deleteRecordButton').addEventListener('click', async () => {
  if (!selectedRecord || currentProfile?.rol !== 'administrador') return;
  const confirmed = confirm(`¿Eliminar definitivamente la ficha ${selectedRecord.codigo}? Esta acción no se puede deshacer.`);
  if (!confirmed) return;

  const button = document.getElementById('deleteRecordButton');
  button.disabled = true;
  button.textContent = 'Eliminando…';
  const { data: relatedFiles } = await supabaseClient
    .from('archivos')
    .select('ruta_privada')
    .eq('ficha_id', selectedRecord.id);
  const { error } = await supabaseClient.from('fichas').delete().eq('id', selectedRecord.id);
  button.disabled = false;
  button.textContent = 'Eliminar';

  if (error) {
    console.error(error);
    alert('No se pudo eliminar la ficha.');
    return;
  }

  const storagePaths = (relatedFiles || []).map(file => file.ruta_privada).filter(Boolean);
  if (storagePaths.length) {
    const { error: storageError } = await supabaseClient.storage.from('ficha-archivos').remove(storagePaths);
    if (storageError) console.error('No se pudieron retirar algunos archivos del almacenamiento:', storageError);
  }

  recordModal.close();
  selectedRecord = null;
  await loadRecords();
});

document.getElementById('closeRecordModal').addEventListener('click', () => recordModal.close());
document.getElementById('closeRecordButton').addEventListener('click', () => recordModal.close());
document.getElementById('printRecordButton').addEventListener('click', async () => {
  const pendingImages = [...printSheet.querySelectorAll('img')]
    .filter(image => !image.complete)
    .map(image => new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }));
  await Promise.all(pendingImages);
  window.print();
});

const SUPABASE_URL = 'https://dbneehfdhnzldzpxrmas.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_avyv1e1Q7if_TFfd-V3T7A_kTeMzm8C';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function loadCurrentProfile(userId) {
  const { data, error } = await supabaseClient
    .from('perfiles')
    .select('id, usuario, nombres, apellidos, unidad, rol, activo')
    .eq('id', userId)
    .single();

  if (error || !data?.activo) {
    currentProfile = null;
    return false;
  }

  currentProfile = data;
  document.querySelectorAll('.admin-only').forEach(element => {
    element.classList.toggle('visible', data.rol === 'administrador');
  });
  document.querySelector('.user strong').textContent = `${data.nombres} ${data.apellidos}`;
  document.querySelector('.user small').textContent = `${data.rol === 'administrador' ? 'admin' : data.rol} · Cerrar sesión`;
  document.querySelector('.avatar').textContent = data.nombres.slice(0, 1).toUpperCase() + data.apellidos.slice(0, 1).toUpperCase();
  return true;
}

function dashboardCategory(value, fallback = 'No registrado') {
  const clean = String(value ?? '').trim();
  if (!clean) return fallback;
  return clean.toLocaleLowerCase('es').replace(/(^|\s)\S/g, letter => letter.toLocaleUpperCase('es'));
}

function countBy(records, selector) {
  return records.reduce((counts, record) => {
    const key = selector(record);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function renderBarChart(elementId, counts, limit = 8) {
  const container = document.getElementById(elementId);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    container.innerHTML = '<div class="chart-empty">Todavía no hay información para mostrar.</div>';
    return;
  }

  let displayed = entries;
  if (entries.length > limit) {
    const remaining = entries.slice(limit - 1).reduce((sum, entry) => sum + entry[1], 0);
    displayed = [...entries.slice(0, limit - 1), ['Otros', remaining]];
  }
  const maximum = Math.max(...displayed.map(entry => entry[1]), 1);
  container.innerHTML = displayed.map(([label, value]) => `
    <div class="bar-row" title="${escapeHtml(label)}: ${value}">
      <span class="bar-label">${escapeHtml(label)}</span>
      <span class="bar-track"><i class="bar-fill" style="width:${Math.max(3, (value / maximum) * 100)}%"></i></span>
      <strong class="bar-value">${value}</strong>
    </div>`).join('');
}

function recordAge(record) {
  const hasSavedAge = record.edad_registro !== null && record.edad_registro !== '';
  const savedAge = Number(record.edad_registro);
  if (hasSavedAge && Number.isFinite(savedAge) && savedAge >= 0) return savedAge;
  if (!record.fecha_nacimiento) return null;
  const birth = new Date(`${record.fecha_nacimiento}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function ageRange(record) {
  const age = recordAge(record);
  if (age === null) return 'No registrado';
  if (age <= 12) return '0–12 años';
  if (age <= 17) return '13–17 años';
  if (age <= 29) return '18–29 años';
  if (age <= 44) return '30–44 años';
  if (age <= 59) return '45–59 años';
  return '60 años a más';
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dashboardFilteredRecords() {
  const period = document.getElementById('dashboardPeriod').value;
  const nationality = document.getElementById('dashboardNationality').value;
  const fromValue = document.getElementById('dashboardDateFrom').value;
  const toValue = document.getElementById('dashboardDateTo').value;
  const now = new Date();
  let from = null;
  let to = null;
  if (period === 'current') from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (/^\d+$/.test(period)) from = new Date(now.getFullYear(), now.getMonth() - Number(period) + 1, 1);
  if (period === 'custom') {
    if (fromValue) from = new Date(`${fromValue}T00:00:00`);
    if (toValue) to = new Date(`${toValue}T23:59:59`);
  }
  return dashboardRecords.filter(record => {
    const created = record.creado_en ? new Date(record.creado_en) : null;
    return (!nationality || dashboardCategory(record.nacionalidad) === nationality)
      && (!from || (created && created >= from))
      && (!to || (created && created <= to));
  });
}

function renderMonthlyChart(records) {
  const container = document.getElementById('monthlyChart');
  const counts = countBy(records.filter(record => record.creado_en), record => monthKey(new Date(record.creado_en)));
  const keys = Object.keys(counts).sort().slice(-12);
  if (!keys.length) {
    container.innerHTML = '<div class="chart-empty">Todavía no hay información para mostrar.</div>';
    return;
  }
  const maximum = Math.max(...keys.map(key => counts[key]), 1);
  container.innerHTML = keys.map(key => {
    const [year, month] = key.split('-').map(Number);
    const label = new Intl.DateTimeFormat('es-PE', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1));
    return `<div class="month-column" title="${escapeHtml(label)}: ${counts[key]}"><strong>${counts[key]}</strong><span class="month-bar"><i style="height:${Math.max(8, (counts[key] / maximum) * 100)}%"></i></span><small>${escapeHtml(label.replace('.', ''))}</small></div>`;
  }).join('');
}

function renderDashboard() {
  const records = dashboardFilteredRecords();
  const dashboardStatus = document.getElementById('dashboardStatus');
  const total = records.length;
  const peruvians = records.filter(record => /per[uú]/i.test(String(record.nacionalidad || ''))).length;
  const minors = records.filter(record => {
    const age = recordAge(record);
    return age !== null && age < 18;
  }).length;
  const now = new Date();
  const currentMonth = records.filter(record => {
    if (!record.creado_en) return false;
    const created = new Date(record.creado_en);
    return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  }).length;
  const percent = value => total ? `${Math.round((value / total) * 100)}% del total` : '0% del total';
  document.getElementById('dashboardTotal').textContent = total.toLocaleString('es-PE');
  document.getElementById('dashboardPeruvians').textContent = peruvians.toLocaleString('es-PE');
  document.getElementById('dashboardPeruviansPercent').textContent = percent(peruvians);
  document.getElementById('dashboardMinors').textContent = minors.toLocaleString('es-PE');
  document.getElementById('dashboardMinorsPercent').textContent = percent(minors);
  document.getElementById('dashboardMonth').textContent = currentMonth.toLocaleString('es-PE');
  renderBarChart('nationalityChart', countBy(records, record => dashboardCategory(record.nacionalidad)));
  renderBarChart('ageChart', countBy(records, ageRange));
  renderBarChart('educationChart', countBy(records, record => dashboardCategory(record.grado_instruccion)));
  renderBarChart('civilStatusChart', countBy(records, record => dashboardCategory(record.estado_civil)));
  renderMonthlyChart(records);
  dashboardStatus.textContent = `${total.toLocaleString('es-PE')} ficha${total === 1 ? '' : 's'} en el periodo seleccionado.`;
  dashboardStatus.classList.toggle('visible', Boolean(document.getElementById('dashboardPeriod').value !== 'all' || document.getElementById('dashboardNationality').value));
}

async function loadDashboard() {
  const dashboardStatus = document.getElementById('dashboardStatus');
  dashboardStatus.textContent = 'Consultando información…';
  dashboardStatus.classList.add('visible');

  const records = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .select('nacionalidad, edad_registro, fecha_nacimiento, grado_instruccion, estado_civil, creado_en, fecha_intervencion, unidad')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error(error);
      dashboardStatus.textContent = 'No se pudo cargar el resumen. Verifique su conexión e inténtelo nuevamente.';
      return;
    }
    records.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  dashboardRecords = records;
  const nationalitySelect = document.getElementById('dashboardNationality');
  const recordNationality = document.getElementById('recordNationality');
  const nationalities = [...new Set(records.map(record => dashboardCategory(record.nacionalidad)).filter(value => value !== 'No registrado'))].sort((a, b) => a.localeCompare(b, 'es'));
  const options = '<option value="">Todas</option>' + nationalities.map(value => `<option>${escapeHtml(value)}</option>`).join('');
  const selectedDashboardNationality = nationalitySelect.value;
  const selectedRecordNationality = recordNationality.value;
  nationalitySelect.innerHTML = options;
  recordNationality.innerHTML = options;
  nationalitySelect.value = selectedDashboardNationality;
  recordNationality.value = selectedRecordNationality;
  renderDashboard();
}

const pageTitles = {
  dashboardView: ['RESUMEN', 'Dashboard de víctimas'],
  formView: ['NUEVO REGISTRO', 'Ficha voluntaria de identificación'],
  recordsView: ['CONSULTA', 'Registros de enrolamiento'],
  detaineeFormView: ['NUEVO REGISTRO', 'Registro de persona detenida'],
  detaineeRecordsView: ['CONSULTA', 'Registros de detenidos']
  ,usersView: ['ADMINISTRACIÓN', 'Gestión de usuarios']
};

function resetMainView() {
  editingRecordId = null;
  editingRecordCode = null;
  selectedRecord = null;
  form.reset();
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'dashboardView'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'dashboardView'));
  document.getElementById('pageEyebrow').textContent = pageTitles.dashboardView[0];
  document.getElementById('pageHeading').textContent = pageTitles.dashboardView[1];
  document.getElementById('cancelEditButton').classList.add('hidden-control');
  registerButton.textContent = 'Registrar ficha';
  status.textContent = '';
  if (currentProfile) loadDashboard();
}

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  loginError.classList.remove('show');
  loginButton.disabled = true;
  loginButton.textContent = 'Verificando…';

  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  if (!username || username === 'admin' || username === 'administrador') {
    loginError.textContent = 'Usuario o contraseña incorrectos.';
    loginError.classList.add('show');
    loginButton.disabled = false;
    loginButton.textContent = 'Ingresar al sistema';
    return;
  }
  const accountUsername = username === 'amejia' ? 'administrador' : username;
  const email = `${accountUsername}@mejia.local`;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  loginButton.disabled = false;
  loginButton.textContent = 'Ingresar al sistema';

  if (error) {
    loginError.textContent = 'Usuario o contraseña incorrectos.';
    loginError.classList.add('show');
    return;
  }

  const profileLoaded = await loadCurrentProfile(data.user.id);
  if (!profileLoaded) {
    await supabaseClient.auth.signOut();
    loginError.textContent = 'La cuenta no tiene un perfil activo autorizado.';
    loginError.classList.add('show');
    return;
  }

  document.getElementById('password').value = '';
  resetMainView();
  loginScreen.classList.add('hidden');
});

document.getElementById('togglePassword').addEventListener('click', event => {
  const password = document.getElementById('password');
  const visible = password.type === 'text';
  password.type = visible ? 'password' : 'text';
  event.currentTarget.textContent = visible ? 'Ver' : 'Ocultar';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  resetMainView();
  loginScreen.classList.remove('hidden');
});

supabaseClient.auth.getSession().then(({ data }) => {
  if (!data.session) return;
  loadCurrentProfile(data.session.user.id).then(profileLoaded => {
    if (profileLoaded) {
      resetMainView();
      loginScreen.classList.add('hidden');
    }
  });
});

const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
let editingUserId = null;

function openUserForm(profile = null) {
  editingUserId = profile?.id || null;
  userForm.reset();
  document.getElementById('userModalTitle').textContent = profile ? 'Editar usuario' : 'Crear nuevo usuario';
  document.getElementById('saveUserButton').textContent = profile ? 'Guardar cambios' : 'Crear usuario';
  document.querySelector('.user-active-control').classList.toggle('visible', Boolean(profile));
  document.getElementById('newUsername').disabled = Boolean(profile);
  document.getElementById('newUserPassword').required = !profile;
  document.getElementById('newUserPassword').placeholder = profile ? 'Dejar vacío para conservarla' : '';
  document.getElementById('userFormMessage').className = 'modal-help';
  document.getElementById('userFormMessage').textContent = profile
    ? 'Puede cambiar los permisos, el estado y, opcionalmente, la contraseña.'
    : 'Use una contraseña temporal de al menos 8 caracteres y entréguela personalmente al usuario.';
  if (profile) {
    document.getElementById('newUserNames').value = profile.nombres;
    document.getElementById('newUserSurnames').value = profile.apellidos;
    document.getElementById('newUsername').value = profile.usuario;
    document.getElementById('newUserRole').value = profile.rol;
    document.getElementById('newUserUnit').value = profile.unidad;
    document.getElementById('newUserActive').value = String(profile.activo);
  }
  userModal.showModal();
}

async function loadUsers() {
  if (currentProfile?.rol !== 'administrador') {
    resetMainView();
    return;
  }
  const result = document.getElementById('usersResult');
  result.innerHTML = '<div class="empty-state"><span>♙</span><h3>Cargando usuarios…</h3></div>';
  const { data, error } = await supabaseClient.from('perfiles').select('*').order('creado_en');
  if (error) {
    console.error(error);
    result.innerHTML = '<p class="records-error">No se pudieron consultar los usuarios.</p>';
    return;
  }

  const search = document.getElementById('userSearch').value.trim().toLocaleLowerCase('es');
  const users = search ? data.filter(profile => [profile.usuario, profile.nombres, profile.apellidos, profile.unidad, profile.rol]
    .some(value => String(value || '').toLocaleLowerCase('es').includes(search))) : data;
  document.getElementById('activeUsersCount').textContent = data.filter(profile => profile.activo).length;
  document.getElementById('adminUsersCount').textContent = data.filter(profile => profile.rol === 'administrador').length;
  document.getElementById('operatorUsersCount').textContent = data.filter(profile => profile.rol === 'operador').length;

  const rows = users.map(profile => `<tr>
    <td><strong>${escapeHtml(`${profile.nombres} ${profile.apellidos}`)}</strong><small>Usuario: ${escapeHtml(profile.usuario === 'administrador' ? 'amejia' : profile.usuario)}</small></td>
    <td><span class="role ${profile.rol === 'administrador' ? 'admin' : ''}">${escapeHtml(profile.rol === 'administrador' ? 'admin' : profile.rol)}</span></td>
    <td>${escapeHtml(profile.unidad)}</td>
    <td><span class="state ${profile.activo ? '' : 'inactive'}">● ${profile.activo ? 'Activo' : 'Desactivado'}</span></td>
    <td><button class="table-action edit-user" data-user-id="${escapeHtml(profile.id)}" type="button">Editar</button></td>
  </tr>`).join('');
  result.innerHTML = users.length
    ? `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Unidad</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty-state"><span>⌕</span><h3>No se encontraron usuarios</h3></div>';
  result.querySelectorAll('.edit-user').forEach(button => button.addEventListener('click', () => {
    openUserForm(data.find(profile => profile.id === button.dataset.userId));
  }));
}

document.getElementById('openUserModal').addEventListener('click', () => openUserForm());
document.getElementById('closeUserModal').addEventListener('click', () => userModal.close());
document.getElementById('cancelUserModal').addEventListener('click', () => userModal.close());
document.getElementById('userSearch').addEventListener('input', loadUsers);

userForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('userFormMessage');
  const saveButton = document.getElementById('saveUserButton');
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando…';
  message.className = 'modal-help';

  const payload = {
    accion: editingUserId ? 'actualizar' : 'crear',
    id: editingUserId,
    usuario: document.getElementById('newUsername').value.trim().toLowerCase(),
    nombres: document.getElementById('newUserNames').value.trim(),
    apellidos: document.getElementById('newUserSurnames').value.trim(),
    unidad: document.getElementById('newUserUnit').value.trim().toUpperCase(),
    rol: document.getElementById('newUserRole').value,
    activo: document.getElementById('newUserActive').value === 'true',
    contrasena: document.getElementById('newUserPassword').value
  };
  const { data, error } = await supabaseClient.functions.invoke('administrar-usuarios', { body: payload });
  saveButton.disabled = false;
  saveButton.textContent = editingUserId ? 'Guardar cambios' : 'Crear usuario';

  if (error || !data?.ok) {
    console.error(error || data);
    let serverMessage = data?.error;
    if (!serverMessage && error?.context) {
      try {
        const errorBody = await error.context.clone().json();
        serverMessage = errorBody?.error || errorBody?.message;
      } catch (_) {
        serverMessage = '';
      }
    }
    message.className = 'modal-help error';
    message.textContent = serverMessage || 'Supabase rechazó la solicitud. Revise los registros de la función.';
    return;
  }
  message.className = 'modal-help success';
  message.textContent = editingUserId ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.';
  await loadUsers();
  setTimeout(() => userModal.close(), 700);
});

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.view;
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === target));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === target));
    document.getElementById('pageEyebrow').textContent = pageTitles[target][0];
    document.getElementById('pageHeading').textContent = pageTitles[target][1];
    if (target === 'dashboardView') loadDashboard();
    if (target === 'recordsView') loadRecords();
    if (target === 'detaineeFormView') window.initializeDetaineeForm?.();
    if (target === 'detaineeRecordsView') window.loadDetaineeRecords?.();
    if (target === 'usersView') loadUsers();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

document.getElementById('refreshDashboard').addEventListener('click', loadDashboard);
document.getElementById('applyDashboardFilters').addEventListener('click', renderDashboard);
document.getElementById('dashboardPeriod').addEventListener('change', event => {
  const custom = event.target.value === 'custom';
  document.getElementById('dashboardDateFrom').disabled = !custom;
  document.getElementById('dashboardDateTo').disabled = !custom;
});

function dashboardFilterDescription() {
  const period = document.getElementById('dashboardPeriod');
  const nationality = document.getElementById('dashboardNationality').value || 'Todas las nacionalidades';
  let periodText = period.options[period.selectedIndex].text;
  if (period.value === 'custom') {
    periodText = `${formatDate(document.getElementById('dashboardDateFrom').value)} al ${formatDate(document.getElementById('dashboardDateTo').value)}`;
  }
  return `${periodText} · ${nationality}`;
}

document.getElementById('exportDashboard').addEventListener('click', () => {
  const report = document.getElementById('dashboardView').cloneNode(true);
  report.querySelector('.records-toolbar')?.remove();
  report.querySelector('.dashboard-filters')?.remove();
  report.querySelector('.privacy-banner')?.remove();
  report.querySelector('#dashboardStatus')?.remove();
  printSheet.innerHTML = `<div class="print-page dashboard-report"><header class="dashboard-report-header"><img src="assets/logo-diriptim.png" alt=""><div><h1>Dashboard de víctimas</h1><p>${escapeHtml(dashboardFilterDescription())}</p></div><small>Generado: ${escapeHtml(new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()))}</small></header>${report.innerHTML}<footer>Reporte estadístico protegido · Uso exclusivo para personal autorizado</footer></div>`;
  window.print();
});

const formSteps = [...document.querySelectorAll('.form-step')];
const progressStepLabels = [...document.querySelectorAll('.progress-labels [data-step-target]')];
const progressBar = document.querySelector('.progress i');

function setActiveFormStep(stepNumber) {
  progressStepLabels.forEach((label, index) => label.classList.toggle('active', index + 1 === stepNumber));
  progressBar.style.width = `${stepNumber * 25}%`;
}

function updateFormStepFromScroll() {
  if (!document.getElementById('formView').classList.contains('active')) return;
  let activeStep = 1;
  formSteps.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= 205) activeStep = index + 1;
  });
  setActiveFormStep(activeStep);
}

progressStepLabels.forEach(label => {
  const goToStep = () => document.getElementById(label.dataset.stepTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  label.addEventListener('click', goToStep);
  label.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      goToStep();
    }
  });
});

window.addEventListener('scroll', updateFormStepFromScroll, { passive: true });

const mobileMenuButton = document.querySelector('.menu');
const mobileSidebar = document.querySelector('.sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

function closeMobileMenu() {
  mobileSidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
  document.body.classList.remove('menu-open');
  mobileMenuButton.setAttribute('aria-expanded', 'false');
}

mobileMenuButton.setAttribute('aria-expanded', 'false');
mobileMenuButton.addEventListener('click', () => {
  const opening = !mobileSidebar.classList.contains('open');
  mobileSidebar.classList.toggle('open', opening);
  sidebarBackdrop.classList.toggle('visible', opening);
  document.body.classList.toggle('menu-open', opening);
  mobileMenuButton.setAttribute('aria-expanded', String(opening));
});
sidebarBackdrop.addEventListener('click', closeMobileMenu);
document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', closeMobileMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileMenu();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeMobileMenu();
});

function renderCapturedFiles(inputId, files, previewId, statusId, emptyText) {
  capturePreviewUrls[inputId].forEach(url => URL.revokeObjectURL(url));
  capturePreviewUrls[inputId] = files.map(file => URL.createObjectURL(file));
  const preview = document.getElementById(previewId);
  preview.innerHTML = files.map((file, index) => `
    <figure class="capture-thumb">
      <img src="${capturePreviewUrls[inputId][index]}" alt="Vista previa ${index + 1}">
      <button type="button" data-remove-index="${index}" aria-label="Quitar imagen ${index + 1}">×</button>
    </figure>`).join('');
  document.getElementById(statusId).textContent = files.length
    ? `${files.length} imagen${files.length === 1 ? '' : 'es'} lista${files.length === 1 ? '' : 's'} para guardar`
    : emptyText;
  preview.querySelectorAll('[data-remove-index]').forEach(button => button.addEventListener('click', () => {
    files.splice(Number(button.dataset.removeIndex), 1);
    renderCapturedFiles(inputId, files, previewId, statusId, emptyText);
  }));
}

function accumulateCapturedFiles(inputId, files, previewId, statusId, emptyText) {
  const input = document.getElementById(inputId);
  input.addEventListener('change', () => {
    files.push(...[...(input.files || [])]);
    input.value = '';
    renderCapturedFiles(inputId, files, previewId, statusId, emptyText);
  });
}

accumulateCapturedFiles('marksFiles', pendingMarkFiles, 'marksPreview', 'marksFileStatus', 'Abrir cámara o elegir imágenes');
accumulateCapturedFiles('documentsFiles', pendingDocumentFiles, 'documentsPreview', 'documentsFileStatus', 'Anverso, reverso u otros documentos');
document.querySelectorAll('.add-more-photo').forEach(button => button.addEventListener('click', () => {
  document.getElementById(button.dataset.for)?.click();
}));
form.addEventListener('reset', () => {
  pendingMarkFiles.length = 0;
  pendingDocumentFiles.length = 0;
  renderCapturedFiles('marksFiles', pendingMarkFiles, 'marksPreview', 'marksFileStatus', 'Abrir cámara o elegir imágenes');
  renderCapturedFiles('documentsFiles', pendingDocumentFiles, 'documentsPreview', 'documentsFileStatus', 'Anverso, reverso u otros documentos');
  setActiveFormStep(1);
});
document.getElementById('recordSearchButton').addEventListener('click', loadRecords);
document.getElementById('clearRecordFilters').addEventListener('click', () => {
  ['recordSearch', 'recordDateFrom', 'recordDateTo', 'recordNationality', 'recordDocumentType', 'recordAgeMin', 'recordAgeMax', 'recordUnit'].forEach(id => {
    document.getElementById(id).value = '';
  });
  loadRecords();
});
document.getElementById('recordSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter') loadRecords();
});

photo.addEventListener('change', () => {
  const file = photo.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    alert('La fotografía original supera los 25 MB.');
    photo.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    photoLabel.style.backgroundImage = `url(${event.target.result})`;
    photoLabel.classList.add('has-photo');
  };
  reader.readAsDataURL(file);
});

form.addEventListener('input', () => {
  const required = [...form.querySelectorAll('[required]')];
  const completed = required.filter(field => field.type === 'checkbox' ? field.checked : field.value.trim()).length;
  status.textContent = `${completed} de ${required.length} campos obligatorios completos`;
});

function duplicateSignature(values) {
  return [values.tipoDocumento, values.numeroDocumento, values.apellidoPaterno, values.apellidoMaterno, values.nombres, values.fechaNacimiento]
    .map(value => String(value || '').trim().toLocaleLowerCase('es')).join('|');
}

async function findPossibleDuplicates(values) {
  if (editingRecordId) return [];
  const documentNumber = values.numeroDocumento?.trim();
  let query = supabaseClient.from('fichas').select('id, codigo, apellido_paterno, apellido_materno, nombres, tipo_documento, numero_documento, fecha_nacimiento, fecha_intervencion, creado_en').limit(8);
  if (documentNumber) {
    query = query.eq('numero_documento', documentNumber);
  } else {
    query = query
      .ilike('apellido_paterno', values.apellidoPaterno.trim())
      .ilike('apellido_materno', values.apellidoMaterno.trim())
      .ilike('nombres', values.nombres.trim());
    if (values.fechaNacimiento) query = query.eq('fecha_nacimiento', values.fechaNacimiento);
  }
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

function requestDuplicateConfirmation(matches) {
  const modal = document.getElementById('duplicateModal');
  document.getElementById('duplicateResults').innerHTML = matches.map(record => `<article><div><strong>${escapeHtml(`${record.apellido_paterno} ${record.apellido_materno}, ${record.nombres}`)}</strong><span>${escapeHtml(record.codigo)}</span></div><p>${escapeHtml(record.tipo_documento || 'Documento')} ${escapeHtml(record.numero_documento || 'no registrado')} · Nacimiento: ${escapeHtml(formatDate(record.fecha_nacimiento))} · Última intervención: ${escapeHtml(formatDate(record.fecha_intervencion))}</p></article>`).join('');
  modal.showModal();
  return new Promise(resolve => {
    const finish = approved => {
      modal.close();
      document.getElementById('confirmDuplicate').removeEventListener('click', approve);
      document.getElementById('cancelDuplicate').removeEventListener('click', cancel);
      modal.removeEventListener('cancel', cancelDialog);
      resolve(approved);
    };
    const approve = () => finish(true);
    const cancel = () => finish(false);
    const cancelDialog = event => {
      event.preventDefault();
      finish(false);
    };
    document.getElementById('confirmDuplicate').addEventListener('click', approve);
    document.getElementById('cancelDuplicate').addEventListener('click', cancel);
    modal.addEventListener('cancel', cancelDialog);
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  if (!currentProfile) {
    alert('La sesión no está autorizada. Vuelva a iniciar sesión.');
    loginScreen.classList.remove('hidden');
    return;
  }

  const values = Object.fromEntries(new FormData(form).entries());
  const signature = duplicateSignature(values);
  if (!editingRecordId && signature !== duplicateApprovedSignature) {
    status.textContent = 'Verificando posibles registros anteriores…';
    const matches = await findPossibleDuplicates(values);
    if (matches.length) {
      const approved = await requestDuplicateConfirmation(matches);
      if (!approved) {
        status.textContent = 'Registro pausado para revisar la coincidencia.';
        return;
      }
      duplicateApprovedSignature = signature;
    }
  }

  registerButton.disabled = true;
  registerButton.textContent = 'Guardando…';
  status.textContent = 'Enviando datos de forma segura…';

  const today = new Date();
  const codigo = `FIC-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const emptyToNull = value => value?.trim() || null;

  const record = {
    codigo,
    apellido_paterno: values.apellidoPaterno.trim(),
    apellido_materno: values.apellidoMaterno.trim(),
    nombres: values.nombres.trim(),
    fecha_nacimiento: emptyToNull(values.fechaNacimiento),
    edad_registro: values.edad ? Number(values.edad) : null,
    nombre_madre: emptyToNull(values.madre),
    nombre_padre: emptyToNull(values.padre),
    estado_civil: emptyToNull(values.estadoCivil),
    ocupacion: emptyToNull(values.ocupacion),
    grado_instruccion: emptyToNull(values.instruccion),
    nacionalidad: emptyToNull(values.nacionalidad),
    redes_sociales: emptyToNull(values.redes),
    domicilio: emptyToNull(values.domicilio),
    telefono: emptyToNull(values.telefono),
    correo: emptyToNull(values.correo),
    estatura: values.estatura ? Number(values.estatura) : null,
    cabello: emptyToNull(values.cabello),
    color_cabello: emptyToNull(values.colorCabello),
    caracteristicas_fisicas: emptyToNull(values.caracteristicas),
    cicatrices_tatuajes: emptyToNull(values.marcas),
    tipo_documento: emptyToNull(values.tipoDocumento),
    numero_documento: emptyToNull(values.numeroDocumento),
    motivo_intervencion: emptyToNull(values.motivo),
    lugar_intervencion: emptyToNull(values.lugar),
    fecha_intervencion: emptyToNull(values.fechaIntervencion),
    unidad: currentProfile.unidad,
    responsable_grado: emptyToNull(values.grado),
    responsable_apellidos: emptyToNull(values.responsableApellidos),
    responsable_nombres: emptyToNull(values.responsableNombres),
    creado_por: currentProfile.id
  };

  let saveResult;
  if (editingRecordId) {
    const editableRecord = { ...record, actualizado_en: new Date().toISOString() };
    delete editableRecord.codigo;
    delete editableRecord.creado_por;
    delete editableRecord.unidad;
    saveResult = await supabaseClient.from('fichas').update(editableRecord).eq('id', editingRecordId).select('id, codigo').single();
  } else {
    saveResult = await supabaseClient.from('fichas').insert(record).select('id, codigo').single();
  }
  const { data: savedRecord, error } = saveResult;

  if (error) {
    console.error(error);
    status.textContent = 'No se pudo guardar. Revise los datos e intente nuevamente.';
    registerButton.disabled = false;
    registerButton.textContent = editingRecordId ? 'Guardar cambios' : 'Registrar ficha';
    return;
  }

  status.textContent = 'Ficha guardada. Subiendo fotografías…';
  const fileResult = await uploadRecordFiles(savedRecord.id);
  registerButton.disabled = false;
  registerButton.textContent = 'Registrar ficha';
  const savedCode = editingRecordCode || codigo;
  editingRecordId = null;
  editingRecordCode = null;
  duplicateApprovedSignature = '';
  form.reset();
  document.getElementById('cancelEditButton').classList.add('hidden-control');
  photoLabel.style.backgroundImage = '';
  photoLabel.classList.remove('has-photo');
  status.textContent = fileResult.failed
    ? `Ficha ${savedCode} guardada; ${fileResult.failed} archivo(s) no pudieron subirse.`
    : `Ficha ${savedCode} guardada con ${fileResult.uploaded} archivo(s).`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('¿Desea limpiar todos los campos de esta ficha?')) return;
  form.reset();
  photoLabel.style.backgroundImage = '';
  photoLabel.classList.remove('has-photo');
  status.textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
