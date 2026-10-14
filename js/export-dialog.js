/**
 * OpenMermaid Studio - Diálogo y feedback de exportación.
 *
 * Encapsula dos responsabilidades de interfaz:
 *  1. El modal de exportación (formato, resolución y pie de página), leyendo
 *     las selecciones del usuario y notificando a la aplicación. Las
 *     exportaciones siempre se generan sin fondo (solo el diagrama).
 *  2. La retroalimentación del proceso mediante SweetAlert2: loaders para el
 *     trabajo pesado (2x/3x/4x y PDF), toasts de éxito e infos, y alertas de
 *     error. Los estilos se adaptan al tema activo (`data-bs-theme`).
 *
 * Si SweetAlert2 no está disponible, todas las notificaciones se convierten en
 * no-ops seguras, de modo que la exportación sigue funcionando.
 *
 * @module export-dialog
 */

(function (namespaceOpenMermaid) {
  'use strict';

  const referencias = {
    elementos: null,
    alConfirmar: null,
    inicializado: false
  };

  // Paleta de SweetAlert2 alineada con Bootstrap 5.
  const COLORES = {
    oscuro: { background: '#1e293b', color: '#e2e8f0' },
    claro: { background: '#ffffff', color: '#1f2937' },
    primario: '#2563eb'
  };

  const TEXTO_RESOLUCION = {
    1: 'Estándar (1x) · ideal para chat y previsualización rápida',
    2: 'Alta definición (2x) · pantallas Retina y presentaciones',
    3: 'Alta densidad (3x) · documentos premium',
    4: 'Ultra HD / Impresión (4x) · nitidez absoluta sin pixelación'
  };

  /** @returns {boolean} */
  function sweetalertDisponible() {
    return typeof window.Swal !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function';
  }

  /** @returns {boolean} */
  function esTemaOscuro() {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark';
  }

  /**
   * Opciones base de SweetAlert2 adaptadas al tema activo.
   * @returns {Object}
   */
  function opcionesAdaptadasAlTema() {
    const colores = esTemaOscuro() ? COLORES.oscuro : COLORES.claro;
    return {
      background: colores.background,
      color: colores.color,
      confirmButtonColor: COLORES.primario,
      cancelButtonColor: '#64748b'
    };
  }

  // ------------------------------------------------------------------------
  // Feedback (SweetAlert2)
  // ------------------------------------------------------------------------

  /**
   * Muestra un loader bloqueante para procesos pesados.
   * @param {string} [titulo]
   * @param {string} [descripcion]
   */
  function mostrarCargador(titulo, descripcion) {
    if (!sweetalertDisponible()) {
      return;
    }
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      title: titulo || 'Generando archivo en alta resolución…',
      text: descripcion || 'Renderizando capas vectoriales y escalando el Canvas…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => window.Swal.showLoading()
    }));
  }

  /** Cierra el loader o cualquier alerta visible. */
  function cerrarCargador() {
    if (sweetalertDisponible()) {
      window.Swal.close();
    }
  }

  /**
   * Toast de éxito no bloqueante.
   * @param {string} mensaje
   */
  function notificarExito(mensaje) {
    if (!sweetalertDisponible()) {
      return;
    }
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: mensaje,
      showConfirmButton: false,
      timer: 2500,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', window.Swal.stopTimer);
        toast.addEventListener('mouseleave', window.Swal.resumeTimer);
      }
    }));
  }

  /**
   * Toast informativo no bloqueante.
   * @param {string} mensaje
   */
  function notificarInfo(mensaje) {
    if (!sweetalertDisponible()) {
      return;
    }
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: true,
      position: 'top-end',
      icon: 'info',
      title: mensaje,
      showConfirmButton: false,
      timer: 2200,
      timerProgressBar: true
    }));
  }

  /**
   * Alerta de error descriptiva.
   * @param {string} titulo
   * @param {string} [descripcion]
   */
  function notificarError(titulo, descripcion) {
    if (!sweetalertDisponible()) {
      return;
    }
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      icon: 'error',
      title: titulo || 'No se pudo exportar',
      text: descripcion || 'Ocurrió un problema inesperado durante la exportación.',
      confirmButtonText: 'Entendido'
    }));
  }

  // ------------------------------------------------------------------------
  // Modal de exportación
  // ------------------------------------------------------------------------

  /**
   * Inicializa el diálogo con sus referencias y su callback de confirmación.
   * @param {{elementos:Object, alConfirmar:(seleccion:Object)=>void}} opciones
   */
  function inicializarDialogoDeExportacion(opciones) {
    const configuracion = opciones || {};
    referencias.elementos = configuracion.elementos || null;
    referencias.alConfirmar = typeof configuracion.alConfirmar === 'function'
      ? configuracion.alConfirmar
      : null;

    const elementos = referencias.elementos;
    if (!elementos || referencias.inicializado) {
      return;
    }

    const fmt = elementos.selectorFormato || elementos.formato;
    if (fmt) { fmt.addEventListener('change', actualizarVisibilidadDeCampos); }

    const res = elementos.selectorResolucion || elementos.resolucion;
    if (res) { res.addEventListener('change', actualizarResumen); }

    const conf2 = elementos.botonConfirmar || elementos.confirmar;
    if (conf2) { conf2.addEventListener('click', confirmarExportacion); }


    referencias.inicializado = true;
    actualizarVisibilidadDeCampos();
  }

  /** Abre el modal de exportación y sincroniza el resumen. */
  function abrirDialogoDeExportacion() {
    const modal = referencias.elementos && referencias.elementos.modal;
    if (!modal) {
      return;
    }
    actualizarVisibilidadDeCampos();
    if (typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  /** Muestra u oculta cada campo según el formato seleccionado. */
  function actualizarVisibilidadDeCampos() {
    const elementos = referencias.elementos;
    if (!elementos) {
      return;
    }
    const formato = elementos.formato ? elementos.formato.value : 'png';
    const esPng = formato === 'png';

    if (elementos.filaResolucion) {
      elementos.filaResolucion.hidden = !esPng;
    }
    actualizarResumen();
  }

  /** Redacta el resumen textual de la configuración elegida. */
  function actualizarResumen() {
    const elementos = referencias.elementos;
    if (!elementos || !elementos.resumen) {
      return;
    }
    const seleccion = construirSeleccion();
    const piezas = [`Formato: ${seleccion.formato.toUpperCase()}`];

    if (seleccion.formato === 'png') {
      piezas.push(TEXTO_RESOLUCION[seleccion.factorEscala] || `Escala ${seleccion.factorEscala}x`);
    } else if (seleccion.formato === 'pdf') {
      piezas.push('Orientación automática · A4 a 3x');
    }

    if (seleccion.formato !== 'mmd') {
      piezas.push('Sin fondo (transparente)');
    }
    if (seleccion.incluirMetadatos) {
      piezas.push('Con pie de página');
    }

    if (elementos.resumen) elementos.resumen.textContent = piezas.join(' · ');
  }

  /**
   * Lee las selecciones actuales del modal.
   * @returns {{formato:string, factorEscala:number, incluirMetadatos:boolean}}
   */
  function construirSeleccion() {
    const elementos = referencias.elementos || {};
    const fmtEl3 = elementos.selectorFormato || elementos.formato;
    const resEl3 = elementos.selectorResolucion || elementos.resolucion;
    const pieEl4 = elementos.interruptorPieDePagina || elementos.pieDePagina;
    const factor = resEl3 ? Number(resEl3.value) : 1;
    return {
      formato: fmtEl3 ? fmtEl3.value : 'png',
      factorEscala: Number.isFinite(factor) && factor > 0 ? factor : 1,
      incluirMetadatos: Boolean(pieEl4 && pieEl4.checked)
    };
  }

  /** Oculta el modal y delega la exportación en la aplicación. */
  function confirmarExportacion() {
    const elementos = referencias.elementos;
    const modal = elementos && elementos.modal;
    if (modal && typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).hide();
    }
    if (referencias.alConfirmar) {
      referencias.alConfirmar(construirSeleccion());
    }
  }

  namespaceOpenMermaid.ExportDialog = {
    inicializarDialogoDeExportacion,
    abrirDialogoDeExportacion,
    construirSeleccion,
    mostrarCargador,
    cerrarCargador,
    notificarExito,
    notificarInfo,
    notificarError
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
