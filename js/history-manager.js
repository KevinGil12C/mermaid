/**
 * OpenMermaid Studio - Gestor de historial de versiones.
 *
 * Controla el panel de snapshots de un diagrama: lista las versiones que el
 * sistema de archivos va archivando automáticamente, permite restaurarlas y
 * vaciar el historial. Toda la lógica de persistencia vive en
 * `FileSystemManager`; este módulo se limita a la capa de presentación.
 *
 * @module history-manager
 */
(function (namespaceOpenMermaid) {
  'use strict';

  /** Referencias externas inyectadas en la inicialización. */
  const dependencias = {
    gestorDeArchivos: null,
    elementos: null,
    alRestaurarVersion: null
  };

  /**
   * Formatea una marca de tiempo ISO a un texto legible en español.
   * @param {string} marcadoIso
   * @returns {string}
   */
  function formatearFechaHistorial(marcadoIso) {
    const fecha = new Date(marcadoIso);
    if (Number.isNaN(fecha.getTime())) {
      return 'Fecha desconocida';
    }
    return fecha.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Extrae un resumen legible del código de una versión.
   * @param {string} codigo
   * @param {number} [longitudMaxima]
   * @returns {string}
   */
  function resumirCodigoDeVersion(codigo, longitudMaxima = 72) {
    const lineas = String(codigo || '')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0 && !linea.startsWith('%%{init'));
    const primeraLineaUtil = lineas[0] || '(vacío)';
    return primeraLineaUtil.length > longitudMaxima
      ? `${primeraLineaUtil.slice(0, longitudMaxima - 1)}…`
      : primeraLineaUtil;
  }

  /**
   * Inicializa el gestor con sus dependencias.
   * @param {{gestorDeArchivos:Object, elementos:Object, alRestaurarVersion:(archivo:Object)=>void}} opciones
   */
  function inicializarGestorDeHistorial(opciones = {}) {
    dependencias.gestorDeArchivos = opciones.gestorDeArchivos || null;
    dependencias.elementos = opciones.elementos || null;
    dependencias.alRestaurarVersion = typeof opciones.alRestaurarVersion === 'function'
      ? opciones.alRestaurarVersion
      : null;
  }

  /** @returns {boolean} */
  function estaDisponibleElPanel() {
    return Boolean(
      dependencias.gestorDeArchivos &&
      dependencias.elementos &&
      dependencias.elementos.listaHistorial
    );
  }

  /**
   * Abre el panel de historial y lo refresca.
   */
  function abrirPanelDeHistorial() {
    refrescarPanelDeHistorial();
    const modal = dependencias.elementos && dependencias.elementos.modalHistorial;
    if (modal && typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  /**
   * Redibuja la lista de versiones del diagrama activo.
   */
  function refrescarPanelDeHistorial() {
    if (!estaDisponibleElPanel()) {
      return;
    }
    const { gestorDeArchivos, elementos } = dependencias;
    const archivoActivo = gestorDeArchivos.obtenerArchivoActivo();

    if (elementos.nombreArchivoHistorial) {
      elementos.nombreArchivoHistorial.textContent = archivoActivo ? archivoActivo.nombre : 'Sin diagrama activo';
    }

    elementos.listaHistorial.innerHTML = '';

    if (!archivoActivo) {
      elementos.listaHistorial.appendChild(
        crearMensajeVacio('No hay un diagrama activo para mostrar su historial.')
      );
      return;
    }

    const versiones = gestorDeArchivos.obtenerHistorialDeArchivo(archivoActivo.id);
    if (versiones.length === 0) {
      elementos.listaHistorial.appendChild(
        crearMensajeVacio('Aún no hay versiones guardadas. Edita el diagrama para generar snapshots automáticos.')
      );
      return;
    }

    const fragmento = document.createDocumentFragment();
    versiones.forEach((version, posicion) => {
      fragmento.appendChild(construirElementoDeVersion(version, posicion === 0));
    });
    elementos.listaHistorial.appendChild(fragmento);
  }

  /**
   * Construye la fila DOM de una versión.
   * @param {{indice:number, fecha:string, codigo:string}} version
   * @param {boolean} esLaMasReciente
   * @returns {HTMLElement}
   */
  function construirElementoDeVersion(version, esLaMasReciente) {
    const fila = document.createElement('article');
    fila.className = 'elemento-historial';

    const meta = document.createElement('div');
    meta.className = 'elemento-historial__meta';

    const fecha = document.createElement('span');
    fecha.className = 'elemento-historial__fecha';
    fecha.textContent = formatearFechaHistorial(version.fecha);

    const resumen = document.createElement('code');
    resumen.className = 'elemento-historial__resumen';
    resumen.textContent = resumirCodigoDeVersion(version.codigo);

    meta.append(fecha, resumen);

    const acciones = document.createElement('div');
    acciones.className = 'elemento-historial__acciones';

    if (esLaMasReciente) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'insignia-historial';
      etiqueta.textContent = 'Más reciente';
      acciones.appendChild(etiqueta);
    }

    const botonRestaurar = document.createElement('button');
    botonRestaurar.type = 'button';
    botonRestaurar.className = 'btn btn-sm btn-outline-primary';
    botonRestaurar.innerHTML =
      '<span class="material-symbols-outlined align-middle" style="font-size: 1rem;">restore</span> Restaurar';
    botonRestaurar.addEventListener('click', () => restaurarVersion(version.indice));
    acciones.appendChild(botonRestaurar);

    fila.append(meta, acciones);
    return fila;
  }

  /**
   * Restaura una versión por su índice en el historial.
   * @param {number} indice
   */
  function restaurarVersion(indice) {
    if (!estaDisponibleElPanel()) {
      return;
    }
    const { gestorDeArchivos, elementos } = dependencias;
    const archivoActivo = gestorDeArchivos.obtenerArchivoActivo();
    if (!archivoActivo) {
      return;
    }

    const resultado = gestorDeArchivos.restaurarVersionDeArchivo(archivoActivo.id, indice);
    if (!resultado.exito) {
      return;
    }

    if (dependencias.alRestaurarVersion) {
      dependencias.alRestaurarVersion(resultado.archivo, resultado.codigo);
    }
    refrescarPanelDeHistorial();

    if (elementos.modalHistorial && typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(elementos.modalHistorial).hide();
    }
  }

  /** Vacía el historial del diagrama activo. */
  function limpiarHistorial() {
    if (!estaDisponibleElPanel()) {
      return;
    }
    const archivoActivo = dependencias.gestorDeArchivos.obtenerArchivoActivo();
    if (!archivoActivo) {
      return;
    }
    dependencias.gestorDeArchivos.limpiarHistorialDeArchivo(archivoActivo.id);
    refrescarPanelDeHistorial();
  }

  /**
   * Crea un nodo de mensaje vacío reutilizable.
   * @param {string} texto
   * @returns {HTMLElement}
   */
  function crearMensajeVacio(texto) {
    const parrafo = document.createElement('p');
    parrafo.className = 'text-secondary small mb-0 p-2';
    parrafo.textContent = texto;
    return parrafo;
  }

  namespaceOpenMermaid.HistoryManager = {
    inicializarGestorDeHistorial,
    abrirPanelDeHistorial,
    refrescarPanelDeHistorial,
    limpiarHistorial,
    formatearFechaHistorial,
    resumirCodigoDeVersion
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
