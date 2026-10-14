/**
 * OpenMermaid Studio - Sistema centralizado de atajos de teclado.
 *
 * Reúne en un único punto el mapa de combinaciones de teclas y su despacho a
 * acciones de la aplicación. La capa de UI (app.js) registra un objeto de
 * callbacks; este módulo se encarga de reconocer la combinación, evitar el
 * comportamiento por defecto del navegador y, cuando aplica, abrir la hoja de
 * referencia de atajos.
 *
 * @module keyboard-shortcuts
 */
(function (namespaceOpenMermaid) {
  'use strict';

  /**
   * Catálogo declarativo de atajos. Es la única fuente de verdad tanto para el
   * despacho como para la hoja de ayuda, evitando que documentación y lógica se
   * desincronicen.
   */
  const CATALOGO_DE_ATAJOS = [
    { accion: 'guardar', combinacion: 'Ctrl + S', descripcion: 'Guardar el diagrama', categoria: 'Archivo' },
    { accion: 'guardarComo', combinacion: 'Ctrl + Shift + S', descripcion: 'Guardar como…', categoria: 'Archivo' },
    { accion: 'abrirExplorador', combinacion: 'Ctrl + B', descripcion: 'Mostrar u ocultar el explorador', categoria: 'Archivo' },
    { accion: 'abrirExplorador', combinacion: 'Ctrl + O', descripcion: 'Mostrar u ocultar el explorador', categoria: 'Archivo' },
    { accion: 'nuevoDiagrama', combinacion: 'Ctrl + G', descripcion: 'Crear un diagrama nuevo', categoria: 'Archivo' },
    { accion: 'exportarSvg', combinacion: 'Ctrl + E', descripcion: 'Exportar SVG vectorial', categoria: 'Archivo' },
    { accion: 'historial', combinacion: 'Ctrl + H', descripcion: 'Historial de versiones', categoria: 'Archivo' },
    { accion: 'buscar', combinacion: 'Ctrl + F', descripcion: 'Buscar en el código', categoria: 'Edición' },
    { accion: 'buscarYReemplazar', combinacion: 'Ctrl + Shift + F', descripcion: 'Buscar y reemplazar', categoria: 'Edición' },
    { accion: 'comentarLineas', combinacion: 'Ctrl + /', descripcion: 'Comentar o descomentar líneas', categoria: 'Edición' },
    { accion: 'deshacer', combinacion: 'Ctrl + Z', descripcion: 'Deshacer', categoria: 'Edición' },
    { accion: 'rehacer', combinacion: 'Ctrl + Y', descripcion: 'Rehacer', categoria: 'Edición' },
    { accion: 'acercar', combinacion: 'Ctrl + +', descripcion: 'Acercar el zoom', categoria: 'Vista' },
    { accion: 'alejar', combinacion: 'Ctrl + -', descripcion: 'Alejar el zoom', categoria: 'Vista' },
    { accion: 'restablecerZoom', combinacion: 'Ctrl + 0', descripcion: 'Restablecer el zoom al 100 %', categoria: 'Vista' },
    { accion: 'alternarMinimapa', combinacion: 'Ctrl + M', descripcion: 'Mostrar u ocultar el minimapa', categoria: 'Vista' },
    { accion: 'modoPresentacion', combinacion: 'F10 o Alt + Enter', descripcion: 'Activar o desactivar el modo presentación', categoria: 'Vista' },
    { accion: 'mostrarAtajos', combinacion: '?', descripcion: 'Mostrar esta referencia de atajos', categoria: 'Ayuda' }
  ];

  const referencias = {
    acciones: {},
    elementos: null,
    manejadorRegistrado: null
  };

  /**
   * Normaliza la clave de un evento para compararla con el catálogo.
   * @param {string} clave
   * @returns {string}
   */
  function normalizarClave(clave) {
    if (typeof clave !== 'string') {
      return '';
    }
    return clave.length === 1 ? clave.toLowerCase() : clave;
  }

  /**
   * Determina qué acción corresponde a un evento de teclado.
   * @param {KeyboardEvent} evento
   * @param {boolean} estaEnEditor
   * @returns {string|null}
   */
  function resolverAccionDeAtajo(evento, estaEnEditor) {
    const ctrl = evento.ctrlKey || evento.metaKey;
    const alt = evento.altKey;
    const shift = evento.shiftKey;
    const tecla = normalizarClave(evento.key);

    if (tecla === 'F10') return 'modoPresentacion';
    if (tecla === 'F1') return 'mostrarAtajos';
    if (tecla === 'Enter' && alt) return 'modoPresentacion';
    if (tecla === 'Escape') return 'cerrarSuperposiciones';

    if (ctrl) {
      switch (tecla) {
        case 's': return shift ? 'guardarComo' : 'guardar';
        case 'o': return 'abrirExplorador';
        case 'b': return 'alternarSidebar';
        case 'g': return 'nuevoDiagrama';
        case 'e': return 'exportarSvg';
        case 'h': return 'historial';
        case 'f': return shift ? 'buscarYReemplazar' : 'buscar';
        case '/': return 'comentarLineas';
        case 'z': return 'deshacer';
        case 'y': return 'rehacer';
        case 'm': return 'alternarMinimapa';
        case '=': case '+': return 'acercar';
        case '-': case '_': return 'alejar';
        case '0': return 'restablecerZoom';
        default: return null;
      }
    }

    // Atajos sin modificador que solo aplican fuera del editor de texto.
    if (!estaEnEditor && !alt && (tecla === '?' || evento.key === '?' || tecla === 'dead' || evento.key === '¡' || evento.key === '¿')) { return 'mostrarAtajos'; }
    return null;
  }

  /**
   * Indica si el foco está en un campo de texto editable.
   * @returns {boolean}
   */
  function determinarFocoEnEditor() {
    const activo = document.activeElement;
    if (!activo) {
      return false;
    }
    if (referencias.elementos && referencias.elementos.editorCodigo) {
      return activo === referencias.elementos.editorCodigo;
    }
    return activo.tagName === 'TEXTAREA' || activo.tagName === 'INPUT';
  }

  /**
   * Despachador global de teclado.
   * @param {KeyboardEvent} evento
   */
  function despacharAtajo(evento) {
    const accion = resolverAccionDeAtajo(evento, determinarFocoEnEditor());
    if (!accion) {
      return;
    }
    const ejecutor = referencias.acciones[accion];
    if (typeof ejecutor !== 'function') {
      return;
    }
    evento.preventDefault();
    ejecutor(evento);
  }

  /**
   * Registra el listener global de teclado (idempotente).
   * @param {{acciones:Object, elementos:Object}} opciones
   */
  function inicializarAtajosDeTeclado(opciones = {}) {
    referencias.acciones = opciones.acciones || {};
    referencias.elementos = opciones.elementos || null;
    if (!referencias.manejadorRegistrado) {
      document.addEventListener('keydown', despacharAtajo);
      referencias.manejadorRegistrado = despacharAtajo;
    }
  }

  /**
   * Desinstala el listener global (útil para pruebas o desmontaje).
   */
  function desactivarAtajosDeTeclado() {
    if (referencias.manejadorRegistrado) {
      document.removeEventListener('keydown', referencias.manejadorRegistrado);
      referencias.manejadorRegistrado = null;
    }
  }

  /**
   * Agrupa el catálogo por categoría para la hoja de referencia.
   * @returns {Array<{categoria:string, atajos:Array<Object>}>}
   */
  function construirAtajosAgrupados() {
    const grupos = [];
    CATALOGO_DE_ATAJOS.forEach((atajo) => {
      let grupo = grupos.find((iterado) => iterado.categoria === atajo.categoria);
      if (!grupo) {
        grupo = { categoria: atajo.categoria, atajos: [] };
        grupos.push(grupo);
      }
      grupo.atajos.push(atajo);
    });
    return grupos;
  }

  /**
   * Rellena y abre el modal con la hoja de referencia de atajos.
   */
  function abrirModalDeAtajosDeTeclado() {
    const contenedor = referencias.elementos && referencias.elementos.listaAtajos;
    if (contenedor) {
      contenedor.innerHTML = '';
      construirAtajosAgrupados().forEach((grupo) => {
        const seccion = document.createElement('section');
        seccion.className = 'grupo-atajos';

        const titulo = document.createElement('h6');
        titulo.className = 'grupo-atajos__titulo';
        titulo.textContent = grupo.categoria;
        seccion.appendChild(titulo);

        const lista = document.createElement('dl');
        lista.className = 'grupo-atajos__lista';
        grupo.atajos.forEach((atajo) => {
          const termino = document.createElement('dt');
          termino.innerHTML = `<kbd>${atajo.combinacion}</kbd>`;
          const descripcion = document.createElement('dd');
          descripcion.textContent = atajo.descripcion;
          lista.append(termino, descripcion);
        });
        seccion.appendChild(lista);
        contenedor.appendChild(seccion);
      });
    }

    const modal = referencias.elementos && referencias.elementos.modalAtajos;
    if (modal && typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  namespaceOpenMermaid.KeyboardShortcuts = {
    CATALOGO_DE_ATAJOS,
    normalizarClave,
    resolverAccionDeAtajo,
    construirAtajosAgrupados,
    inicializarAtajosDeTeclado,
    desactivarAtajosDeTeclado,
    abrirModalDeAtajosDeTeclado
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
