(function initializeDependentCatalogs() {
  const GEO = window.CATALOGO_UBIGEO || [];
  const CRIMES = window.CATALOGO_DELITOS || [];

  const ROOT_LABELS = {
    FUERO_COMUN: 'Fuero común',
    FUERO_MILITAR_POLICIAL: 'Fuero militar policial',
    LEYES_ESPECIALES: 'Leyes especiales'
  };

  function htmlEscape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function readable(value) {
    if (!value) return '';
    if (ROOT_LABELS[value]) return ROOT_LABELS[value];
    const repaired = String(value)
      .replace(/N�/g, 'N°')
      .replace(/M�TODOS/g, 'MÉTODOS')
      .replace(/M�TODO/g, 'MÉTODO')
      .replace(/VIG�A/g, 'VIGÍA')
      .replace(/POLIC�A/g, 'POLICÍA')
      .replace(/AQU�L/g, 'AQUÉL')
      .replace(/�/g, 'Ó')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return repaired.toLocaleLowerCase('es-PE').replace(/(^|[\s(/.-])([a-záéíóúñü])/g, (_, before, letter) => before + letter.toLocaleUpperCase('es-PE'));
  }

  function fillSelect(select, nodes, placeholder, selectedValue = '') {
    if (!select) return;
    const options = [`<option value="">${placeholder}</option>`];
    for (const node of nodes || []) {
      options.push(`<option value="${htmlEscape(node.value)}">${htmlEscape(readable(node.value))}</option>`);
    }
    select.innerHTML = options.join('');
    select.disabled = !(nodes && nodes.length);
    if (selectedValue && [...select.options].some(option => option.value === selectedValue)) select.value = selectedValue;
  }

  function selectedNode(nodes, value) {
    return (nodes || []).find(node => node.value === value) || null;
  }

  function bindCascade(selects, roots, placeholders) {
    const refreshFrom = index => {
      let nodes = roots;
      for (let level = 0; level < index; level += 1) {
        const node = selectedNode(nodes, selects[level].value);
        nodes = node?.children || [];
      }
      const parent = selectedNode(nodes, selects[index].value);
      let children = parent?.children || [];
      for (let level = index + 1; level < selects.length; level += 1) {
        fillSelect(selects[level], children, placeholders[level]);
        children = [];
      }
    };
    selects.forEach((select, index) => select?.addEventListener('change', () => refreshFrom(index)));
    fillSelect(selects[0], roots, placeholders[0]);
    for (let index = 1; index < selects.length; index += 1) fillSelect(selects[index], [], placeholders[index]);
    return {
      reset() {
        fillSelect(selects[0], roots, placeholders[0]);
        for (let index = 1; index < selects.length; index += 1) fillSelect(selects[index], [], placeholders[index]);
      },
      set(values = []) {
        let nodes = roots;
        selects.forEach((select, index) => {
          fillSelect(select, nodes, placeholders[index], values[index] || '');
          const node = selectedNode(nodes, select.value);
          nodes = node?.children || [];
        });
      }
    };
  }

  function bindLocation(prefix) {
    const selects = [
      document.getElementById(`${prefix}Department`),
      document.getElementById(`${prefix}Province`),
      document.getElementById(`${prefix}District`)
    ];
    if (selects.some(select => !select)) return null;
    return bindCascade(selects, GEO, ['Seleccionar departamento', 'Seleccionar provincia', 'Seleccionar distrito']);
  }

  const victimLocation = bindLocation('victim');
  const detaineeLocation = bindLocation('detainee');
  let victimLocationLegacy = '';

  window.getVictimLocation = function getVictimLocation() {
    const selected = ['victimDepartment', 'victimProvince', 'victimDistrict']
      .map(id => readable(document.getElementById(id)?.value || ''))
      .filter(Boolean)
      .join(' / ');
    return selected || victimLocationLegacy;
  };
  window.resetVictimLocation = () => { victimLocationLegacy = ''; victimLocation?.reset(); };
  window.resetDetaineeLocation = () => detaineeLocation?.reset();
  window.setVictimLocation = function setVictimLocation(storedValue) {
    const wanted = String(storedValue || '').split('/').map(value => value.trim());
    victimLocationLegacy = '';
    if (wanted.length < 2) {
      victimLocationLegacy = String(storedValue || '').trim();
      return victimLocation?.reset();
    }
    let nodes = GEO;
    const rawValues = wanted.map(label => {
      const match = nodes.find(node => readable(node.value).toLocaleLowerCase('es-PE') === label.toLocaleLowerCase('es-PE'));
      nodes = match?.children || [];
      return match?.value || '';
    });
    if (!rawValues[0]) victimLocationLegacy = String(storedValue || '').trim();
    victimLocation?.set(rawValues);
  };

  window.createCrimeCascade = function createCrimeCascade(row, values = {}) {
    const selects = [
      row.querySelector('[data-field="jurisdiction"]'),
      row.querySelector('[data-field="general"]'),
      row.querySelector('[data-field="specific"]'),
      row.querySelector('[data-field="subtype"]')
    ];
    const cascade = bindCascade(selects, CRIMES, ['Seleccionar fuero o ley', 'Seleccionar delito general', 'Seleccionar delito específico', 'Seleccionar subtipo']);
    cascade.set([values.fuero_ley_especial, values.delito_general, values.delito_especifico, values.subtipo]);
    return cascade;
  };
}());
