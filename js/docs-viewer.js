/**
 * OpenMermaid Studio - Portal de documentación técnica interactiva.
 *
 * Responsabilidad única: poblar y mantener la vista de documentación (modal a
 * pantalla completa) con métricas de almacenamiento en vivo, el catálogo de
 * operaciones internas (estilo API) y el catálogo de sintaxis Mermaid soportada.
 *
 * El contenido estático de alto nivel (badges y pipeline arquitectónico) vive
 * en index.html; este módulo se encarga de los datos dinámicos.
 *
 * @module docs-viewer
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const { Templates, FileSystemManager } = namespaceOpenMermaid;

  /**
   * Catálogo de operaciones internas presentadas como endpoints locales.
   * Cada entrada documenta su firma, su propósito y el código que la ejecuta.
   * @readonly
   */
  const OPERACIONES_DEL_SISTEMA = [
    {
      metodo: 'LOCAL',
      ruta: '/workspace/save',
      descripcion: 'Persiste el diagrama activo en localStorage y actualiza su fecha de modificación.',
      parametros: 'archivoId · codigo · carpetaId',
      explicacion:
        'Selecciona el archivo activo del espacio de trabajo, reemplaza su código Mermaid y ' +
        'persiste el documento completo. Un único punto de escritura evita estados inconsistentes.',
      codigo: [
        'const archivoActivo = gestorDeArchivos.obtenerArchivoActivo();',
        'gestorDeArchivos.guardarDiagramaActual(editorMermaid.value);',
        'gestorDeArchivos.establecerArchivoActivo(archivoActivo.id);'
      ].join('\n')
    },
    {
      metodo: 'LOCAL',
      ruta: '/workspace/backup',
      descripcion: 'Serializa o restaura todo el árbol de carpetas y diagramas en un archivo JSON.',
      parametros: 'contenidoJson',
      explicacion:
        'La exportación vuelca el objeto de espacio de trabajo a JSON con sangría legible. ' +
        'La importación valida el esquema mínimo (carpetas, archivos, id y codigo) antes de reemplazar el árbol.',
      codigo: [
        'const respaldo = gestorDeArchivos.exportarEspacioDeTrabajoAJson();',
        'descargarBlobComoArchivo(new Blob([respaldo.contenido]), respaldo.nombreArchivo);',
        '// Restauración:',
        'gestorDeArchivos.importarEspacioDeTrabajoDesdeJson(textoJsonLeido);'
      ].join('\n')
    },
    {
      metodo: 'STYLE',
      ruta: '/color/harmony',
      descripcion: 'Genera una paleta armónica en espacio HSL y resuelve sus contrastes WCAG.',
      parametros: 'matizBase · saturacionBase · tipoEsquema · modoOscuro',
      explicacion:
        'Desplaza el matiz sobre el círculo cromático según la armonía elegida (0°, ±30°, 180° o 120°/240°) ' +
        'y elige texto claro u oscuro comparando el ratio de contraste WCAG de cada superficie.',
      codigo: [
        'const paleta = ColorAlgorithms.generarPaletaArmonica({',
        "  matizBase: 213, saturacionBase: 68, tipoEsquema: 'analogo', modoOscuro: false",
        '});',
        'const textoSobrePrimario = ColorAlgorithms.determinarColorDeTextoAccesible(paleta.colorPrimario);'
      ].join('\n')
    },
    {
      metodo: 'STYLE',
      ruta: '/diagram/orientation',
      descripcion: 'Reorienta el flujo entre vertical (TD/TB) y horizontal (LR/RL) sin tocar los nodos.',
      parametros: 'codigoMermaid',
      explicacion:
        'Una expresión regular localiza únicamente la declaración de orientación del flowchart y sustituye ' +
        'la dirección por su opuesta, preservando intactos los identificadores y etiquetas de los nodos.',
      codigo: [
        'const codigoReorientado = DiagramStyler.alternarOrientacionDeFlujo(editorMermaid.value);',
        'editorMermaid.value = codigoReorientado;'
      ].join('\n')
    },
    {
      metodo: 'EXPORT',
      ruta: '/diagram/vector',
      descripcion: 'Serializa el SVG del lienzo como etiqueta autónoma con namespaces y dimensiones.',
      parametros: 'elementoSvg · colorFondo',
      explicacion:
        'Clona el SVG renderizado, fija width/height a partir del viewBox e inyecta opcionalmente un ' +
        'rectángulo de fondo. El resultado es un SVG portable que abre cualquier visor.',
      codigo: [
        'const { cadenaSvg } = Exporter.serializarSvgAutonomo(elementoSvg, null);',
        'Exporter.descargarBlobComoArchivo(',
        "  new Blob([cadenaSvg], { type: 'image/svg+xml' }), 'diagrama.svg'",
        ');'
      ].join('\n')
    },
    {
      metodo: 'EXPORT',
      ruta: '/diagram/raster',
      descripcion: 'Convierte el SVG a PNG 1x/2x/3x/4x con Canvas nativo, siempre sin fondo (solo el diagrama).',
      parametros: 'elementoSvg · factorEscala · fondoTransparente',
      explicacion:
        'El SVG se codifica como data URL, se dibuja en un canvas escalado por el factor elegido y se ' +
        'exporta con toBlob. Para fondos transparentes se omite el relleno del canvas.',
      codigo: [
        'await Exporter.exportarComoPng(elementoSvg, 4, \'diagrama\', {',
        '  fondoTransparente: true, colorFondo: null',
        '});'
      ].join('\n')
    }
  ];

  /**
   * Catálogo de sintaxis Mermaid soportada con acceso directo al editor.
   * @readonly
   */
  const CATALOGO_SINTAXIS = [
    { tipo: 'Flowchart', apertura: 'flowchart TD / LR', casoUso: 'Procesos y decisiones', plantillaId: 'flowchart' },
    { tipo: 'Sequence', apertura: 'sequenceDiagram', casoUso: 'Interacción entre participantes', plantillaId: 'sequence' },
    { tipo: 'Class', apertura: 'classDiagram', casoUso: 'Modelo de objetos y herencia', plantillaId: 'class' },
    { tipo: 'State', apertura: 'stateDiagram-v2', casoUso: 'Ciclos de vida y transiciones', plantillaId: 'state' },
    { tipo: 'ERD', apertura: 'erDiagram', casoUso: 'Esquemas de base de datos', plantillaId: 'erd' },
    { tipo: 'Gantt', apertura: 'gantt', casoUso: 'Planificación temporal', plantillaId: 'gantt' },
    { tipo: 'GitGraph', apertura: 'gitGraph', casoUso: 'Historial de ramas y fusiones', plantillaId: 'gitgraph' },
    { tipo: 'Mindmap', apertura: 'mindmap', casoUso: 'Mapas mentales jerárquicos', plantillaId: 'mindmap' },
    { tipo: 'Pie', apertura: 'pie showData', casoUso: 'Distribución proporcional', plantillaId: 'pie' }
  ];

  let gestorDeArchivosReferenciado = null;
  let alCargarSnippetEnEditor = null;

  /**
   * Inicializa el portal de documentación.
   * @param {Object} opciones
   * @param {FileSystemManager} opciones.gestorDeArchivos
   * @param {(codigo:string, nombreSugerido:string)=>void} opciones.alCargarSnippet
   */
  function inicializarVisorDeDocumentacion(opciones) {
    gestorDeArchivosReferenciado = opciones.gestorDeArchivos;
    alCargarSnippetEnEditor = opciones.alCargarSnippet;

    construirCatalogoDeOperaciones();
    construirCatalogoDeSintaxis();
    refrescarMetricasDeAlmacenamiento();
  }

  /**
   * Actualiza el panel de métricas de almacenamiento en tiempo real.
   */
  function refrescarMetricasDeAlmacenamiento() {
    if (!gestorDeArchivosReferenciado) {
      return;
    }

    const metricas = gestorDeArchivosReferenciado.calcularMetricasDeAlmacenamiento();
    const porcentajeRedondeado = redondearPorcentajeDeUso(metricas.porcentajeUso);

    asignarTexto('docsPorcentajeUso', `${porcentajeRedondeado}%`);
    asignarTexto('docsTamanoUsado', FileSystemManager.formatearTamanoLegibleDeBytes(metricas.bytesUsados));
    asignarTexto('docsTamanoDisponible',
      `libres ${FileSystemManager.formatearTamanoLegibleDeBytes(metricas.bytesDisponibles)} de ${FileSystemManager.formatearTamanoLegibleDeBytes(metricas.limiteBytes)}`);
    asignarTexto('docsTotalDiagramas', String(metricas.totalDiagramas));
    asignarTexto('docsTotalCarpetas', String(metricas.totalCarpetas));

    const barraDeUso = document.getElementById('docsBarraUso');
    if (barraDeUso) {
      barraDeUso.style.width = `${Math.max(2, porcentajeRedondeado)}%`;
      barraDeUso.classList.toggle('nivel-alto', porcentajeRedondeado >= 80);
    }
  }

  /**
   * Construye las tarjetas de operaciones internas con pestañas.
   */
  function construirCatalogoDeOperaciones() {
    const contenedor = document.getElementById('docsOperaciones');
    if (!contenedor) {
      return;
    }
    contenedor.innerHTML = '';

    OPERACIONES_DEL_SISTEMA.forEach((operacion, indice) => {
      contenedor.appendChild(construirTarjetaDeOperacion(operacion, indice));
    });
  }

  /**
   * Construye una tarjeta de operación con pestañas de explicación y código.
   * @param {Object} operacion
   * @param {number} indice
   * @returns {HTMLElement}
   */
  function construirTarjetaDeOperacion(operacion, indice) {
    const identificadorBase = `operacion-${indice}`;
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta-operacion';

    const encabezado = document.createElement('div');
    encabezado.className = 'tarjeta-operacion__encabezado';

    const insigniaMetodo = document.createElement('span');
    insigniaMetodo.className = `insignia-metodo insignia-metodo--${operacion.metodo.toLowerCase()}`;
    insigniaMetodo.textContent = operacion.metodo;

    const rutaOperacion = document.createElement('code');
    rutaOperacion.className = 'tarjeta-operacion__ruta';
    rutaOperacion.textContent = operacion.ruta;

    const descripcion = document.createElement('p');
    descripcion.className = 'tarjeta-operacion__descripcion';
    descripcion.textContent = operacion.descripcion;

    const parametros = document.createElement('p');
    parametros.className = 'tarjeta-operacion__parametros';
    parametros.innerHTML = `<strong>Parámetros:</strong> <code>${operacion.parametros}</code>`;

    encabezado.append(insigniaMetodo, rutaOperacion, descripcion, parametros);
    tarjeta.appendChild(encabezado);

    const listaPestanas = document.createElement('ul');
    listaPestanas.className = 'nav nav-tabs nav-tabs-tecnicas';
    listaPestanas.appendChild(crearPestana(`${identificadorBase}-explicacion`, 'Explicación técnica', true));
    listaPestanas.appendChild(crearPestana(`${identificadorBase}-codigo`, 'Código fuente', false));
    tarjeta.appendChild(listaPestanas);

    const contenidoPestanas = document.createElement('div');
    contenidoPestanas.className = 'tab-content contenido-pestanas';

    const panelExplicacion = document.createElement('div');
    panelExplicacion.className = 'tab-pane fade show active';
    panelExplicacion.id = `${identificadorBase}-explicacion`;
    const parrafoExplicacion = document.createElement('p');
    parrafoExplicacion.className = 'mb-0';
    parrafoExplicacion.textContent = operacion.explicacion;
    panelExplicacion.appendChild(parrafoExplicacion);

    const panelCodigo = document.createElement('div');
    panelCodigo.className = 'tab-pane fade';
    panelCodigo.id = `${identificadorBase}-codigo`;
    const bloqueCodigo = document.createElement('pre');
    bloqueCodigo.className = 'bloque-codigo';
    const codigo = document.createElement('code');
    codigo.textContent = operacion.codigo;
    bloqueCodigo.appendChild(codigo);
    panelCodigo.appendChild(bloqueCodigo);

    contenidoPestanas.append(panelExplicacion, panelCodigo);
    tarjeta.appendChild(contenidoPestanas);
    return tarjeta;
  }

  /**
   * Crea una pestaña Bootstrap.
   * @param {string} idDestino
   * @param {string} etiqueta
   * @param {boolean} activa
   * @returns {HTMLElement}
   */
  function crearPestana(idDestino, etiqueta, activa) {
    const elementoLista = document.createElement('li');
    elementoLista.className = 'nav-item';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = `nav-link${activa ? ' active' : ''}`;
    boton.dataset.bsToggle = 'tab';
    boton.dataset.bsTarget = `#${idDestino}`;
    boton.textContent = etiqueta;
    elementoLista.appendChild(boton);
    return elementoLista;
  }

  /**
   * Construye la tabla del catálogo de sintaxis con botones de carga.
   */
  function construirCatalogoDeSintaxis() {
    const contenedor = document.getElementById('docsSintaxis');
    if (!contenedor) {
      return;
    }
    contenedor.innerHTML = '';

    const tabla = document.createElement('table');
    tabla.className = 'tabla-sintaxis table table-borderless align-middle';
    tabla.innerHTML =
      '<thead><tr>' +
      '<th>Tipo</th><th>Sintaxis de apertura</th><th>Caso de uso</th><th class="text-end">Acción</th>' +
      '</tr></thead>';
    const cuerpo = document.createElement('tbody');

    CATALOGO_SINTAXIS.forEach((entrada) => {
      const fila = document.createElement('tr');

      const celdaTipo = document.createElement('td');
      celdaTipo.innerHTML = `<strong>${entrada.tipo}</strong>`;

      const celdaApertura = document.createElement('td');
      const codigoApertura = document.createElement('code');
      codigoApertura.textContent = entrada.apertura;
      celdaApertura.appendChild(codigoApertura);

      const celdaCasoUso = document.createElement('td');
      celdaUso(celdaCasoUso, entrada.casoUso);

      const celdaAccion = document.createElement('td');
      celdaAccion.className = 'text-end';
      const botonCargar = document.createElement('button');
      botonCargar.type = 'button';
      botonCargar.className = 'btn btn-sm btn-outline-primary';
      botonCargar.innerHTML = '<span class="material-symbols-outlined align-middle" style="font-size:1rem;">input</span> Cargar en Editor';
      botonCargar.addEventListener('click', () => cargarPlantillaEnEditor(entrada.plantillaId));
      celdaAccion.appendChild(botonCargar);

      fila.append(celdaTipo, celdaApertura, celdaCasoUso, celdaAccion);
      cuerpo.appendChild(fila);
    });

    tabla.appendChild(cuerpo);
    contenedor.appendChild(tabla);
  }

  /**
   * Transfiere el snippet de una plantilla al editor mediante el callback.
   * @param {string} identificadorPlantilla
   */
  function cargarPlantillaEnEditor(identificadorPlantilla) {
    const plantilla = Templates.obtenerPlantillaPorIdentificador(identificadorPlantilla);
    if (!plantilla || typeof alCargarSnippetEnEditor !== 'function') {
      return;
    }
    alCargarSnippetEnEditor(plantilla.codigo, plantilla.nombre);
  }

  /**
   * Asigna texto a un elemento por su id si existe.
   * @param {string} identificador
   * @param {string} texto
   */
  function asignarTexto(identificador, texto) {
    const elemento = document.getElementById(identificador);
    if (elemento) {
      elemento.textContent = texto;
    }
  }

  /**
   * Escribe texto en una celda sin interpretar HTML.
   * @param {HTMLElement} celda
   * @param {string} texto
   */
  function celdaUso(celda, texto) {
    celda.textContent = texto;
  }

  /**
   * Redondea el porcentaje de uso para mostrarlo.
   * @param {number} porcentaje
   * @returns {number}
   */
  function redondearPorcentajeDeUso(porcentaje) {
    return Math.round(porcentaje * 10) / 10;
  }

  namespaceOpenMermaid.DocsViewer = {
    inicializarVisorDeDocumentacion,
    refrescarMetricasDeAlmacenamiento
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
