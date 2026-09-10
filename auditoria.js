(function initializeAuditModule() {
  const result = document.getElementById('auditResult');
  if (!result) return;

  const actionLabels = { INSERT: 'Creación', UPDATE: 'Modificación', DELETE: 'Eliminación' };
  const tableLabels = {
    fichas: 'Víctimas', personas: 'Personas detenidas', detenciones: 'Detenciones',
    detencion_delitos: 'Delitos', detencion_armas: 'Armas', archivos: 'Archivos de víctimas',
    detencion_archivos: 'Archivos de detenidos', operativos: 'Operativos', perfiles: 'Usuarios'
  };

  function localDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
  }

  function changeSummary(event) {
    if (event.accion === 'INSERT') return 'Registro creado';
    if (event.accion === 'DELETE') return 'Registro eliminado';
    const before = event.datos_anteriores || {};
    const after = event.datos_nuevos || {};
    const ignored = new Set(['actualizado_en']);
    const changed = Object.keys(after).filter(key => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    return changed.length ? `Campos: ${changed.join(', ')}` : 'Actualización registrada';
  }

  function details(event) {
    const payload = event.accion === 'DELETE' ? event.datos_anteriores : event.datos_nuevos;
    return escapeHtml(JSON.stringify(payload || {}, null, 2));
  }

  window.loadAudit = async function loadAudit() {
    if (currentProfile?.rol !== 'administrador') return resetMainView();
    const status = document.getElementById('auditStatus');
    status.textContent = 'Consultando eventos…';
    result.innerHTML = '<div class="empty-state"><span>☷</span><h3>Cargando auditoría…</h3></div>';

    let query = supabaseClient.from('auditoria_eventos').select('*').order('fecha_evento', { ascending: false }).limit(500);
    const from = document.getElementById('auditDateFrom').value;
    const to = document.getElementById('auditDateTo').value;
    const action = document.getElementById('auditAction').value;
    const table = document.getElementById('auditTable').value;
    if (from) query = query.gte('fecha_evento', `${from}T00:00:00-05:00`);
    if (to) query = query.lte('fecha_evento', `${to}T23:59:59.999-05:00`);
    if (action) query = query.eq('accion', action);
    if (table) query = query.eq('tabla', table);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      status.textContent = '';
      result.innerHTML = '<p class="records-error">No se pudo consultar la auditoría. Verifique que el SQL de instalación haya sido ejecutado.</p>';
      return;
    }

    const search = document.getElementById('auditSearch').value.trim().toLocaleLowerCase('es-PE');
    const events = search ? data.filter(event => [event.usuario, event.usuario_nombre, event.unidad, event.codigo, event.registro_id, event.tabla]
      .some(value => String(value || '').toLocaleLowerCase('es-PE').includes(search))) : data;
    status.textContent = `${events.length} evento${events.length === 1 ? '' : 's'} mostrado${events.length === 1 ? '' : 's'}${data.length === 500 ? ' · Límite de 500 resultados' : ''}`;
    if (!events.length) {
      result.innerHTML = '<div class="empty-state"><span>⌕</span><h3>No se encontraron eventos</h3><p>Pruebe con otros filtros.</p></div>';
      return;
    }

    const rows = events.map(event => `<tr>
      <td><strong>${escapeHtml(localDate(event.fecha_evento))}</strong></td>
      <td><strong>${escapeHtml(event.usuario_nombre || event.usuario || 'Proceso del sistema')}</strong><small>${escapeHtml(event.usuario || event.usuario_id || 'Automático')}</small></td>
      <td><span class="audit-action ${escapeHtml(event.accion.toLocaleLowerCase())}">${escapeHtml(actionLabels[event.accion] || event.accion)}</span></td>
      <td>${escapeHtml(tableLabels[event.tabla] || event.tabla)}</td>
      <td><strong>${escapeHtml(event.codigo || event.registro_id || '—')}</strong><small>${escapeHtml(event.unidad || '')}</small></td>
      <td><details><summary>${escapeHtml(changeSummary(event))}</summary><pre>${details(event)}</pre></details></td>
    </tr>`).join('');
    result.innerHTML = `<div class="table-wrap audit-table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Registro</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  document.getElementById('refreshAudit').addEventListener('click', window.loadAudit);
  document.getElementById('applyAuditFilters').addEventListener('click', window.loadAudit);
  document.getElementById('auditSearch').addEventListener('keydown', event => { if (event.key === 'Enter') window.loadAudit(); });
}());
