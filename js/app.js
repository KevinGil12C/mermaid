/**
 * OpenMermaid Studio - Orquestador principal.
 *
 * Único módulo que conoce el DOM. Conecta los módulos puros (color, estilizado,
 * renderizado, exportación y sistema de archivos) con la interfaz.
 *
 * Modelo mental:
 *  - El sistema de archivos (FileSystemManager) es la fuente de verdad del
 *    contenido persistido y del archivo activo.
 *  - La paleta actual (estado.paleta) es la fuente de verdad del tema visual.
 *  - Al renderizar se combinan ambos: se inyecta la directiva de tema derivada
 *    de la paleta sobre el código del editor sin destruir su contenido.
 *
 * @module app
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const {
    ColorAlgorithms,
    Templates,
    DiagramStyler,
    MermaidRenderer,
    Exporter,
    FileSystemManager,
    DocsViewer,
    KeyboardShortcuts,
    HistoryManager,
    Minimap,
    FindReplace,
    ExportDialog,
    CanvasViewport,
    Alerts,
    CODIGO_DIAGRAMA_INICIAL
  } = namespaceOpenMermaid;

  const MILISEGUNDOS_RETARDO_RENDER = 300;
  const MARGEN_AJUSTE_LIENZO = 40;
  const FACTOR_ZOOM_MAXIMO_AJUSTE = 1.2;
  const ESCALA_ZOOM_MINIMA = 0.1;
  const ESCALA_ZOOM_MAXIMA = 8;
  const PASO_ZOOM = 1.15;
  const SANGRIA_EDITOR = '    ';
  const PREFIJO_COMENTARIO_MERMAID = '%% ';

  /** Estado mutable de la aplicación. */
  const estado = {
    gestorDeArchivos: null,
    paleta: null,
    tipoEsquema: 'analogo',
    matizBase: 213,
    saturacionBase: 68,
    incluirClasesDeEstilo: false,
    modoOscuro: true,
    zoom: 1,
    desplazamientoX: 0,
    desplazamientoY: 0,
    arrastrandoPan: false,
    origenPanX: 0,
    origenPanY: 0,
    ajusteAutomaticoDelLienzo: true,
    modoPresentacion: false,
    minimapaVisible: false,
    marcaDeAguaActiva: false,
    autorMarcaDeAgua: '',
    carpetasExpandidas: new Set(),
    manejadorRenderConRetardo: null,
    ultimoErrorDeSintaxisNotificado: null,
    viewportPequeno: null
  };

  /** Caché de referencias al DOM. */
  const ELEMENTOS = {};

  /**
   * Emite una notificación de éxito a través del despachador central.
   * @param {string} mensaje
   */
  function notificarExitoDeAccion(mensaje) {
    if (Alerts && typeof Alerts.mostrarNotificacionAccionExitosa === 'function') {
      Alerts.mostrarNotificacionAccionExitosa(mensaje);
    }
  }

  /**
   * Emite una notificación de error a través del despachador central.
   * @param {string} titulo
   * @param {string} [descripcion]
   */
  function notificarErrorDeAccion(titulo, descripcion) {
    if (Alerts && typeof Alerts.notificarError === 'function') {
      Alerts.notificarError(titulo, descripcion);
    }
  }

  // ==========================================================================
  // Arranque
  // ==========================================================================

  /**
   * Punto de entrada principal.
   */
  function iniciarAplicacion() {
    cachearElementosDelDom();

    estado.gestorDeArchivos = new FileSystemManager();
    estado.gestorDeArchivos.inicializarEspacioDeTrabajo();
    restaurarPreferenciasDesdeConfiguracion();

    const motorListo = MermaidRenderer.inicializarMotorDeRenderizado();
    ELEMENTOS.estadoVersionMermaid.textContent = MermaidRenderer.obtenerVersionDeMermaid();

    poblarSelectorDeArmonias();
    reconstruirPaletaActual();
    sincronizarControlesDeDiseno();
    aplicarTemaVisual();
    DocsViewer.inicializarVisorDeDocumentacion({
      gestorDeArchivos: estado.gestorDeArchivos,
      alCargarSnippet: colocarSnippetEnEditor
    });

    construirGaleriaDePlantillas();
    inicializarModulosExtendidos();
    registrarEventosDeInterfaz();
    aplicarPreferenciasDeModulosExtendidos();
    sincronizarSidebarConViewport();

    renderizarArbolDeArchivos();
    abrirArchivoActivo();
    actualizarEstadoDeAlmacenamiento();

    if (!motorListo) {
      mostrarError('No se pudo inicializar Mermaid. Comprueba la conexión al CDN.');
      establecerEstadoRenderizado('Mermaid no disponible', 'error');
      return;
    }
    ejecutarRenderizado();
  }

  /**
   * Restaura preferencias de interfaz desde la configuración persistida.
   */
  function restaurarPreferenciasDesdeConfiguracion() {
    const configuracion = estado.gestorDeArchivos.obtenerConfiguracion();
    estado.modoOscuro = configuracion.tema !== 'light';
    if (Number.isFinite(configuracion.matizBase)) estado.matizBase = configuracion.matizBase;
    if (Number.isFinite(configuracion.saturacionBase)) estado.saturacionBase = configuracion.saturacionBase;
    if (typeof configuracion.tipoEsquema === 'string') estado.tipoEsquema = configuracion.tipoEsquema;
    if (typeof configuracion.incluirClasesDeEstilo === 'boolean') {
      estado.incluirClasesDeEstilo = configuracion.incluirClasesDeEstilo;
    }
    if (typeof configuracion.marcaDeAguaActiva === 'boolean') {
      estado.marcaDeAguaActiva = configuracion.marcaDeAguaActiva;
    }
    if (typeof configuracion.autorMarcaDeAgua === 'string') {
      estado.autorMarcaDeAgua = configuracion.autorMarcaDeAgua;
    }
    if (typeof configuracion.minimapaVisible === 'boolean') {
      estado.minimapaVisible = configuracion.minimapaVisible;
    }
  }

  /**
   * Persiste las preferencias de paleta e interfaz en la configuración.
   */
  function guardarPreferenciasEnConfiguracion() {
    estado.gestorDeArchivos.actualizarConfiguracion({
      matizBase: estado.matizBase,
      saturacionBase: estado.saturacionBase,
      tipoEsquema: estado.tipoEsquema,
      incluirClasesDeEstilo: estado.incluirClasesDeEstilo,
      marcaDeAguaActiva: estado.marcaDeAguaActiva,
      autorMarcaDeAgua: estado.autorMarcaDeAgua,
      minimapaVisible: estado.minimapaVisible
    });
  }

  /**
   * Cachea todas las referencias del DOM utilizadas por los controladores.
   */
  function cachearElementosDelDom() {
    const identificadores = [
      'sidebar', 'arbolArchivos', 'botonNuevaCarpeta', 'botonNuevoDiagrama', 'botonToggleSidebar',
      'botonGuardar', 'botonGuardarComo', 'botonAbrirRespaldo', 'botonAbrirGaleriaPlantillas',
      'botonAlternarOrientacion', 'botonAbrirDocumentacion', 'botonModoOscuro', 'iconoModoOscuro',
      'botonMenuDiseno', 'selectorArmonia', 'entradaColorBase', 'rangoSaturacion', 'valorSaturacion',
      'botonPaletaAleatoria', 'muestraPaleta', 'interruptorClasesEstilo', 'botonAplicarDiseno',
      'botonMenuExportar', 'exportarSvg', 'exportarPdf', 'exportarPng1x', 'exportarPng2x', 'exportarPng4x',
      'exportarCodigoMmd', 'copiarCodigo', 'copiarSvg', 'copiarPng',
      'interruptorMarcaDeAgua', 'autorMarcaDeAgua',
      'botonBuscar', 'botonHistorial', 'botonMinimapa', 'botonPresentacion', 'botonAtajos',
      'panelEditor', 'separadorPaneles', 'editorCodigo', 'numerosLinea', 'nombreArchivoActivo',
      'estadisticaLineas', 'estadisticaCaracteres', 'estadisticaTamano', 'estadisticaPosicion',
      'barraBusqueda', 'entradaBuscar', 'entradaReemplazar', 'contadorCoincidencias',
      'botonBuscarSiguiente', 'botonBuscarAnterior', 'botonReemplazar', 'botonReemplazarTodo',
      'botonCerrarBusqueda', 'filaReemplazo',
      'lienzo', 'contenidoLienzo', 'superposicionVacia', 'superposicionError', 'detalleError',
      'indicadorZoom', 'botonAcercar', 'botonAlejar', 'botonZoom100', 'botonAjustar', 'botonCentrar', 'btn-zoom-in', 'btn-zoom-out', 'zoom-level-text', 'btn-zoom-reset', 'btn-fit-screen', 'btn-fullscreen',
      'minimapa', 'minimapaContenido', 'minimapaViewport', 'botonCerrarMinimapa',
      'barraPresentacion', 'botonSalirPresentacion',
      'puntoEstado', 'estadoRenderizado', 'estadoSintaxis', 'estadoVersionMermaid', 'estadoAlmacenamiento',
      'modalPlantillas', 'galeriaPlantillas', 'modalGuardarComo', 'formularioGuardarComo',
      'campoNombreArchivo', 'selectorCarpetaDestino', 'errorGuardarComo',
      'modalRespaldo', 'botonExportarRespaldo', 'entradaImportarRespaldo', 'mensajeRespaldo',
      'modalDocumentacion', 'modalAtajos', 'listaAtajos', 'modalHistorial', 'listaHistorial', 'nombreArchivoHistorial', 'botonLimpiarHistorial',
    'modalExportacion', 'selectorFormatoExportacion', 'selectorResolucionExportacion',
    'interruptorPieDePagina', 'botonConfirmarExportacion',
    'filaResolucionExportacion', 'resumenExportacion', 'abrirModalExportacion'
    ];
    identificadores.forEach((identificador) => {
      ELEMENTOS[identificador] = document.getElementById(identificador);
    });
  }

  // ==========================================================================
  // Registro de eventos
  // ==========================================================================

  /**
   * Enlaza todos los eventos del DOM con sus manejadores.
   */
  function registrarEventosDeInterfaz() {
    registrarEventosDelEditor();
    registrarEventosDeArchivos();
    registrarEventosDePaleta();
    registrarEventosDeLienzo();
    registrarEventosDeExportacion();
    registrarEventosDePlantillas();
    registrarEventosDeRespaldo();
    registrarEventosDeDocumentacion();
    registrarEventosDeTemaYSidebar();
    registrarEventoDelSeparador();
    registrarEventosDeBusqueda();
    registrarEventosDeHistorial();
    registrarEventosDeMinimapa();
    registrarEventosDePresentacion();
    registrarEventosDeAtajos();
    registrarObservadorDeTamanoDelLienzo();
    registrarAtajosDeTeclado();
    registrarEventosDeConexion();
  }

  /** Eventos del editor de código. */
  function registrarEventosDelEditor() {
    const renderizarConRetardo = MermaidRenderer.crearTareaConRetardo(() => {
      ejecutarRenderizado();
      guardarDiagramaActivoSilencioso();
      actualizarEstadoDeAlmacenamiento();
      refrescarHistorialDeVersiones();
    }, MILISEGUNDOS_RETARDO_RENDER);
    estado.manejadorRenderConRetardo = renderizarConRetardo;

    ELEMENTOS.editorCodigo.addEventListener('input', () => {
      actualizarEstadisticasYNumeros();
      renderizarConRetardo();
    });
    ELEMENTOS.editorCodigo.addEventListener('scroll', sincronizarDesplazamientoDeNumeros);
    ELEMENTOS.editorCodigo.addEventListener('keydown', manejarTeclaEnEditor);
    ['keyup', 'click', 'select'].forEach((nombreEvento) => {
      ELEMENTOS.editorCodigo.addEventListener(nombreEvento, actualizarPosicionDelCursor);
    });
  }

  /** Eventos del explorador y de guardado. */
  function registrarEventosDeArchivos() {
    ELEMENTOS.botonNuevaCarpeta.addEventListener('click', solicitarNuevaCarpeta);
    ELEMENTOS.botonNuevoDiagrama.addEventListener('click', crearNuevoDiagrama);
    ELEMENTOS.botonGuardar.addEventListener('click', guardarDiagramaDesdeBoton);
    ELEMENTOS.botonGuardarComo.addEventListener('click', abrirModalGuardarComo);
    ELEMENTOS.formularioGuardarComo.addEventListener('submit', confirmarGuardarComo);
  }

  /** Eventos de los controles de paleta. */
  function registrarEventosDePaleta() {
    ELEMENTOS.selectorArmonia.addEventListener('change', (evento) => {
      estado.tipoEsquema = evento.target.value;
      aplicarCambioDePaleta();
    });

    ELEMENTOS.entradaColorBase.addEventListener('input', (evento) => {
      const hslDelColor = ColorAlgorithms.convertirHexAHsl(evento.target.value);
      estado.matizBase = hslDelColor.h;
      estado.saturacionBase = Math.round(hslDelColor.s);
      ELEMENTOS.rangoSaturacion.value = String(estado.saturacionBase);
      ELEMENTOS.valorSaturacion.textContent = String(estado.saturacionBase);
      aplicarCambioDePaleta();
    });

    ELEMENTOS.rangoSaturacion.addEventListener('input', (evento) => {
      estado.saturacionBase = Number(evento.target.value);
      ELEMENTOS.valorSaturacion.textContent = String(estado.saturacionBase);
      aplicarCambioDePaleta();
    });

    ELEMENTOS.botonPaletaAleatoria.addEventListener('click', () => {
      const paletaAleatoria = ColorAlgorithms.generarPaletaAleatoriaInteligente(estado.modoOscuro);
      estado.matizBase = paletaAleatoria.matizBase;
      estado.saturacionBase = paletaAleatoria.saturacionBase;
      estado.tipoEsquema = paletaAleatoria.tipoEsquema;
      reconstruirPaletaActual();
      sincronizarControlesDeDiseno();
      guardarPreferenciasEnConfiguracion();
      programarRenderizado();
      const armonia = ColorAlgorithms.obtenerArmoniasDisponibles()
        .find((opcion) => opcion.clave === estado.tipoEsquema);
      notificarExitoDeAccion(`Nueva paleta cromática ${armonia ? armonia.etiqueta : 'aleatoria'} aplicada correctamente`);
    });

    ELEMENTOS.interruptorClasesEstilo.addEventListener('change', (evento) => {
      estado.incluirClasesDeEstilo = evento.target.checked;
      guardarPreferenciasEnConfiguracion();
    });

    ELEMENTOS.botonAplicarDiseno.addEventListener('click', () => {
      aplicarDisenoAlCodigo();
      guardarDiagramaActivoSilencioso();
      estado.ajusteAutomaticoDelLienzo = true;
      ejecutarRenderizado();
      notificarExitoDeAccion('Paleta algorítmica aplicada al diagrama');
    });

    ELEMENTOS.botonAlternarOrientacion.addEventListener('click', alternarOrientacionDelDiagrama);
  }

  /** Conmuta la orientación (vertical ↔ horizontal) de un diagrama de flujo. */
  function alternarOrientacionDelDiagrama() {
    if (!DiagramStyler.esDiagramaDeFlujo(ELEMENTOS.editorCodigo.value)) {
      establecerEstadoRenderizado('La orientación solo aplica a diagramas de flujo', 'error');
      return;
    }
    ELEMENTOS.editorCodigo.value = DiagramStyler.alternarOrientacionDeFlujo(ELEMENTOS.editorCodigo.value);
    actualizarEstadisticasYNumeros();
    guardarDiagramaActivoSilencioso();
    estado.ajusteAutomaticoDelLienzo = true;
    ejecutarRenderizado();
    actualizarEstadoDeAlmacenamiento();
    establecerEstadoRenderizado('Orientación alternada', 'exito');
    const orientacion = /^(flowchart|graph)\s+(LR|RL)\b/m.test(ELEMENTOS.editorCodigo.value)
      ? 'Horizontal (LR)'
      : 'Vertical (TD)';
    notificarExitoDeAccion(`Diagrama reorientado a ${orientacion}`);
  }

  /** Eventos de paneo y zoom del lienzo. */
  function registrarEventosDeLienzo() {
    ELEMENTOS.botonAcercar?.addEventListener('click', () => ajustarZoomConFactor(PASO_ZOOM));
    ELEMENTOS['btn-zoom-in']?.addEventListener('click', () => ajustarZoomConFactor(PASO_ZOOM));
    ELEMENTOS.botonAlejar?.addEventListener('click', () => ajustarZoomConFactor(1 / PASO_ZOOM));
    ELEMENTOS['btn-zoom-out']?.addEventListener('click', () => ajustarZoomConFactor(1 / PASO_ZOOM));
    ELEMENTOS.botonZoom100?.addEventListener('click', () => {
      marcarVistaAjustadaManualmente();
      estado.zoom = 1;
      centrarDiagramaEnLienzo();
      notificarExitoDeAccion('Vista restablecida al 100%');
    });
    ELEMENTOS['zoom-level-text']?.addEventListener('click', () => {
      marcarVistaAjustadaManualmente();
      estado.zoom = 1;
      centrarDiagramaEnLienzo();
    });
    ELEMENTOS['btn-zoom-reset']?.addEventListener('click', () => {
      marcarVistaAjustadaManualmente();
      estado.zoom = 1;
      centrarDiagramaEnLienzo();
      notificarExitoDeAccion('Vista restablecida al 100%');
    });
    ELEMENTOS.botonCentrar?.addEventListener('click', () => {
      marcarVistaAjustadaManualmente();
      centrarDiagramaEnLienzo();
    });
    ELEMENTOS.botonAjustar?.addEventListener('click', () => {
      estado.ajusteAutomaticoDelLienzo = true;
      ajustarDiagramaAlLienzo();
      notificarExitoDeAccion('Diagrama centrado y ajustado al lienzo');
    });
    ELEMENTOS['btn-fit-screen']?.addEventListener('click', () => {
      estado.ajusteAutomaticoDelLienzo = true;
      ajustarDiagramaAlLienzo();
      notificarExitoDeAccion('Diagrama centrado y ajustado al lienzo');
    });

    ELEMENTOS['btn-fullscreen']?.addEventListener('click', () => {
      if (estado.modoPresentacion) {
        salirDePantallaCompleta();
        establecerModoPresentacion(false);
        return;
      }
      establecerModoPresentacion(true);
      solicitarPantallaCompleta();
      notificarExitoDeAccion('Modo presentación activado (Presiona Esc o F10 para salir)');
    });
    ELEMENTOS.lienzo.addEventListener('pointerdown', iniciarPaneo);
    ELEMENTOS.lienzo.addEventListener('pointermove', moverPaneo);
    ELEMENTOS.lienzo.addEventListener('pointerup', finalizarPaneo);
    ELEMENTOS.lienzo.addEventListener('pointercancel', finalizarPaneo);
    ELEMENTOS.lienzo.addEventListener('wheel', manejarRuedaDeZoom, { passive: false });
  }

  /** Eventos de exportación. */
  function registrarEventosDeExportacion() {
    ELEMENTOS.exportarSvg.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoSvg(svg, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()), {
      mensajeExito: 'Archivo SVG descargado en ultra alta definición'
    }));

    ELEMENTOS.exportarPng1x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 1, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()), {
      mensajeExito: 'Archivo PNG 1x descargado'
    }));

    ELEMENTOS.exportarPng2x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 2, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()), {
      cargando: true,
      mensajeExito: 'Archivo PNG 2x descargado en ultra alta definición'
    }));

    ELEMENTOS.exportarPng4x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 4, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()), {
      cargando: true,
      mensajeExito: 'Archivo PNG 4x descargado en ultra alta definición'
    }));

    ELEMENTOS.exportarPdf.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPdf(svg, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()), {
      cargando: true,
      mensajeExito: 'Archivo PDF vectorial descargado en ultra alta definición'
    }));

    ELEMENTOS.exportarCodigoMmd.addEventListener('click', () => {
      Exporter.exportarCodigoFuente(ELEMENTOS.editorCodigo.value, obtenerNombreBaseArchivo());
      establecerEstadoRenderizado('Código .mmd exportado', 'exito');
      notificarExitoDeAccion('Código fuente exportado (.mmd)');
    });

    ELEMENTOS.copiarCodigo.addEventListener('click', () => ejecutarCopiaProtegida(
      () => Exporter.copiarCodigoFuenteAlPortapapeles(ELEMENTOS.editorCodigo.value),
      'Código Mermaid copiado al portapapeles'
    ));

    ELEMENTOS.copiarSvg.addEventListener('click', () => exportarConSvg(
      (svg) => Exporter.copiarSvgAlPortapapeles(svg),
      { mensajeExito: 'Vector SVG copiado al portapapeles' }
    ));

    ELEMENTOS.copiarPng.addEventListener('click', () => exportarConSvg(
      (svg) => Exporter.copiarPngAlPortapapeles(svg, construirOpcionesDeExportacion()),
      { mensajeExito: 'Imagen PNG copiada al portapapeles' }
    ));

    ELEMENTOS.interruptorMarcaDeAgua.addEventListener('change', (evento) => {
      estado.marcaDeAguaActiva = evento.target.checked;
      guardarPreferenciasEnConfiguracion();
      if (Alerts && typeof Alerts.notificarInfo === 'function') {
        Alerts.notificarInfo(estado.marcaDeAguaActiva
          ? 'Marca de agua activada en las exportaciones'
          : 'Marca de agua desactivada');
      }
    });

    ELEMENTOS.autorMarcaDeAgua.addEventListener('input', (evento) => {
      estado.autorMarcaDeAgua = evento.target.value;
      guardarPreferenciasEnConfiguracion();
    });

    if (ELEMENTOS.abrirModalExportacion) {
      ELEMENTOS.abrirModalExportacion.addEventListener('click', () => {
        ExportDialog.abrirDialogoDeExportacion();
      });
    }
  }

  /** Galería de plantillas. */
  function registrarEventosDePlantillas() {
    ELEMENTOS.botonAbrirGaleriaPlantillas.addEventListener('click', () =>
      bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalPlantillas).show());
  }

  /** Respaldo JSON. */
  function registrarEventosDeRespaldo() {
    ELEMENTOS.botonAbrirRespaldo.addEventListener('click', () => {
      ELEMENTOS.mensajeRespaldo.textContent = '';
      bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalRespaldo).show();
    });
    ELEMENTOS.botonExportarRespaldo.addEventListener('click', exportarRespaldoJson);
    ELEMENTOS.entradaImportarRespaldo.addEventListener('change', importarRespaldoJson);
  }

  /** Portal de documentación. */
  function registrarEventosDeDocumentacion() {
    ELEMENTOS.botonAbrirDocumentacion.addEventListener('click', () => {
      DocsViewer.refrescarMetricasDeAlmacenamiento();
      bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalDocumentacion).show();
    });
    const botonEjemploIconos = document.getElementById('docsCargarEjemploIconos');
    if (botonEjemploIconos) {
      botonEjemploIconos.addEventListener('click', () => DocsViewer.cargarEjemploIconos());
    }
  }

  /** Tema claro/oscuro y sidebar. */
  function registrarEventosDeTemaYSidebar() {
    ELEMENTOS.botonModoOscuro.addEventListener('click', () => {
      estado.modoOscuro = !estado.modoOscuro;
      estado.gestorDeArchivos.actualizarConfiguracion({ tema: estado.modoOscuro ? 'dark' : 'light' });
      aplicarTemaVisual();
      aplicarCambioDePaleta();
      notificarExitoDeAccion(estado.modoOscuro ? 'Modo oscuro activado' : 'Modo claro activado');
    });

    ELEMENTOS.botonToggleSidebar.addEventListener('click', alternarSidebar);
    window.addEventListener('resize', sincronizarSidebarConViewport);
  }

  /**
   * Adapta la visibilidad del explorador al tamaño de la ventana: en pantallas
   * pequeñas (≤ 991px) se presenta como superposición y se oculta por defecto,
   * de modo que no tape el editor al cargar.
   */
  function sincronizarSidebarConViewport() {
    const esViewportPequeno = window.innerWidth <= 991;
    if (estado.viewportPequeno === esViewportPequeno) {
      return;
    }
    if (esViewportPequeno) {
      ELEMENTOS.sidebar.classList.add('colapsado');
    } else if (estado.viewportPequeno === true) {
      ELEMENTOS.sidebar.classList.remove('colapsado');
    }
    estado.viewportPequeno = esViewportPequeno;
  }

  /** Divisor redimensionable. */
  function registrarEventoDelSeparador() {
    const iniciarArrastre = (evento) => {
      if (window.innerWidth <= 768) {
        return;
      }
      evento.preventDefault();
      ELEMENTOS.separadorPaneles.classList.add('arrastrando');

      const mover = (eventoMovimiento) => {
        const rectangulo = ELEMENTOS.panelEditor.parentElement.getBoundingClientRect();
        const anchoRelativo = ((eventoMovimiento.clientX - rectangulo.left) / rectangulo.width) * 100;
        ELEMENTOS.panelEditor.style.width = `${Math.min(75, Math.max(20, anchoRelativo))}%`;
      };
      const soltar = () => {
        ELEMENTOS.separadorPaneles.classList.remove('arrastrando');
        document.removeEventListener('pointermove', mover);
        document.removeEventListener('pointerup', soltar);
      };

      document.addEventListener('pointermove', mover);
      document.addEventListener('pointerup', soltar);
    };
    ELEMENTOS.separadorPaneles.addEventListener('pointerdown', iniciarArrastre);
  }

  // ==========================================================================
  // Módulos extendidos: atajos, historial, minimapa, búsqueda y presentación
  // ==========================================================================

  /** Inicializa los módulos opcionales de la actualización técnica. */
  function inicializarModulosExtendidos() {
    if (HistoryManager && typeof HistoryManager.inicializarGestorDeHistorial === 'function') {
      HistoryManager.inicializarGestorDeHistorial({
        gestorDeArchivos: estado.gestorDeArchivos,
        elementos: {
          modalHistorial: ELEMENTOS.modalHistorial,
          listaHistorial: ELEMENTOS.listaHistorial,
          nombreArchivoHistorial: ELEMENTOS.nombreArchivoHistorial
        },
        alRestaurarVersion: restaurarVersionEnEditor
      });
    }
    if (Minimap) {
      Minimap.inicializarMinimapa({
        elementos: {
          minimapa: ELEMENTOS.minimapa,
          minimapaContenido: ELEMENTOS.minimapaContenido,
          minimapaViewport: ELEMENTOS.minimapaViewport
        },
        obtenerVista: obtenerVistaParaMinimapa,
        alDesplazarVista: moverVistaDesdeMinimapa
      });
    }
    if (FindReplace) {
      FindReplace.inicializarBuscadorDeTexto({
        editor: ELEMENTOS.editorCodigo,
        elementos: {
          barraBusqueda: ELEMENTOS.barraBusqueda,
          entradaBuscar: ELEMENTOS.entradaBuscar,
          entradaReemplazar: ELEMENTOS.entradaReemplazar,
          contadorCoincidencias: ELEMENTOS.contadorCoincidencias,
          botonBuscarSiguiente: ELEMENTOS.botonBuscarSiguiente,
          botonBuscarAnterior: ELEMENTOS.botonBuscarAnterior,
          botonReemplazar: ELEMENTOS.botonReemplazar,
          botonReemplazarTodo: ELEMENTOS.botonReemplazarTodo,
          botonCerrarBusqueda: ELEMENTOS.botonCerrarBusqueda,
          filaReemplazo: ELEMENTOS.filaReemplazo
        }
      });
    }
  }

  /** Aplica al arranque las preferencias persistidas de los módulos extendidos. */
  function aplicarPreferenciasDeModulosExtendidos() {
    ELEMENTOS.interruptorMarcaDeAgua.checked = estado.marcaDeAguaActiva;
    ELEMENTOS.autorMarcaDeAgua.value = estado.autorMarcaDeAgua;
    if (estado.minimapaVisible && Minimap) {
      Minimap.establecerVisibilidadDelMinimapa(true);
      ELEMENTOS.botonMinimapa.classList.add('activo');
    }
    if (ExportDialog && typeof ExportDialog.inicializarDialogoDeExportacion === 'function') {
      ExportDialog.inicializarDialogoDeExportacion({
        elementos: {
          modal: ELEMENTOS.modalExportacion,
          selectorFormato: ELEMENTOS.selectorFormatoExportacion,  // compatibility
          formato: ELEMENTOS.selectorFormatoExportacion,
          selectorResolucion: ELEMENTOS.selectorResolucionExportacion, resolucion: ELEMENTOS.selectorResolucionExportacion,
          interruptorPieDePagina: ELEMENTOS.interruptorPieDePagina, pieDePagina: ELEMENTOS.interruptorPieDePagina,
          botonConfirmar: ELEMENTOS.botonConfirmarExportacion, confirmar: ELEMENTOS.botonConfirmarExportacion,
          filaResolucion: ELEMENTOS.filaResolucionExportacion,
          resumen: ELEMENTOS.resumenExportacion
        },
        alConfirmar: ejecutarExportacionSeleccionada
      });
    }
    if (CanvasViewport && typeof CanvasViewport.inicializarViewport === 'function') {
      CanvasViewport.inicializarViewport({
        canvasContainer: ELEMENTOS.lienzo || ELEMENTOS.contenidoLienzo,
        contenidoLienzo: ELEMENTOS.contenidoLienzo,
        canvasViewport: ELEMENTOS.contenidoLienzo || ELEMENTOS.lienzo,
        vincularControles: false
      });
    }
  }

  /** Construye el mapa de acciones consumido por el sistema de atajos. */
  function construirAccionesDeAtajos() {
    return {
      guardar: guardarDiagramaDesdeBoton,
      guardarComo: abrirModalGuardarComo,
      abrirExplorador: alternarSidebar,
      alternarSidebar,
      nuevoDiagrama: crearNuevoDiagrama,
      exportarSvg: exportarSvgRapido,
      historial: abrirHistorialDeVersiones,
      buscar: () => abrirBusqueda(false),
      buscarYReemplazar: () => abrirBusqueda(true),
      comentarLineas: comentarDescomentarLineas,
      deshacer: deshacerEnEditor,
      rehacer: rehacerEnEditor,
      acercar: () => ajustarZoomConFactor(PASO_ZOOM),
      alejar: () => ajustarZoomConFactor(1 / PASO_ZOOM),
      restablecerZoom: restablecerZoomAlCien,
      alternarMinimapa,
      modoPresentacion: alternarModoPresentacion,
      mostrarAtajos: abrirModalDeAtajos,
      cerrarSuperposiciones
    };
  }

  /** Registra los atajos de teclado globales. */
  function registrarAtajosDeTeclado() {
    if (!KeyboardShortcuts) {
      return;
    }
    KeyboardShortcuts.inicializarAtajosDeTeclado({
      acciones: construirAccionesDeAtajos(),
      elementos: {
        editorCodigo: ELEMENTOS.editorCodigo,
        modalAtajos: ELEMENTOS.modalAtajos,
        listaAtajos: ELEMENTOS.listaAtajos
      }
    });
  }

  /** Botón de la barra superior para abrir la búsqueda. */
  function registrarEventosDeBusqueda() {
    ELEMENTOS.botonBuscar.addEventListener('click', () => abrirBusqueda(false));
  }

  /**
   * Abre la barra de búsqueda y reemplazo.
   * @param {boolean} mostrarReemplazo
   */
  function abrirBusqueda(mostrarReemplazo) {
    if (FindReplace && typeof FindReplace.abrirPanelDeBusqueda === 'function') {
      FindReplace.abrirPanelDeBusqueda({ mostrarReemplazo });
    }
  }

  /** Eventos del historial de versiones. */
  function registrarEventosDeHistorial() {
    if (ELEMENTOS.botonHistorial) {
      ELEMENTOS.botonHistorial.addEventListener('click', abrirHistorialDeVersiones);
    }
    if (ELEMENTOS.botonLimpiarHistorial) {
      ELEMENTOS.botonLimpiarHistorial.addEventListener('click', () => {
        if (HistoryManager) {
          HistoryManager.limpiarHistorial();
        }
        establecerEstadoRenderizado('Historial vaciado', 'exito');
        notificarExitoDeAccion('Historial de versiones vaciado');
      });
    }
  }

  /** Abre el panel de historial del diagrama activo. */
  function abrirHistorialDeVersiones() {
    if (HistoryManager) {
      HistoryManager.abrirPanelDeHistorial();
    }
  }

  /** Refresca el panel de historial si el módulo está disponible. */
  function refrescarHistorialDeVersiones() {
    if (HistoryManager) {
      HistoryManager.refrescarPanelDeHistorial();
    }
  }

  /**
   * Restaura una versión histórica en el editor y la re-renderiza.
   * @param {Object} archivo
   * @param {string} codigo
   */
  function restaurarVersionEnEditor(archivo, codigo) {
    ELEMENTOS.editorCodigo.value = codigo;
    ELEMENTOS.nombreArchivoActivo.textContent = archivo.nombre;
    actualizarEstadisticasYNumeros();
    estado.ajusteAutomaticoDelLienzo = true;
    ejecutarRenderizado();
    actualizarEstadoDeAlmacenamiento();
    establecerEstadoRenderizado('Versión restaurada', 'exito');
    // Guardar la versión restaurada como el estado actual
    guardarDiagramaActivoSilencioso();
    notificarExitoDeAccion('Versión del historial restaurada en el editor');
  }

  /** Eventos del minimapa. */
  function registrarEventosDeMinimapa() {
    ELEMENTOS.botonMinimapa.addEventListener('click', alternarMinimapa);
    ELEMENTOS.botonCerrarMinimapa.addEventListener('click', () => establecerMinimapaVisible(false));
  }

  /** Alterna la visibilidad del minimapa. */
  function alternarMinimapa() {
    establecerMinimapaVisible(!estado.minimapaVisible);
  }

  /**
   * Fija la visibilidad del minimapa y sincroniza el estado del botón.
   * @param {boolean} visible
   */
  function establecerMinimapaVisible(visible) {
    estado.minimapaVisible = Boolean(visible);
    if (Minimap) {
      Minimap.establecerVisibilidadDelMinimapa(estado.minimapaVisible);
    }
    ELEMENTOS.botonMinimapa.classList.toggle('activo', estado.minimapaVisible);
    guardarPreferenciasEnConfiguracion();
    if (Alerts && typeof Alerts.notificarInfo === 'function') {
      Alerts.notificarInfo(estado.minimapaVisible ? 'Minimapa visible' : 'Minimapa oculto');
    }
  }

  /** @returns {Object} datos de vista que alimentan al minimapa. */
  function obtenerVistaParaMinimapa() {
    const dimensiones = obtenerDimensionesDelDiagrama();
    return {
      elementoSvg: dimensiones ? dimensiones.svg : null,
      anchoDiagrama: dimensiones ? dimensiones.ancho : 0,
      altoDiagrama: dimensiones ? dimensiones.alto : 0,
      anchoLienzo: ELEMENTOS.lienzo.clientWidth,
      altoLienzo: ELEMENTOS.lienzo.clientHeight,
      zoom: estado.zoom,
      desplazamientoX: estado.desplazamientoX,
      desplazamientoY: estado.desplazamientoY
    };
  }

  /**
   * Desplaza la vista principal, invocada desde el minimapa.
   * @param {number} x
   * @param {number} y
   */
  function moverVistaDesdeMinimapa(x, y) {
    marcarVistaAjustadaManualmente();
    estado.desplazamientoX = x;
    estado.desplazamientoY = y;
    aplicarTransformacionDelContenido();
  }

  /** Sincroniza el minimapa cuando está visible. */
  function sincronizarMinimapa() {
    if (Minimap && estado.minimapaVisible) {
      Minimap.actualizarMinimapa();
    }
  }

  /** Eventos del modo presentación. */
  function registrarEventosDePresentacion() {
    ELEMENTOS.botonPresentacion.addEventListener('click', alternarModoPresentacion);
    ELEMENTOS.botonSalirPresentacion?.addEventListener('click', () => {
      salirDePantallaCompleta();
      establecerModoPresentacion(false);
    });
    document.addEventListener('fullscreenchange', sincronizarModoPresentacionConPantallaCompleta);
  }

  /** Alterna el modo presentación. */
  function alternarModoPresentacion() {
    if (estado.modoPresentacion) {
      salirDePantallaCompleta();
      establecerModoPresentacion(false);
      return;
    }
    establecerModoPresentacion(true);
  }

  /** Solicita pantalla completa sobre el lienzo, si el navegador lo permite. */
  function solicitarPantallaCompleta() {
    const contenedor = ELEMENTOS.lienzo;
    if (contenedor && typeof contenedor.requestFullscreen === 'function' && !document.fullscreenElement) {
      contenedor.requestFullscreen().catch(() => {
        /* El navegador puede rechazarlo; el modo presentación ya cubre el caso. */
      });
    }
  }

  /** Sale de la pantalla completa nativa si está activa. */
  function salirDePantallaCompleta() {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => { /* sin pantalla completa activa */ });
    }
  }

  /**
   * Mantiene coherente el estado al entrar o salir de la pantalla completa
   * nativa: si el usuario pulsa Esc, la barra de presentación debe desaparecer.
   */
  function sincronizarModoPresentacionConPantallaCompleta() {
    if (!document.fullscreenElement && estado.modoPresentacion) {
      establecerModoPresentacion(false);
      return;
    }
    if (document.fullscreenElement && !estado.modoPresentacion) {
      establecerModoPresentacion(true);
    }
  }

  /**
   * Activa o desactiva el modo presentación (oculta paneles y reencuadra).
   * @param {boolean} activo
   */
  function establecerModoPresentacion(activo) {
    estado.modoPresentacion = Boolean(activo);
    document.body.classList.toggle('modo-presentacion', estado.modoPresentacion);
    ELEMENTOS.barraPresentacion.hidden = !estado.modoPresentacion;
    ELEMENTOS.botonPresentacion.classList.toggle('activo', estado.modoPresentacion);

    // Al ocultar los paneles el lienzo cambia de tamaño; se reencuadra tras el layout.
    const reencuadrar = () => {
      estado.ajusteAutomaticoDelLienzo = true;
      ajustarDiagramaAlLienzo();
      sincronizarMinimapa();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(reencuadrar);
    } else {
      setTimeout(reencuadrar, 0);
    }
  }

  /** Cierra la superposición activa (búsqueda o presentación). */
  function cerrarSuperposiciones() {
    if (FindReplace && FindReplace.estaElPanelVisible()) {
      FindReplace.cerrarPanelDeBusqueda();
      return;
    }
    if (estado.modoPresentacion) {
      salirDePantallaCompleta();
      establecerModoPresentacion(false);
    }
  }

  /** Eventos de la hoja de referencia de atajos. */
  function registrarEventosDeAtajos() {
    ELEMENTOS.botonAtajos.addEventListener('click', abrirModalDeAtajos);
  }

  /** Abre la referencia de atajos de teclado. */
  function abrirModalDeAtajos() {
    if (KeyboardShortcuts) {
      KeyboardShortcuts.abrirModalDeAtajosDeTeclado();
    }
  }

  /** Monitor de estado de conectividad (offline / online). */
  function registrarEventosDeConexion() {
    window.addEventListener('offline', () => {
      if (Alerts && typeof Alerts.notificarAdvertencia === 'function') {
        Alerts.notificarAdvertencia('Sin conexión a Internet: modo offline activado. Tus diagramas se guardan localmente.');
      }
    });
    window.addEventListener('online', () => {
      if (Alerts && typeof Alerts.notificarExito === 'function') {
        Alerts.notificarExito('Conexión reestablecida.');
      }
    });
  }

  /** Restablece el zoom al 100 % manteniendo el centro. */
  function restablecerZoomAlCien() {
    marcarVistaAjustadaManualmente();
    estado.zoom = 1;
    centrarDiagramaEnLienzo();
    sincronizarMinimapa();
    notificarExitoDeAccion('Vista restablecida al 100%');
  }

  /** Exporta rápidamente el diagrama como SVG vectorial. */
  function exportarSvgRapido() {
    exportarConSvg((svg) =>
      Exporter.exportarComoSvg(svg, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion()));
  }

  /** Comenta o descomenta las líneas seleccionadas con la sintaxis `%%`. */
  function comentarDescomentarLineas() {
    const editor = ELEMENTOS.editorCodigo;
    const valor = editor.value;
    const inicioSeleccion = editor.selectionStart;
    const finSeleccion = editor.selectionEnd;

    const inicioDeLinea = valor.lastIndexOf('\n', inicioSeleccion - 1) + 1;
    const finDeLineaEncontrado = valor.indexOf('\n', finSeleccion);
    const finDeLinea = finDeLineaEncontrado === -1 ? valor.length : finDeLineaEncontrado;

    const lineas = valor.slice(inicioDeLinea, finDeLinea).split('\n');
    const todasComentadas = lineas.every((linea) => linea.trim() === '' || linea.trimStart().startsWith('%%'));

    const lineasTransformadas = lineas.map((linea) => {
      if (linea.trim() === '') {
        return linea;
      }
      if (todasComentadas) {
        return linea.replace(/^(\s*)%%\s?/, '$1');
      }
      return `${PREFIJO_COMENTARIO_MERMAID}${linea}`;
    });

    const nuevoBloque = lineasTransformadas.join('\n');
    editor.value = valor.slice(0, inicioDeLinea) + nuevoBloque + valor.slice(finDeLinea);
    editor.setSelectionRange(inicioDeLinea, inicioDeLinea + nuevoBloque.length);
    actualizarEstadisticasYNumeros();
    guardarDiagramaActivoSilencioso();
    programarRenderizado();
  }

  /** Deshace el último cambio del editor delegando en el historial nativo. */
  function deshacerEnEditor() {
    if (document.execCommand) {
      document.execCommand('undo');
    }
  }

  /** Rehace el último cambio del editor delegando en el historial nativo. */
  function rehacerEnEditor() {
    if (document.execCommand) {
      document.execCommand('redo');
    }
  }

  // ==========================================================================
  // Explorador de archivos
  // ==========================================================================

  /**
   * Construye el árbol de carpetas y archivos en el explorador.
   */
  function renderizarArbolDeArchivos() {
    const contenedor = ELEMENTOS.arbolArchivos;
    contenedor.innerHTML = '';

    const carpetas = [...estado.gestorDeArchivos.obtenerCarpetas()].sort(
      (carpetaA, carpetaB) => (carpetaB.esRaiz ? 1 : 0) - (carpetaA.esRaiz ? 1 : 0) ||
        carpetaA.nombre.localeCompare(carpetaB.nombre)
    );

    carpetas.forEach((carpeta) => contenedor.appendChild(construirNodoDeCarpeta(carpeta)));
  }

  /**
   * Construye el nodo DOM de una carpeta con sus archivos.
   * @param {Object} carpeta
   * @returns {HTMLElement}
   */
  function construirNodoDeCarpeta(carpeta) {
    const estaExpandida = estado.carpetasExpandidas.has(carpeta.id) || carpeta.esRaiz;
    const nodo = document.createElement('div');
    nodo.className = `arbol-carpeta${estaExpandida ? '' : ' oculta'}`;
    nodo.dataset.id = carpeta.id;

    const cabecera = document.createElement('div');
    cabecera.className = 'arbol-carpeta__cabecera';

    const icono = document.createElement('span');
    icono.className = 'material-symbols-outlined';
    icono.textContent = estaExpandida ? 'folder_open' : 'folder';

    const nombre = document.createElement('span');
    nombre.className = 'arbol__nombre';
    nombre.textContent = carpeta.nombre;

    cabecera.append(icono, nombre, construirAccionesDeCarpeta(carpeta));
    cabecera.addEventListener('click', () => alternarExpansionDeCarpeta(carpeta.id, nodo, icono));

    const hijos = document.createElement('div');
    hijos.className = 'arbol-carpeta__hijos';
    const archivos = estado.gestorDeArchivos.obtenerArchivosDeCarpeta(carpeta.id);
    if (archivos.length === 0) {
      const vacio = document.createElement('div');
      vacio.className = 'arbol-vacio';
      vacio.textContent = 'Carpeta vacía';
      hijos.appendChild(vacio);
    } else {
      archivos.forEach((archivo) => hijos.appendChild(construirNodoDeArchivo(archivo)));
    }

    nodo.append(cabecera, hijos);
    return nodo;
  }

  /**
   * Construye los botones de renombrar/eliminar de una carpeta.
   * @param {Object} carpeta
   * @returns {HTMLElement}
   */
  function construirAccionesDeCarpeta(carpeta) {
    const acciones = document.createElement('span');
    acciones.className = 'arbol__acciones';

    acciones.appendChild(crearBotonArbol('edit', 'Renombrar carpeta', (evento) => {
      evento.stopPropagation();
      solicitarRenombrarCarpeta(carpeta);
    }));

    if (!carpeta.esRaiz) {
      acciones.appendChild(crearBotonArbol('delete', 'Eliminar carpeta', (evento) => {
        evento.stopPropagation();
        eliminarCarpetaConConfirmacion(carpeta);
      }));
    }
    return acciones;
  }

  /**
   * Construye el nodo DOM de un archivo.
   * @param {Object} archivo
   * @returns {HTMLElement}
   */
  function construirNodoDeArchivo(archivo) {
    const estaActivo = archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo();
    const nodo = document.createElement('div');
    nodo.className = `arbol-archivo${estaActivo ? ' activo' : ''}`;
    nodo.dataset.id = archivo.id;

    const icono = document.createElement('span');
    icono.className = 'material-symbols-outlined';
    icono.textContent = 'description';

    const nombre = document.createElement('span');
    nombre.className = 'arbol__nombre';
    nombre.textContent = archivo.nombre;

    nodo.append(icono, nombre, construirAccionesDeArchivo(archivo));
    nodo.addEventListener('click', () => abrirArchivo(archivo.id));
    return nodo;
  }

  /**
   * Construye los botones de renombrar/eliminar de un archivo.
   * @param {Object} archivo
   * @returns {HTMLElement}
   */
  function construirAccionesDeArchivo(archivo) {
    const acciones = document.createElement('span');
    acciones.className = 'arbol__acciones';

    acciones.appendChild(crearBotonArbol('edit', 'Renombrar', (evento) => {
      evento.stopPropagation();
      solicitarRenombrarArchivo(archivo);
    }));
    acciones.appendChild(crearBotonArbol('delete', 'Eliminar', (evento) => {
      evento.stopPropagation();
      eliminarArchivoConConfirmacion(archivo);
    }));
    return acciones;
  }

  /**
   * Crea un botón de acción del árbol.
   * @param {string} icono
   * @param {string} titulo
   * @param {(evento:Event)=>void} manejador
   * @returns {HTMLElement}
   */
  function crearBotonArbol(icono, titulo, manejador) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-arbol';
    boton.title = titulo;
    boton.innerHTML = `<span class="material-symbols-outlined">${icono}</span>`;
    boton.addEventListener('click', manejador);
    return boton;
  }

  /**
   * Expande o contrae una carpeta en el árbol.
   * @param {string} carpetaId
   * @param {HTMLElement} nodo
   * @param {HTMLElement} icono
   */
  function alternarExpansionDeCarpeta(carpetaId, nodo, icono) {
    const estaOculta = nodo.classList.toggle('oculta');
    icono.textContent = estaOculta ? 'folder' : 'folder_open';
    if (estaOculta) {
      estado.carpetasExpandidas.delete(carpetaId);
    } else {
      estado.carpetasExpandidas.add(carpetaId);
    }
  }

  /**
   * Abre un archivo en el editor tras guardar el actual.
   * @param {string} archivoId
   */
  function abrirArchivo(archivoId) {
    if (archivoId !== estado.gestorDeArchivos.obtenerIdArchivoActivo()) {
      guardarDiagramaActivoSilencioso();
    }
    estado.gestorDeArchivos.establecerArchivoActivo(archivoId);
    abrirArchivoActivo();
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    ejecutarRenderizado();
  }

  /**
   * Vuelca el archivo activo en el editor.
   */
  function abrirArchivoActivo() {
    const archivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    if (!archivo) {
      return;
    }
    ELEMENTOS.editorCodigo.value = archivo.codigo;
    ELEMENTOS.nombreArchivoActivo.textContent = archivo.nombre;
    actualizarEstadisticasYNumeros();
    estado.ajusteAutomaticoDelLienzo = true;
  }

  /** Guarda el contenido actual sin cambiar el estado visual. */
  function guardarDiagramaActivoSilencioso() {
    if (estado.gestorDeArchivos.obtenerIdArchivoActivo()) {
      estado.gestorDeArchivos.guardarDiagramaActual(ELEMENTOS.editorCodigo.value);
    }
  }

  /** Manejador del botón Guardar. */
  function guardarDiagramaDesdeBoton() {
    const resultado = estado.gestorDeArchivos.guardarDiagramaActual(ELEMENTOS.editorCodigo.value);
    if (resultado.exito) {
      establecerEstadoRenderizado('Diagrama guardado', 'exito');
      actualizarEstadoDeAlmacenamiento();
      refrescarHistorialDeVersiones();
      const archivo = estado.gestorDeArchivos.obtenerArchivoActivo();
      const carpeta = archivo ? estado.gestorDeArchivos.obtenerCarpetaPorId(archivo.carpetaId) : null;
      const nombreCarpeta = carpeta ? carpeta.nombre : 'la raíz';
      notificarExitoDeAccion(`Diagrama guardado exitosamente en '${nombreCarpeta}'`);
    } else {
      establecerEstadoRenderizado(resultado.mensajeError || 'No se pudo guardar', 'error');
      notificarErrorDeAccion('No se pudo guardar', resultado.mensajeError);
    }
  }

  /** Solicita el nombre de una carpeta nueva mediante SweetAlert2. */
  async function solicitarNuevaCarpeta() {
    const nombre = await solicitarNombreConSweetAlert('Nueva carpeta', 'Nombre de la carpeta', '', 'Crear carpeta');
    if (nombre === null) {
      return;
    }
    const resultado = estado.gestorDeArchivos.crearCarpeta(nombre);
    if (!resultado.exito) {
      notificarErrorDeAccion('No se pudo crear la carpeta', resultado.mensajeError);
      return;
    }
    estado.carpetasExpandidas.add(resultado.carpeta.id);
    renderizarArbolDeArchivos();
    notificarExitoDeAccion(`Carpeta '${resultado.carpeta.nombre}' creada con éxito`);
  }

  /** Renombra una carpeta. */
  async function solicitarRenombrarCarpeta(carpeta) {
    const nombre = await solicitarNombreConSweetAlert('Renombrar carpeta', 'Nuevo nombre', carpeta.nombre, 'Renombrar');
    if (nombre === null) {
      return;
    }
    const resultado = estado.gestorDeArchivos.renombrarCarpeta(carpeta.id, nombre);
    if (!resultado.exito) {
      notificarErrorDeAccion('No se pudo renombrar la carpeta', resultado.mensajeError);
      return;
    }
    renderizarArbolDeArchivos();
    notificarExitoDeAccion(`Carpeta '${nombre.trim()}' renombrada con éxito`);
  }

  /** Renombra un archivo. */
  async function solicitarRenombrarArchivo(archivo) {
    const nombre = await solicitarNombreConSweetAlert('Renombrar diagrama', 'Nuevo nombre', archivo.nombre, 'Renombrar');
    if (nombre === null) {
      return;
    }
    const resultado = estado.gestorDeArchivos.renombrarArchivo(archivo.id, nombre);
    if (!resultado.exito) {
      notificarErrorDeAccion('No se pudo renombrar el diagrama', resultado.mensajeError);
      return;
    }
    if (archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo()) {
      ELEMENTOS.nombreArchivoActivo.textContent = nombre.trim();
    }
    renderizarArbolDeArchivos();
    notificarExitoDeAccion(`Diagrama '${nombre.trim()}' renombrado con éxito`);
  }

  /**
   * Pide un nombre de texto con SweetAlert2 (sustituye al modal genérico).
   * @param {string} titulo
   * @param {string} etiqueta
   * @param {string} valorInicial
   * @param {string} textoConfirmar
   * @returns {Promise<string|null>}
   */
  async function solicitarNombreConSweetAlert(titulo, etiqueta, valorInicial, textoConfirmar) {
    if (!Alerts || typeof Alerts.solicitarTexto !== 'function') {
      return null;
    }
    const valor = await Alerts.solicitarTexto(titulo, etiqueta, valorInicial, {
      requerido: true,
      confirmarTexto: textoConfirmar
    });
    return valor === null ? null : valor.trim();
  }

  /** Elimina una carpeta previa confirmación con SweetAlert2. */
  async function eliminarCarpetaConConfirmacion(carpeta) {
    const confirmado = Alerts && typeof Alerts.confirmarAccion === 'function'
      ? await Alerts.confirmarAccion(
        `¿Eliminar la carpeta '${carpeta.nombre}'?`,
        'Los diagramas contenidos se moverán a la raíz. Esta acción no se puede deshacer.',
        { confirmarTexto: 'Sí, eliminar' }
      )
      : true;
    if (!confirmado) {
      return;
    }
    const resultado = estado.gestorDeArchivos.eliminarCarpeta(carpeta.id);
    if (!resultado.exito) {
      establecerEstadoRenderizado(resultado.mensajeError, 'error');
      notificarErrorDeAccion('No se pudo eliminar la carpeta', resultado.mensajeError);
      return;
    }
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    notificarExitoDeAccion(`Carpeta '${carpeta.nombre}' eliminada correctamente`);
  }

  /** Elimina un archivo previa confirmación con SweetAlert2. */
  async function eliminarArchivoConConfirmacion(archivo) {
    const confirmado = Alerts && typeof Alerts.confirmarAccion === 'function'
      ? await Alerts.confirmarAccion(
        '¿Eliminar el diagrama?',
        `'${archivo.nombre}' se eliminará de forma permanente. Esta acción no se puede deshacer.`,
        { confirmarTexto: 'Sí, eliminar' }
      )
      : true;
    if (!confirmado) {
      return;
    }
    const eraActivo = archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo();
    const resultado = estado.gestorDeArchivos.eliminarArchivo(archivo.id);
    if (!resultado.exito) {
      establecerEstadoRenderizado(resultado.mensajeError, 'error');
      notificarErrorDeAccion('No se pudo eliminar el diagrama', resultado.mensajeError);
      return;
    }
    if (eraActivo) {
      abrirArchivoActivo();
      ejecutarRenderizado();
    }
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    notificarExitoDeAccion(`Diagrama '${archivo.nombre}' eliminado correctamente`);
  }

  /** Crea un diagrama nuevo en la carpeta del activo, avisando de cambios sin guardar. */
  async function crearNuevoDiagrama() {
    if (hayCambiosSinGuardar()) {
      const continuar = Alerts && typeof Alerts.confirmarAccion === 'function'
        ? await Alerts.confirmarAccion(
          '¿Descartar los cambios sin guardar?',
          'Se creará un diagrama nuevo y los cambios del editor que no hayas guardado se perderán.',
          { confirmarTexto: 'Crear diagrama nuevo' }
        )
        : true;
      if (!continuar) {
        return;
      }
    }
    const archivoActivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    const carpetaDestino = archivoActivo ? archivoActivo.carpetaId : estado.gestorDeArchivos.obtenerIdCarpetaRaiz();
    const archivoNuevo = estado.gestorDeArchivos.crearArchivo({
      nombre: 'Diagrama sin título',
      carpetaId: carpetaDestino,
      codigo: CODIGO_DIAGRAMA_INICIAL
    });
    estado.gestorDeArchivos.establecerArchivoActivo(archivoNuevo.id);
    abrirArchivoActivo();
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    ejecutarRenderizado();
    const carpeta = estado.gestorDeArchivos.obtenerCarpetaPorId(carpetaDestino);
    notificarExitoDeAccion(`Diagrama nuevo creado en '${carpeta ? carpeta.nombre : 'la raíz'}'`);
  }

  /**
   * Indica si el editor tiene cambios no persistidos respecto al archivo activo.
   * @returns {boolean}
   */
  function hayCambiosSinGuardar() {
    const archivoActivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    if (!archivoActivo) {
      return ELEMENTOS.editorCodigo.value.trim().length > 0;
    }
    return ELEMENTOS.editorCodigo.value !== archivoActivo.codigo;
  }

  // ==========================================================================
  // Modal Guardar como…
  // ==========================================================================

  /** Abre el modal "Guardar como…" con las carpetas disponibles. */
  function abrirModalGuardarComo() {
    const archivoActivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    ELEMENTOS.campoNombreArchivo.value = archivoActivo ? `${archivoActivo.nombre} (copia)` : 'Nuevo diagrama';
    ELEMENTOS.errorGuardarComo.textContent = '';

    ELEMENTOS.selectorCarpetaDestino.innerHTML = estado.gestorDeArchivos.obtenerCarpetas()
      .map((carpeta) => `<option value="${carpeta.id}">${carpeta.nombre}</option>`)
      .join('');
    if (archivoActivo) {
      ELEMENTOS.selectorCarpetaDestino.value = archivoActivo.carpetaId;
    }

    bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalGuardarComo).show();
  }

  /**
   * Confirma el guardado como nuevo archivo.
   * @param {SubmitEvent} evento
   */
  function confirmarGuardarComo(evento) {
    evento.preventDefault();
    const resultado = estado.gestorDeArchivos.guardarDiagramaComo(
      ELEMENTOS.campoNombreArchivo.value,
      ELEMENTOS.selectorCarpetaDestino.value,
      ELEMENTOS.editorCodigo.value
    );

    if (!resultado.exito) {
      ELEMENTOS.errorGuardarComo.textContent = resultado.mensajeError;
      return;
    }

    ELEMENTOS.errorGuardarComo.textContent = '';
    bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalGuardarComo).hide();
    ELEMENTOS.nombreArchivoActivo.textContent = resultado.archivo.nombre;
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    establecerEstadoRenderizado('Guardado como nuevo diagrama', 'exito');
    const carpetaDestino = estado.gestorDeArchivos.obtenerCarpetaPorId(resultado.archivo.carpetaId);
    notificarExitoDeAccion(
      `Diagrama guardado como '${resultado.archivo.nombre}' en '${carpetaDestino ? carpetaDestino.nombre : 'la raíz'}'`
    );
  }

  // ==========================================================================
  // Respaldo JSON
  // ==========================================================================

  /** Exporta el espacio de trabajo a un archivo JSON. */
  function exportarRespaldoJson() {
    const respaldo = estado.gestorDeArchivos.exportarEspacioDeTrabajoAJson();
    Exporter.descargarBlobComoArchivo(
      new Blob([respaldo.contenido], { type: 'application/json' }),
      respaldo.nombreArchivo
    );
    ELEMENTOS.mensajeRespaldo.textContent = 'Respaldo exportado correctamente.';
    notificarExitoDeAccion('Respaldo del espacio de trabajo exportado correctamente');
  }

  /**
   * Importa un respaldo JSON seleccionado por el usuario.
   * @param {Event} evento
   */
  function importarRespaldoJson(evento) {
    const archivoSeleccionado = evento.target.files && evento.target.files[0];
    if (!archivoSeleccionado) {
      return;
    }

    const lector = new FileReader();
    lector.onload = () => {
      const resultado = estado.gestorDeArchivos.importarEspacioDeTrabajoDesdeJson(String(lector.result));
      if (!resultado.exito) {
        ELEMENTOS.mensajeRespaldo.textContent = `Error: ${resultado.mensajeError}`;
        notificarErrorDeAccion('No se pudo importar el respaldo', resultado.mensajeError);
      } else {
        ELEMENTOS.mensajeRespaldo.textContent = 'Respaldo restaurado correctamente.';
        renderizarArbolDeArchivos();
        abrirArchivoActivo();
        actualizarEstadoDeAlmacenamiento();
        DocsViewer.refrescarMetricasDeAlmacenamiento();
        ejecutarRenderizado();
        notificarExitoDeAccion('Respaldo del espacio de trabajo restaurado correctamente');
      }
      ELEMENTOS.entradaImportarRespaldo.value = '';
    };
    lector.readAsText(archivoSeleccionado);
  }

  // ==========================================================================
  // Paleta y diseño
  // ==========================================================================

  /** Reconstruye la paleta actual a partir del estado. */
  function reconstruirPaletaActual() {
    estado.paleta = ColorAlgorithms.generarPaletaArmonica({
      matizBase: estado.matizBase,
      saturacionBase: estado.saturacionBase,
      tipoEsquema: estado.tipoEsquema,
      modoOscuro: estado.modoOscuro
    });
  }

  /** Aplica un cambio de paleta y re-renderiza. */
  function aplicarCambioDePaleta() {
    reconstruirPaletaActual();
    actualizarMuestraDePaleta();
    guardarPreferenciasEnConfiguracion();
    programarRenderizado();
  }

  /** Sincroniza los controles de diseño con el estado. */
  function sincronizarControlesDeDiseno() {
    ELEMENTOS.selectorArmonia.value = estado.tipoEsquema;
    ELEMENTOS.rangoSaturacion.value = String(estado.saturacionBase);
    ELEMENTOS.valorSaturacion.textContent = String(estado.saturacionBase);
    ELEMENTOS.entradaColorBase.value = ColorAlgorithms.convertirHslAHex({
      h: estado.matizBase,
      s: estado.saturacionBase,
      l: 50
    });
    ELEMENTOS.interruptorClasesEstilo.checked = estado.incluirClasesDeEstilo;
    actualizarMuestraDePaleta();
  }

  /** Dibuja la vista previa de la paleta. */
  function actualizarMuestraDePaleta() {
    const colores = [
      estado.paleta.colorPrimario,
      estado.paleta.colorSecundario,
      estado.paleta.colorTerciario,
      estado.paleta.colorLinea,
      estado.paleta.fondoAgrupador,
      estado.paleta.fondo
    ];
    ELEMENTOS.muestraPaleta.innerHTML = '';
    colores.forEach((color) => {
      const cuadro = document.createElement('span');
      cuadro.className = 'muestra-paleta__color';
      cuadro.style.backgroundColor = color;
      ELEMENTOS.muestraPaleta.appendChild(cuadro);
    });
  }

  /** Aplica el tema claro/oscuro al documento. */
  function aplicarTemaVisual() {
    document.documentElement.setAttribute('data-bs-theme', estado.modoOscuro ? 'dark' : 'light');
    ELEMENTOS.iconoModoOscuro.textContent = estado.modoOscuro ? 'light_mode' : 'dark_mode';
  }

  /** Alterna la visibilidad del explorador y la persiste. */
  function alternarSidebar() {
    const quedoColapsado = ELEMENTOS.sidebar.classList.toggle('colapsado');
    estado.gestorDeArchivos.actualizarConfiguracion({ sidebarVisible: !quedoColapsado });
  }

  /**
   * Combina el texto del editor con la directiva de tema de la paleta.
   * @param {string} codigoFuente
   * @returns {string}
   */
  function construirCodigoConDiseno(codigoFuente) {
    const variablesTema = DiagramStyler.construirVariablesTemaDesdePaleta(estado.paleta);
    return DiagramStyler.inyectarDirectivaInit(codigoFuente, variablesTema);
  }

  /** Materializa la directiva de tema y las clases en el editor. */
  function aplicarDisenoAlCodigo() {
    const variablesTema = DiagramStyler.construirVariablesTemaDesdePaleta(estado.paleta);
    let codigo = DiagramStyler.eliminarClasesDeEstiloEnFlujo(ELEMENTOS.editorCodigo.value);
    codigo = DiagramStyler.inyectarDirectivaInit(codigo, variablesTema);
    if (estado.incluirClasesDeEstilo) {
      codigo = DiagramStyler.inyectarClasesDeEstiloEnFlujo(codigo, estado.paleta);
    }
    ELEMENTOS.editorCodigo.value = codigo;
    actualizarEstadisticasYNumeros();
  }

  // ==========================================================================
  // Plantillas y snippets
  // ==========================================================================

  /** Construye la galería de plantillas. */
  function construirGaleriaDePlantillas() {
    ELEMENTOS.galeriaPlantillas.innerHTML = '';
    Templates.CATALOGO_DE_PLANTILLAS.forEach((plantilla) => {
      const tarjeta = document.createElement('button');
      tarjeta.type = 'button';
      tarjeta.className = 'tarjeta-plantilla';
      tarjeta.innerHTML =
        `<span class="material-symbols-outlined tarjeta-plantilla__icono">${plantilla.icono}</span>` +
        `<p class="tarjeta-plantilla__nombre">${plantilla.nombre}</p>` +
        `<p class="tarjeta-plantilla__descripcion">${plantilla.descripcion}</p>`;
      tarjeta.addEventListener('click', () => {
        cargarPlantillaComoNuevoDiagrama(plantilla);
        bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalPlantillas).hide();
      });
      ELEMENTOS.galeriaPlantillas.appendChild(tarjeta);
    });
  }

  /**
   * Crea un diagrama nuevo a partir de una plantilla.
   * @param {Object} plantilla
   */
  function cargarPlantillaComoNuevoDiagrama(plantilla) {
    const archivoActivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    const archivoNuevo = estado.gestorDeArchivos.crearArchivo({
      nombre: plantilla.nombre,
      carpetaId: archivoActivo ? archivoActivo.carpetaId : estado.gestorDeArchivos.obtenerIdCarpetaRaiz(),
      codigo: plantilla.codigo
    });
    estado.gestorDeArchivos.establecerArchivoActivo(archivoNuevo.id);
    abrirArchivoActivo();
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
    ejecutarRenderizado();
    notificarExitoDeAccion(`Plantilla '${plantilla.nombre}' cargada como nuevo diagrama`);
  }

  /**
   * Coloca un snippet en el editor (invocado desde la documentación).
   * @param {string} codigo
   * @param {string} nombreSugerido
   */
  function colocarSnippetEnEditor(codigo, nombreSugerido) {
    ELEMENTOS.editorCodigo.value = codigo;
    guardarDiagramaActivoSilencioso();
    actualizarEstadisticasYNumeros();
    estado.ajusteAutomaticoDelLienzo = true;
    bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalDocumentacion).hide();
    ejecutarRenderizado();
    actualizarEstadoDeAlmacenamiento();
    establecerEstadoRenderizado(`Plantilla "${nombreSugerido}" cargada`, 'exito');
    notificarExitoDeAccion(`Plantilla '${nombreSugerido}' cargada en el editor`);
  }

  // ==========================================================================
  // Renderizado
  // ==========================================================================

  /** Programa un renderizado con retardo. */
  function programarRenderizado() {
    if (estado.manejadorRenderConRetardo) {
      estado.manejadorRenderConRetardo();
    } else {
      ejecutarRenderizado();
    }
  }

  /**
   * Ejecuta el renderizado y actualiza el estado visual.
   * @returns {Promise<void>}
   */
  async function ejecutarRenderizado() {
    const codigoFuente = ELEMENTOS.editorCodigo.value;

    if (!codigoFuente.trim()) {
      ELEMENTOS.contenidoLienzo.innerHTML = '';
      ocultarError();
      ELEMENTOS.superposicionVacia.hidden = false;
      establecerEstadoRenderizado('Editor vacío', 'procesando');
      ELEMENTOS.estadoSintaxis.textContent = 'Sintaxis: vacía';
      return;
    }

    establecerEstadoRenderizado('Renderizando…', 'procesando');
    const codigoConDiseno = construirCodigoConDiseno(codigoFuente);
    const resultado = await MermaidRenderer.intentarRenderizarDiagrama(codigoConDiseno, ELEMENTOS.contenidoLienzo);

    if (resultado.exito) {
      ocultarError();
      ELEMENTOS.superposicionVacia.hidden = true;
      ELEMENTOS.estadoSintaxis.textContent = 'Sintaxis: válida';
      establecerEstadoRenderizado('Diagrama actualizado', 'exito');
      estado.ultimoErrorDeSintaxisNotificado = null;
      dimensionarContenedorDelDiagrama(resultado.dimensiones);
      if (estado.ajusteAutomaticoDelLienzo) {
        ajustarDiagramaAlLienzo();
      } else {
        aplicarTransformacionDelContenido();
      }
    } else {
      mostrarError(resultado.mensajeError);
      ELEMENTOS.estadoSintaxis.textContent = 'Sintaxis: error';
      establecerEstadoRenderizado('Error de sintaxis', 'error');
      if (estado.ultimoErrorDeSintaxisNotificado !== resultado.mensajeError) {
        estado.ultimoErrorDeSintaxisNotificado = resultado.mensajeError;
        if (Alerts && typeof Alerts.notificarErrorDeSintaxis === 'function') {
          Alerts.notificarErrorDeSintaxis('Error de sintaxis en el diagrama');
        }
      }
    }
  }

  /** Muestra el panel de error. */
  function mostrarError(mensaje) {
    ELEMENTOS.detalleError.textContent = mensaje;
    ELEMENTOS.superposicionError.hidden = false;
    ELEMENTOS.superposicionVacia.hidden = true;
  }

  /** Oculta el panel de error. */
  function ocultarError() {
    ELEMENTOS.superposicionError.hidden = true;
  }

  /**
   * Actualiza el indicador de estado inferior.
   * @param {string} texto
   * @param {'exito'|'error'|'procesando'} tipo
   */
  function establecerEstadoRenderizado(texto, tipo) {
    ELEMENTOS.estadoRenderizado.textContent = texto;
    ELEMENTOS.puntoEstado.className = `punto-estado ${tipo || ''}`.trim();
  }

  // ==========================================================================
  // Editor: estadísticas y teclado
  // ==========================================================================

  /** Recalcula estadísticas y numeración de líneas. */
  function actualizarEstadisticasYNumeros() {
    const valorDelEditor = ELEMENTOS.editorCodigo.value;
    const lineas = valorDelEditor.split('\n');

    ELEMENTOS.numerosLinea.textContent = lineas.map((_, indice) => indice + 1).join('\n');
    ELEMENTOS.estadisticaLineas.textContent = `${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}`;
    ELEMENTOS.estadisticaCaracteres.textContent = String(valorDelEditor.length);
    ELEMENTOS.estadisticaTamano.textContent = FileSystemManager.formatearTamanoLegibleDeBytes(
      new Blob([valorDelEditor]).size
    );

    sincronizarDesplazamientoDeNumeros();
    actualizarPosicionDelCursor();
  }

  /** Sincroniza el scroll vertical de los números de línea. */
  function sincronizarDesplazamientoDeNumeros() {
    ELEMENTOS.numerosLinea.scrollTop = ELEMENTOS.editorCodigo.scrollTop;
  }

  /** Actualiza la posición del cursor (línea, columna). */
  function actualizarPosicionDelCursor() {
    const posicionCursor = ELEMENTOS.editorCodigo.selectionStart;
    const textoHastaCursor = ELEMENTOS.editorCodigo.value.slice(0, posicionCursor);
    const numeroDeLinea = textoHastaCursor.split('\n').length;
    const columna = posicionCursor - textoHastaCursor.lastIndexOf('\n');
    ELEMENTOS.estadisticaPosicion.textContent = `Ln ${numeroDeLinea}, Col ${columna}`;
  }

  /**
   * Gestiona Tab y Ctrl+Enter dentro del editor.
   * @param {KeyboardEvent} evento
   */
  function manejarTeclaEnEditor(evento) {
    if (evento.key === 'Tab') {
      evento.preventDefault();
      insertarSangriaEnEditor(ELEMENTOS.editorCodigo);
      actualizarEstadisticasYNumeros();
      programarRenderizado();
      guardarDiagramaActivoSilencioso();
      return;
    }
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      if (estado.manejadorRenderConRetardo) {
        estado.manejadorRenderConRetardo.cancelar();
      }
      ejecutarRenderizado();
    }
  }

  /**
   * Inserta sangría respetando selecciones multilínea.
   * @param {HTMLTextAreaElement} areaDeTexto
   */
  function insertarSangriaEnEditor(areaDeTexto) {
    const inicioSeleccion = areaDeTexto.selectionStart;
    const finSeleccion = areaDeTexto.selectionEnd;

    if (inicioSeleccion === finSeleccion) {
      insertarTextoEnCursor(areaDeTexto, SANGRIA_EDITOR);
      return;
    }

    const valor = areaDeTexto.value;
    const inicioDeLinea = valor.lastIndexOf('\n', inicioSeleccion - 1) + 1;
    const finDeLineaEncontrado = valor.indexOf('\n', finSeleccion);
    const finDeLinea = finDeLineaEncontrado === -1 ? valor.length : finDeLineaEncontrado;

    const bloqueSeleccionado = valor.slice(inicioDeLinea, finDeLinea);
    const bloqueIndentado = bloqueSeleccionado.split('\n').map((linea) => SANGRIA_EDITOR + linea).join('\n');

    areaDeTexto.value = valor.slice(0, inicioDeLinea) + bloqueIndentado + valor.slice(finDeLinea);
    areaDeTexto.selectionStart = inicioDeLinea;
    areaDeTexto.selectionEnd = inicioDeLinea + bloqueIndentado.length;
  }

  /**
   * Inserta texto en el cursor preservando el historial de deshacer.
   * @param {HTMLTextAreaElement} areaDeTexto
   * @param {string} texto
   */
  function insertarTextoEnCursor(areaDeTexto, texto) {
    if (document.execCommand) {
      document.execCommand('insertText', false, texto);
      return;
    }
    const inicio = areaDeTexto.selectionStart;
    const fin = areaDeTexto.selectionEnd;
    areaDeTexto.value = areaDeTexto.value.slice(0, inicio) + texto + areaDeTexto.value.slice(fin);
    areaDeTexto.selectionStart = areaDeTexto.selectionEnd = inicio + texto.length;
  }

  // ==========================================================================
  // Lienzo: zoom y paneo
  // ==========================================================================

  /**
   * Devuelve el elemento que recibe la transformación de zoom/paneo. Se usa el
   * propio SVG (elemento vectorial) para mantener la nitidez a cualquier
   * escala; si aún no hay SVG se recurre al contenedor.
   * @returns {HTMLElement|SVGSVGElement}
   */
  function obtenerElementoTransformable() {
    return ELEMENTOS.contenidoLienzo.querySelector('svg') || ELEMENTOS.contenidoLienzo;
  }

  /** Aplica la transformación acumulada al contenido vectorial. */
  function aplicarTransformacionDelContenido() {
    obtenerElementoTransformable().style.transform =
      `translate(${estado.desplazamientoX}px, ${estado.desplazamientoY}px) scale(${estado.zoom})`;
    const etiquetaZoom = ELEMENTOS.indicadorZoom || ELEMENTOS['zoom-level-text'];
    if (etiquetaZoom) {
      etiquetaZoom.textContent = `${Math.round(estado.zoom * 100)}%`;
    }
    sincronizarMinimapa();
  }

  /** @returns {{svg:SVGSVGElement, ancho:number, alto:number}|null} */
  function obtenerDimensionesDelDiagrama() {
    const svg = ELEMENTOS.contenidoLienzo.querySelector('svg');
    if (!svg) {
      return null;
    }
    const { ancho, alto } = Exporter.calcularDimensionesIntrinsecasDelSvg(svg);
    return { svg, ancho, alto };
  }

  /**
   * Fija el tamaño real del contenedor del diagrama a sus dimensiones
   * intrínsecas. Es necesario porque el SVG se estiliza con width/height al
   * 100 %, y ese porcentaje solo resuelve si el padre tiene una medida.
   * @param {{ancho:number, alto:number}|null|undefined} dimensiones
   */
  function dimensionarContenedorDelDiagrama(dimensiones) {
    if (!dimensiones) {
      return;
    }
    ELEMENTOS.contenidoLienzo.style.width = `${dimensiones.ancho}px`;
    ELEMENTOS.contenidoLienzo.style.height = `${dimensiones.alto}px`;
  }

  /**
   * Marca que el usuario ajustó la vista a mano; desactiva el auto-encaje hasta
   * que vuelva a cargar un diagrama o pulse "Ajustar".
   */
  function marcarVistaAjustadaManualmente() {
    estado.ajusteAutomaticoDelLienzo = false;
  }

  /**
   * Ajusta el zoom multiplicándolo por un factor, manteniendo el centro.
   * @param {number} factor
   */
  function ajustarZoomConFactor(factor) {
    establecerZoomEnPunto(
      estado.zoom * factor,
      ELEMENTOS.lienzo.clientWidth / 2,
      ELEMENTOS.lienzo.clientHeight / 2
    );
  }

  /**
   * Establece un zoom anclado a un punto del lienzo.
   * @param {number} zoomDeseado
   * @param {number} puntoAnclajeX
   * @param {number} puntoAnclajeY
   */
  function establecerZoomEnPunto(zoomDeseado, puntoAnclajeX, puntoAnclajeY) {
    marcarVistaAjustadaManualmente();
    const zoomLimitado = Math.min(ESCALA_ZOOM_MAXIMA, Math.max(ESCALA_ZOOM_MINIMA, zoomDeseado));
    const factorRelativo = zoomLimitado / estado.zoom;
    estado.desplazamientoX = puntoAnclajeX - (puntoAnclajeX - estado.desplazamientoX) * factorRelativo;
    estado.desplazamientoY = puntoAnclajeY - (puntoAnclajeY - estado.desplazamientoY) * factorRelativo;
    estado.zoom = zoomLimitado;
    aplicarTransformacionDelContenido();
  }

  /** Centra el diagrama en el lienzo conservando el zoom actual. */
  function centrarDiagramaEnLienzo() {
    const dimensiones = obtenerDimensionesDelDiagrama();
    if (!dimensiones) {
      return;
    }
    estado.desplazamientoX = (ELEMENTOS.lienzo.clientWidth - dimensiones.ancho * estado.zoom) / 2;
    estado.desplazamientoY = (ELEMENTOS.lienzo.clientHeight - dimensiones.alto * estado.zoom) / 2;
    aplicarTransformacionDelContenido();
  }

  /**
   * Encaja automáticamente el diagrama completo dentro del lienzo con un margen
   * de seguridad y lo centra. Se invoca tras cada renderizado, al redimensionar
   * el visor y al pulsar el botón "Ajustar".
   */
  function ajustarDiagramaAlLienzo() {
    const dimensiones = obtenerDimensionesDelDiagrama();
    const anchoLienzo = ELEMENTOS.lienzo.clientWidth;
    const altoLienzo = ELEMENTOS.lienzo.clientHeight;
    if (!dimensiones || anchoLienzo <= 0 || altoLienzo <= 0) {
      return;
    }

    const anchoDisponible = anchoLienzo - MARGEN_AJUSTE_LIENZO * 2;
    const altoDisponible = altoLienzo - MARGEN_AJUSTE_LIENZO * 2;
    if (anchoDisponible <= 0 || altoDisponible <= 0) {
      return;
    }

    const factorX = anchoDisponible / dimensiones.ancho;
    const factorY = altoDisponible / dimensiones.alto;
    const escalaOptima = Math.min(factorX, factorY, FACTOR_ZOOM_MAXIMO_AJUSTE);

    estado.zoom = Math.min(ESCALA_ZOOM_MAXIMA, Math.max(ESCALA_ZOOM_MINIMA, escalaOptima));
    centrarDiagramaEnLienzo();
  }

  /**
   * Inicia el paneo.
   * @param {PointerEvent} evento
   */
  function iniciarPaneo(evento) {
    if (evento.button !== 0) {
      return;
    }
    // Los controles flotantes, la barra de presentación y demás superposiciones
    // viven dentro del lienzo. Si el puntero nace sobre ellos, no se inicia el
    // paneo ni se captura el puntero: de lo contrario `setPointerCapture`
    // redirigiría el evento `click` al lienzo y los botones quedarían mudos.
    if (esEventoSobreControlInteractivo(evento)) {
      return;
    }
    marcarVistaAjustadaManualmente();
    estado.arrastrandoPan = true;
    estado.origenPanX = evento.clientX - estado.desplazamientoX;
    estado.origenPanY = evento.clientY - estado.desplazamientoY;
    ELEMENTOS.lienzo.classList.add('paneando');
    ELEMENTOS.lienzo.setPointerCapture(evento.pointerId);
  }

  /**
   * Actualiza el paneo.
   * @param {PointerEvent} evento
   */
  function moverPaneo(evento) {
    if (!estado.arrastrandoPan) {
      return;
    }
    estado.desplazamientoX = evento.clientX - estado.origenPanX;
    estado.desplazamientoY = evento.clientY - estado.origenPanY;
    aplicarTransformacionDelContenido();
  }

  /**
   * Finaliza el paneo.
   * @param {PointerEvent} evento
   */
  function finalizarPaneo(evento) {
    if (!estado.arrastrandoPan) {
      return;
    }
    estado.arrastrandoPan = false;
    ELEMENTOS.lienzo.classList.remove('paneando');
    if (ELEMENTOS.lienzo.hasPointerCapture(evento.pointerId)) {
      ELEMENTOS.lienzo.releasePointerCapture(evento.pointerId);
    }
  }

  /**
   * Indica si un evento de puntero nace sobre un control interactivo del lienzo
   * (botones flotantes, barra de presentación, minimapa o superposiciones).
   * @param {PointerEvent} evento
   * @returns {boolean}
   */
  function esEventoSobreControlInteractivo(evento) {
    const objetivo = evento.target;
    if (!objetivo || typeof objetivo.closest !== 'function') {
      return false;
    }
    return Boolean(objetivo.closest(
      'button, a, input, select, textarea, label, ' +
      '.controles-flotantes-lienzo, .barra-presentacion, .minimapa, .superposicion-lienzo'
    ));
  }

  /**
   * Zoom con la rueda anclado al cursor.
   * @param {WheelEvent} evento
   */
  function manejarRuedaDeZoom(evento) {
    evento.preventDefault();
    const rectangulo = ELEMENTOS.lienzo.getBoundingClientRect();
    const factor = evento.deltaY < 0 ? PASO_ZOOM : 1 / PASO_ZOOM;
    establecerZoomEnPunto(estado.zoom * factor, evento.clientX - rectangulo.left, evento.clientY - rectangulo.top);
  }

  /**
   * Re-encaja el diagrama cuando cambia el tamaño del visor (redimensión de la
   * ventana o arrastre del separador de paneles). Respeta el zoom manual.
   */
  function registrarObservadorDeTamanoDelLienzo() {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observador = new ResizeObserver(() => {
      if (estado.ajusteAutomaticoDelLienzo) {
        ajustarDiagramaAlLienzo();
      }
    });
    observador.observe(ELEMENTOS.lienzo);
  }

  // ==========================================================================
  // Exportación y utilidades
  // ==========================================================================

  /**
   * Construye las opciones de exportación.
   *
   * La exportación es **siempre sin fondo**: PNG, SVG y el copiado al
   * portapapeles se generan con la transparencia activada, de modo que solo
   * se exporta el diagrama y nunca un fondo blanco o negro del tema.
   * @returns {{fondoTransparente:boolean, colorFondo:null, marcaDeAgua:Object|null}}
   */
  function construirOpcionesDeExportacion() {
    return {
      fondoTransparente: true,
      colorFondo: null,
      marcaDeAgua: construirMarcaDeAgua()
    };
  }

  /**
   * Compone el texto de la marca de agua: proyecto, autor (opcional) y fecha.
   * @returns {{texto:string}|null}
   */
  function construirMarcaDeAgua() {
    if (!estado.marcaDeAguaActiva) {
      return null;
    }
    const partes = [
      obtenerNombreBaseArchivo(),
      estado.autorMarcaDeAgua.trim(),
      new Date().toLocaleDateString('es-ES')
    ].filter((parte) => parte && parte.length > 0);
    return partes.length > 0 ? { texto: partes.join(' · ') } : null;
  }

  /** Deriva un nombre de archivo seguro del diagrama activo. */
  function obtenerNombreBaseArchivo() {
    const archivoActivo = estado.gestorDeArchivos.obtenerArchivoActivo();
    const nombre = archivoActivo ? archivoActivo.nombre : 'diagrama-openmermaid';
    return nombre.trim().replace(/[^\w\-.]+/g, '_') || 'diagrama-openmermaid';
  }

  /**
   * Ejecuta una exportación que necesita el SVG renderizado.
   * @param {(svg:SVGSVGElement)=>void|Promise<void>} tarea
   * @param {{cargando?:boolean, mensajeExito?:string}} [opciones]
   */
  async function exportarConSvg(tarea, opciones) {
    const configuracion = opciones || {};
    const svg = ELEMENTOS.contenidoLienzo.querySelector('svg');
    if (!svg) {
      establecerEstadoRenderizado('No hay diagrama para exportar', 'error');
      notificarErrorDeAccion('Nada que exportar', 'Renderiza un diagrama antes de exportarlo.');
      return;
    }
    if (configuracion.cargando && Alerts && typeof Alerts.mostrarCargador === 'function') {
      Alerts.mostrarCargador();
    }
    try {
      establecerEstadoRenderizado('Exportando…', 'procesando');
      await tarea(svg);
      establecerEstadoRenderizado('Exportación completada', 'exito');
      if (configuracion.mensajeExito) {
        notificarExitoDeAccion(configuracion.mensajeExito);
      }
    } catch (error) {
      establecerEstadoRenderizado('Error al exportar', 'error');
      notificarErrorDeAccion('Error al exportar', error && error.message ? error.message : String(error));
    } finally {
      if (configuracion.cargando && Alerts && typeof Alerts.cerrarCargador === 'function') {
        Alerts.cerrarCargador();
      }
    }
  }

  /**
   * Envuelve una copia al portapapeles con manejo de errores.
   * @param {()=>Promise<void>} tarea
   * @param {string} [mensajeExito]
   */
  async function ejecutarCopiaProtegida(tarea, mensajeExito) {
    try {
      await tarea();
      establecerEstadoRenderizado('Copiado al portapapeles', 'exito');
      notificarExitoDeAccion(mensajeExito || 'Copiado al portapapeles');
    } catch (error) {
      establecerEstadoRenderizado('No se pudo copiar', 'error');
      notificarErrorDeAccion('No se pudo copiar', error && error.message ? error.message : String(error));
    }
  }

  /**
   * Ejecuta la exportación seleccionada desde el modal avanzado.
   * @param {{formato:string, factorEscala:number, incluirMetadatos:boolean}} seleccion
   */
  async function ejecutarExportacionSeleccionada(seleccion) {
    const svg = ELEMENTOS.contenidoLienzo.querySelector('svg');
    if (!svg) {
      notificarErrorDeAccion('Nada que exportar', 'Renderiza un diagrama antes de exportarlo.');
      establecerEstadoRenderizado('No hay diagrama para exportar', 'error');
      return;
    }

    const nombreBase = obtenerNombreBaseArchivo();
    // La exportación siempre es sin fondo: solo el diagrama, nunca el fondo del tema.
    const opcionesExportacion = {
      fondoTransparente: true,
      colorFondo: null,
      marcaDeAgua: construirMarcaDeAgua()
    };

    if (!seleccion.incluirMetadatos) {
      opcionesExportacion.marcaDeAgua = null;
    }

    const formato = seleccion.formato;
    const esPesada = formato === 'pdf' || (formato === 'png' && seleccion.factorEscala >= 3);
    let cargadorMostrado = false;
    if (esPesada && Alerts && typeof Alerts.mostrarCargador === 'function') {
      Alerts.mostrarCargador();
      cargadorMostrado = true;
    }

    try {
      if (formato === 'svg') {
        await Exporter.exportarComoSvg(svg, nombreBase, opcionesExportacion);
        notificarExitoDeAccion('Archivo SVG descargado en ultra alta definición');
      } else if (formato === 'pdf') {
        await Exporter.exportarComoPdf(svg, nombreBase, opcionesExportacion);
        notificarExitoDeAccion('Archivo PDF descargado en ultra alta definición');
      } else if (formato === 'mmd') {
        Exporter.exportarCodigoFuente(ELEMENTOS.editorCodigo.value, nombreBase);
        notificarExitoDeAccion('Código fuente exportado (.mmd)');
      } else {
        await Exporter.exportarComoPng(svg, seleccion.factorEscala, nombreBase, opcionesExportacion);
        notificarExitoDeAccion(`Archivo PNG ${seleccion.factorEscala}x descargado en ultra alta definición`);
      }
      establecerEstadoRenderizado('Exportación completada', 'exito');
    } catch (error) {
      establecerEstadoRenderizado('Error al exportar', 'error');
      notificarErrorDeAccion('Error al exportar', error && error.message ? error.message : String(error));
    } finally {
      if (cargadorMostrado && Alerts && typeof Alerts.cerrarCargador === 'function') {
        Alerts.cerrarCargador();
      }
    }
  }

  /** Actualiza el indicador de tamaño de almacenamiento. */
  function actualizarEstadoDeAlmacenamiento() {
    const metricas = estado.gestorDeArchivos.calcularMetricasDeAlmacenamiento();
    ELEMENTOS.estadoAlmacenamiento.textContent = FileSystemManager.formatearTamanoLegibleDeBytes(metricas.bytesUsados);
    DocsViewer.refrescarMetricasDeAlmacenamiento();
  }

  /** Rellena el selector de armonías. */
  function poblarSelectorDeArmonias() {
    ELEMENTOS.selectorArmonia.innerHTML = ColorAlgorithms.obtenerArmoniasDisponibles()
      .map((armonia) => `<option value="${armonia.clave}">${armonia.etiqueta}</option>`)
      .join('');
  }

  // ==========================================================================
  // Enrutador simple (hash-based) para redirecciones/URLs mal formadas
  // ==========================================================================
  const RUTAS_VALIDAS = new Set(['', '#', '#editor', '#documentacion']);

  function inicializarEnrutador() {
    function manejarRuta() {
      const hash = window.location.hash || '';
      if (!RUTAS_VALIDAS.has(hash)) {
        const hashLimpio = hash || '(vacío)';
        if (Alerts && typeof Alerts.notificarAdvertencia === 'function') {
          Alerts.notificarAdvertencia(
            'Ruta no encontrada',
            `La ruta "${hashLimpio}" no es válida. Se mantiene la vista actual.`
          );
        } else if (typeof window !== 'undefined' && window.Swal) {
          window.Swal.fire({
            icon: 'warning',
            title: 'Ruta no encontrada',
            text: `La ruta "${hashLimpio}" no es válida.`,
            confirmButtonText: 'Aceptar'
          });
        }
        try {
          window.history.replaceState(null, '', window.location.pathname + window.location.search + '#');
        } catch (e) {
          // Ignorar errores de history API
        }
      }
    }
    window.addEventListener('hashchange', manejarRuta);
    manejarRuta();
  }

  // Los atajos de teclado se delegan por completo al módulo KeyboardShortcuts,
  // registrado en `registrarAtajosDeTeclado()` con el mapa de acciones.

  // Arranque.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { iniciarAplicacion(); inicializarEnrutador(); });
  } else {
    iniciarAplicacion();
    inicializarEnrutador();
  }
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
