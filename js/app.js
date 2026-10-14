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
    alConfirmarEntradaTexto: null,
    manejadorRenderConRetardo: null,
    viewportPequeno: null
  };

  /** Caché de referencias al DOM. */
  const ELEMENTOS = {};

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
      'modalEntradaTexto', 'formularioEntradaTexto', 'tituloEntradaTexto', 'etiquetaEntradaTexto',
      'campoEntradaTexto', 'errorEntradaTexto', 'modalDocumentacion', 'modalAtajos', 'listaAtajos', 'modalHistorial', 'listaHistorial', 'nombreArchivoHistorial', 'botonLimpiarHistorial',
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
    registrarEventoDelModalDeTexto();
    registrarEventosDeBusqueda();
    registrarEventosDeHistorial();
    registrarEventosDeMinimapa();
    registrarEventosDePresentacion();
    registrarEventosDeAtajos();
    registrarObservadorDeTamanoDelLienzo();
    registrarAtajosDeTeclado();
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
    });
    ELEMENTOS.botonCentrar?.addEventListener('click', () => {
      marcarVistaAjustadaManualmente();
      centrarDiagramaEnLienzo();
    });
    ELEMENTOS.botonAjustar?.addEventListener('click', () => {
      estado.ajusteAutomaticoDelLienzo = true;
      ajustarDiagramaAlLienzo();
    });
    ELEMENTOS['btn-fit-screen']?.addEventListener('click', () => {
      estado.ajusteAutomaticoDelLienzo = true;
      ajustarDiagramaAlLienzo();
    });

    ELEMENTOS['btn-fullscreen']?.addEventListener('click', () => {
      if (estado.modoPresentacion) {
        salirDePantallaCompleta();
        establecerModoPresentacion(false);
        return;
      }
      establecerModoPresentacion(true);
      solicitarPantallaCompleta();
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
      Exporter.exportarComoSvg(svg, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion())));

    ELEMENTOS.exportarPng1x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 1, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion())));

    ELEMENTOS.exportarPng2x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 2, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion())));

    ELEMENTOS.exportarPng4x.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPng(svg, 4, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion())));

    ELEMENTOS.exportarPdf.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.exportarComoPdf(svg, obtenerNombreBaseArchivo(), construirOpcionesDeExportacion())));

    ELEMENTOS.exportarCodigoMmd.addEventListener('click', () => {
      Exporter.exportarCodigoFuente(ELEMENTOS.editorCodigo.value, obtenerNombreBaseArchivo());
      establecerEstadoRenderizado('Código .mmd exportado', 'exito');
    });

    ELEMENTOS.copiarCodigo.addEventListener('click', () => ejecutarCopiaProtegida(() =>
      Exporter.copiarCodigoFuenteAlPortapapeles(ELEMENTOS.editorCodigo.value)));

    ELEMENTOS.copiarSvg.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.copiarSvgAlPortapapeles(svg)));

    ELEMENTOS.copiarPng.addEventListener('click', () => exportarConSvg((svg) =>
      Exporter.copiarPngAlPortapapeles(svg, construirOpcionesDeExportacion())));

    ELEMENTOS.interruptorMarcaDeAgua.addEventListener('change', (evento) => {
      estado.marcaDeAguaActiva = evento.target.checked;
      guardarPreferenciasEnConfiguracion();
    });

    ELEMENTOS.autorMarcaDeAgua.addEventListener('input', (evento) => {
      estado.autorMarcaDeAgua = evento.target.value;
      guardarPreferenciasEnConfiguracion();
    });

    if (ELEMENTOS.abrirModalExportacion) {
      ELEMENTOS.abrirModalExportacion.addEventListener('click', () => {
        if (typeof ExportDialog.abrirDialogoDeExportacion === 'function') {
          ExportDialog.abrirDialogoDeExportacion();
        } else {
          ExportDialog.abrirDialogoDeExportacion();
        }
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
  }

  /** Tema claro/oscuro y sidebar. */
  function registrarEventosDeTemaYSidebar() {
    ELEMENTOS.botonModoOscuro.addEventListener('click', () => {
      estado.modoOscuro = !estado.modoOscuro;
      estado.gestorDeArchivos.actualizarConfiguracion({ tema: estado.modoOscuro ? 'dark' : 'light' });
      aplicarTemaVisual();
      aplicarCambioDePaleta();
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

  /** Modal genérico de entrada de texto. */
  function registrarEventoDelModalDeTexto() {
    ELEMENTOS.formularioEntradaTexto.addEventListener('submit', (evento) => {
      evento.preventDefault();
      const valorIngresado = ELEMENTOS.campoEntradaTexto.value;
      if (typeof estado.alConfirmarEntradaTexto !== 'function') {
        return;
      }
      const mensajeDeError = estado.alConfirmarEntradaTexto(valorIngresado);
      if (mensajeDeError) {
        ELEMENTOS.errorEntradaTexto.textContent = mensajeDeError;
        return;
      }
      ELEMENTOS.errorEntradaTexto.textContent = '';
      bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalEntradaTexto).hide();
    });

    ELEMENTOS.modalEntradaTexto.addEventListener('hidden.bs.modal', () => {
      estado.alConfirmarEntradaTexto = null;
      ELEMENTOS.errorEntradaTexto.textContent = '';
    });
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

  /** Restablece el zoom al 100 % manteniendo el centro. */
  function restablecerZoomAlCien() {
    marcarVistaAjustadaManualmente();
    estado.zoom = 1;
    centrarDiagramaEnLienzo();
    sincronizarMinimapa();
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
    } else {
      establecerEstadoRenderizado(resultado.mensajeError || 'No se pudo guardar', 'error');
    }
  }

  /** Solicita el nombre de una carpeta nueva. */
  function solicitarNuevaCarpeta() {
    abrirModalEntradaTexto({
      titulo: 'Nueva carpeta',
      etiqueta: 'Nombre de la carpeta',
      valorInicial: '',
      textoBoton: 'Crear carpeta',
      alConfirmar: (nombre) => {
        const resultado = estado.gestorDeArchivos.crearCarpeta(nombre);
        if (!resultado.exito) {
          return resultado.mensajeError;
        }
        estado.carpetasExpandidas.add(resultado.carpeta.id);
        renderizarArbolDeArchivos();
        return null;
      }
    });
  }

  /** Renombra una carpeta. */
  function solicitarRenombrarCarpeta(carpeta) {
    abrirModalEntradaTexto({
      titulo: 'Renombrar carpeta',
      etiqueta: 'Nuevo nombre',
      valorInicial: carpeta.nombre,
      textoBoton: 'Renombrar',
      alConfirmar: (nombre) => {
        const resultado = estado.gestorDeArchivos.renombrarCarpeta(carpeta.id, nombre);
        if (!resultado.exito) {
          return resultado.mensajeError;
        }
        renderizarArbolDeArchivos();
        return null;
      }
    });
  }

  /** Renombra un archivo. */
  function solicitarRenombrarArchivo(archivo) {
    abrirModalEntradaTexto({
      titulo: 'Renombrar diagrama',
      etiqueta: 'Nuevo nombre',
      valorInicial: archivo.nombre,
      textoBoton: 'Renombrar',
      alConfirmar: (nombre) => {
        const resultado = estado.gestorDeArchivos.renombrarArchivo(archivo.id, nombre);
        if (!resultado.exito) {
          return resultado.mensajeError;
        }
        if (archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo()) {
          ELEMENTOS.nombreArchivoActivo.textContent = nombre.trim();
        }
        renderizarArbolDeArchivos();
        return null;
      }
    });
  }

  /** Elimina una carpeta previa confirmación. */
  function eliminarCarpetaConConfirmacion(carpeta) {
    if (typeof window.Swal !== 'undefined') {
      Swal.fire({
        title: '¿Eliminar carpeta?',
        text: `¿Eliminar la carpeta "${carpeta.nombre}"? Sus diagramas se moverán a la raíz.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Eliminar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          const resultado = estado.gestorDeArchivos.eliminarCarpeta(carpeta.id);
          if (!resultado.exito) { establecerEstadoRenderizado(resultado.mensajeError, 'error'); return; }
          renderizarArbolDeArchivos(); actualizarEstadoDeAlmacenamiento();
        }
      });
      return;
    }
    const resultado = estado.gestorDeArchivos.eliminarCarpeta(carpeta.id);
    if (!resultado.exito) {
      establecerEstadoRenderizado(resultado.mensajeError, 'error');
      return;
    }
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
  }

  /** Elimina un archivo previa confirmación. */
  function eliminarArchivoConConfirmacion(archivo) {
    if (typeof window.Swal !== 'undefined') {
      Swal.fire({
        title: '¿Eliminar diagrama?',
        text: archivo.nombre,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Eliminar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          const eraActivo = archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo();
          const resultado = estado.gestorDeArchivos.eliminarArchivo(archivo.id);
          if (!resultado.exito) { establecerEstadoRenderizado(resultado.mensajeError, 'error'); return; }
          if (eraActivo) { abrirArchivoActivo(); ejecutarRenderizado(); }
          renderizarArbolDeArchivos(); actualizarEstadoDeAlmacenamiento();
        }
      });
      return;
    }
    const eraActivo = archivo.id === estado.gestorDeArchivos.obtenerIdArchivoActivo();
    const resultado = estado.gestorDeArchivos.eliminarArchivo(archivo.id);
    if (!resultado.exito) {
      establecerEstadoRenderizado(resultado.mensajeError, 'error');
      return;
    }
    if (eraActivo) {
      abrirArchivoActivo();
      ejecutarRenderizado();
    }
    renderizarArbolDeArchivos();
    actualizarEstadoDeAlmacenamiento();
  }

  /** Crea un diagrama nuevo en la carpeta del activo. */
  function crearNuevoDiagrama() {
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
      } else {
        ELEMENTOS.mensajeRespaldo.textContent = 'Respaldo restaurado correctamente.';
        renderizarArbolDeArchivos();
        abrirArchivoActivo();
        actualizarEstadoDeAlmacenamiento();
        DocsViewer.refrescarMetricasDeAlmacenamiento();
        ejecutarRenderizado();
      }
      ELEMENTOS.entradaImportarRespaldo.value = '';
    };
    lector.readAsText(archivoSeleccionado);
  }

  // ==========================================================================
  // Modal genérico de entrada de texto
  // ==========================================================================

  /**
   * Abre el modal de entrada de texto.
   * @param {Object} opciones
   * @param {string} opciones.titulo
   * @param {string} opciones.etiqueta
   * @param {string} opciones.valorInicial
   * @param {string} opciones.textoBoton
   * @param {(valor:string)=>string|null} opciones.alConfirmar
   */
  function abrirModalEntradaTexto(opciones) {
    estado.alConfirmarEntradaTexto = opciones.alConfirmar;
    ELEMENTOS.tituloEntradaTexto.textContent = opciones.titulo;
    ELEMENTOS.etiquetaEntradaTexto.textContent = opciones.etiqueta;
    ELEMENTOS.campoEntradaTexto.value = opciones.valorInicial || '';
    ELEMENTOS.errorEntradaTexto.textContent = '';

    const modal = bootstrap.Modal.getOrCreateInstance(ELEMENTOS.modalEntradaTexto);
    ELEMENTOS.modalEntradaTexto.addEventListener('shown.bs.modal', function seleccionarCampo() {
      ELEMENTOS.campoEntradaTexto.focus();
      ELEMENTOS.campoEntradaTexto.select();
      ELEMENTOS.modalEntradaTexto.removeEventListener('shown.bs.modal', seleccionarCampo);
    });
    modal.show();
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
   */
  async function exportarConSvg(tarea) {
    const svg = ELEMENTOS.contenidoLienzo.querySelector('svg');
    if (!svg) {
      establecerEstadoRenderizado('No hay diagrama para exportar', 'error');
      if (ExportDialog && typeof ExportDialog.notificarError === 'function') {
        ExportDialog.notificarError('Nada que exportar', 'Renderiza un diagrama antes de exportarlo.');
      }
      return;
    }
    try {
      establecerEstadoRenderizado('Exportando…', 'procesando');
      await tarea(svg);
      establecerEstadoRenderizado('Exportación completada', 'exito');
    } catch (error) {
      establecerEstadoRenderizado('Error al exportar', 'error');
      if (ExportDialog && typeof ExportDialog.notificarError === 'function') {
        ExportDialog.notificarError('Error al exportar', error && error.message ? error.message : String(error));
      }
    }
  }

  /**
   * Envuelve una copia al portapapeles con manejo de errores.
   * @param {()=>Promise<void>} tarea
   */
  async function ejecutarCopiaProtegida(tarea) {
    try {
      await tarea();
      establecerEstadoRenderizado('Copiado al portapapeles', 'exito');
      if (ExportDialog && typeof ExportDialog.notificarExito === 'function') {
        ExportDialog.notificarExito('Copiado al portapapeles');
      }
    } catch (error) {
      establecerEstadoRenderizado('No se pudo copiar', 'error');
      if (ExportDialog && typeof ExportDialog.notificarError === 'function') {
        ExportDialog.notificarError('No se pudo copiar', error && error.message ? error.message : String(error));
      }
    }
  }

  /**
   * Ejecuta la exportación seleccionada desde el modal avanzado.
   * @param {{formato:string, factorEscala:number, incluirMetadatos:boolean}} seleccion
   */
  async function ejecutarExportacionSeleccionada(seleccion) {
    const svg = ELEMENTOS.contenidoLienzo.querySelector('svg');
    if (!svg) {
      if (ExportDialog && typeof ExportDialog.notificarError === 'function') {
        ExportDialog.notificarError('Nada que exportar', 'Renderiza un diagrama antes de exportarlo.');
      }
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

    let cargadorMostrado = false;
    if (ExportDialog && typeof ExportDialog.mostrarCargador === 'function') {
      const formato = seleccion.formato;
      if (formato === 'pdf' || (formato === 'png' && seleccion.factorEscala >= 3)) {
        ExportDialog.mostrarCargador('Generando archivo en alta resolución…', 'Renderizando capas vectoriales y escalando el lienzo…');
        cargadorMostrado = true;
      }
    }

    try {
      if (seleccion.formato === 'svg') {
        await Promise.resolve(Exporter.exportarComoSvg(svg, nombreBase, opcionesExportacion));
        if (ExportDialog && typeof ExportDialog.notificarExito === 'function') {
          ExportDialog.notificarExito('SVG exportado correctamente');
        }
      } else if (seleccion.formato === 'pdf') {
        await Exporter.exportarComoPdf(svg, nombreBase, opcionesExportacion);
        if (ExportDialog && typeof ExportDialog.notificarExito === 'function') {
          ExportDialog.notificarExito('PDF exportado correctamente');
        }
      } else if (seleccion.formato === 'mmd') {
        Exporter.exportarCodigoFuente(ELEMENTOS.editorCodigo.value, nombreBase);
        if (ExportDialog && typeof ExportDialog.notificarExito === 'function') {
          ExportDialog.notificarExito('Código fuente exportado');
        }
      } else {
        await Exporter.exportarComoPng(svg, seleccion.factorEscala, nombreBase, opcionesExportacion);
        if (ExportDialog && typeof ExportDialog.notificarExito === 'function') {
          ExportDialog.notificarExito(`PNG ${seleccion.factorEscala}x exportado correctamente`);
        }
      }
      establecerEstadoRenderizado('Exportación completada', 'exito');
    } catch (error) {
      establecerEstadoRenderizado('Error al exportar', 'error');
      if (ExportDialog && typeof ExportDialog.notificarError === 'function') {
        ExportDialog.notificarError('Error al exportar', error && error.message ? error.message : String(error));
      }
    } finally {
      if (cargadorMostrado && ExportDialog && typeof ExportDialog.cerrarCargador === 'function') {
        ExportDialog.cerrarCargador();
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

  // Los atajos de teclado se delegan por completo al módulo KeyboardShortcuts,
  // registrado en `registrarAtajosDeTeclado()` con el mapa de acciones.

  // Arranque.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarAplicacion);
  } else {
    iniciarAplicacion();
  }
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
