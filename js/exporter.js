/**
 * OpenMermaid Studio - Suite de exportación de alta fidelidad.
 *
 * Transforma el SVG renderizado por Mermaid y el código fuente en archivos de
 * salida o contenido de portapapeles:
 *  - SVG autónomo y 100 % vectorial, con dimensiones/namespaces explícitos y
 *    encabezado XML, listo para escalar de forma infinita.
 *  - PNG rasterizado por la Canvas API con super-sampling (1x / 2x / 3x / 4x y
 *    superiores) para pantallas HiDPI/Retina e imprenta.
 *  - PDF A4/Carta generado con jsPDF, con orientación automática y rasterizado
 *    a alta densidad para que el documento no se pixele al ampliarlo.
 *  - Código fuente .mmd.
 *  - Portapapeles de código, SVG o PNG.
 *  - Marca de agua / pie de página opcional (proyecto, autor y fecha).
 *
 * Notas de compatibilidad Canvas/SVG:
 *  - Para rasterizar un SVG es imprescindible que tenga `viewBox`, `width`,
 *    `height` y los namespaces XML; si faltan, Safari y ciertos Firefox dibujan
 *    un lienzo vacío. Por eso se normaliza el clon antes de crear la imagen.
 *  - Se priorizan las `data:` URLs (y se recurre a Blob URLs como respaldo) y
 *    se neutralizan los `<foreignObject>`/imágenes externas antes de dibujar,
 *    de modo que el lienzo nunca quede «tainted» y `toBlob`/`toDataURL`
 *    funcionen incluso al abrir la aplicación con el protocolo `file://`.
 *  - Las fuentes de Font Awesome se incrustan como `base64` dentro del SVG:
 *    un SVG cargado como imagen no resuelve tipografías del documento ni,
 *    necesariamente, `@font-face` remotos, de ahí que sea obligatorio
 *    incrustarlas para que los iconos aparezcan en PNG/PDF.
 *
 * Este módulo es puro (no conoce la interfaz): toda la retroalimentación al
 * usuario (loaders y toasts de SweetAlert2) vive en `export-dialog.js` y en el
 * despachador central `alerts.js`.
 *
 * @module exporter
 */

(function (namespaceOpenMermaid) {
  'use strict';

  const NAMESPACE_SVG = 'http://www.w3.org/2000/svg';
  const NAMESPACE_XLINK = 'http://www.w3.org/1999/xlink';
  const ENCABEZADO_XML = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';

  const TIPO_MIME_PNG = 'image/png';
  const TIPO_MIME_SVG = 'image/svg+xml;charset=utf-8';
  const TIPO_MIME_SVG_PLANO = 'image/svg+xml';
  const TIPO_MIME_TEXTO = 'text/plain;charset=utf-8';
  const TIPO_MIME_WOFF2 = 'font/woff2';

  // --- Resolución / imprenta ---
  const FACTOR_RASTERIZADO_PDF = 3;
  const FACTOR_RASTERIZADO_PORTAPAPELES = 2;
  const MARGEN_PDF_MILIMETROS = 12;
  const DIMENSIONES_PREDETERMINADAS = { ancho: 800, alto: 600 };

  // --- Marca de agua / pie de página ---
  const MARCA_DE_AGUA_MARGEN = 12;
  const MARCA_DE_AGUA_TAMANO_FUENTE = 12;
  const MARCA_DE_AGUA_RELLENO = 'rgba(15, 23, 42, 0.72)';
  const MARCA_DE_AGUA_TEXTO = '#f8fafc';

  // --- Fuentes Font Awesome (para incrustar como base64 al exportar) ---
  const URL_WEBCFONTS_FONT_AWESOME = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/';
  const FUENTES_FONT_AWESOME = [
    { familia: 'Font Awesome 6 Free', peso: '900', archivo: 'fa-solid-900.woff2' },
    { familia: 'Font Awesome 6 Free', peso: '400', archivo: 'fa-regular-400.woff2' },
    { familia: 'Font Awesome 6 Brands', peso: '400', archivo: 'fa-brands-400.woff2' }
  ];
  /** Caché archivo -> base64|null (null indica que la descarga falló). */
  const cacheDeFuentesFontAwesome = new Map();

  /**
   * Fondos predefinidos ofrecidos por el diálogo de exportación.
   * `transparente` se representa con `null`.
   */
  const PRESETS_DE_FONDO = {
    transparente: null,
    blanco: '#ffffff',
    oscuro: '#0f172a'
  };

  // ------------------------------------------------------------------------
  // Medición vectorial
  // ------------------------------------------------------------------------

  /**
   * Lee los límites vectoriales del diagrama priorizando el `viewBox` y usando
   * `getBBox()`/`getBoundingClientRect()` como respaldo defensivo.
   * @param {SVGSVGElement} elementoSvg
   * @returns {{x:number, y:number, ancho:number, alto:number}}
   */
  function medirLimitesVectoriales(elementoSvg) {
    const atributoViewBox = elementoSvg.getAttribute && elementoSvg.getAttribute('viewBox');
    if (atributoViewBox) {
      const partes = atributoViewBox.trim().split(/[\s,]+/).map(Number);
      if (partes.length === 4 && partes.every(Number.isFinite) && partes[2] > 0 && partes[3] > 0) {
        return { x: partes[0], y: partes[1], ancho: partes[2], alto: partes[3] };
      }
    }

    try {
      const baseVal = elementoSvg.viewBox && elementoSvg.viewBox.baseVal;
      if (baseVal && baseVal.width > 0 && baseVal.height > 0) {
        return { x: baseVal.x, y: baseVal.y, ancho: baseVal.width, alto: baseVal.height };
      }
    } catch (error) { /* viewBox no accesible: se continúa con los respaldos */ }

    try {
      if (typeof elementoSvg.getBBox === 'function') {
        const caja = elementoSvg.getBBox();
        if (caja && caja.width > 0 && caja.height > 0) {
          return { x: caja.x, y: caja.y, ancho: caja.width, alto: caja.height };
        }
      }
    } catch (error) { /* getBBox no disponible (p. ej. jsdom) */ }

    try {
      const rectangulo = elementoSvg.getBoundingClientRect && elementoSvg.getBoundingClientRect();
      if (rectangulo && rectangulo.width > 0 && rectangulo.height > 0) {
        return { x: 0, y: 0, ancho: rectangulo.width, alto: rectangulo.height };
      }
    } catch (error) { /* sin layout medible */ }

    const datos = elementoSvg.dataset || {};
    const anchoDatos = Number(datos.anchoIntrinseco);
    const altoDatos = Number(datos.altoIntrinseco);
    if (anchoDatos > 0 && altoDatos > 0) {
      return { x: 0, y: 0, ancho: anchoDatos, alto: altoDatos };
    }

    return { x: 0, y: 0, ancho: DIMENSIONES_PREDETERMINADAS.ancho, alto: DIMENSIONES_PREDETERMINADAS.alto };
  }

  /**
   * Calcula las dimensiones intrínsecas (enteras) del SVG.
   * @param {SVGSVGElement} elementoSvg
   * @returns {{ancho:number, alto:number}}
   */
  function calcularDimensionesIntrinsecasDelSvg(elementoSvg) {
    const limites = medirLimitesVectoriales(elementoSvg);
    return { ancho: Math.max(1, Math.ceil(limites.ancho)), alto: Math.max(1, Math.ceil(limites.alto)) };
  }

  // ------------------------------------------------------------------------
  // Incrustado de fuentes Font Awesome (base64)
  // ------------------------------------------------------------------------

  /**
   * Convierte un ArrayBuffer a base64 sin desbordar la pila (procesa por bloques).
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
  function convertirArrayBufferABase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const tamanoBloque = 0x8000;
    let binario = '';
    for (let indice = 0; indice < bytes.length; indice += tamanoBloque) {
      binario += String.fromCharCode.apply(null, bytes.subarray(indice, indice + tamanoBloque));
    }
    return window.btoa(binario);
  }

  /**
   * Descarga una fuente de Font Awesome desde el CDN y la devuelve en base64.
   * El resultado (o `null` si falla) se memoriza para no repetir la petición.
   * @param {string} archivo
   * @returns {Promise<string|null>}
   */
  async function obtenerFuenteFontAwesomeEnBase64(archivo) {
    if (cacheDeFuentesFontAwesome.has(archivo)) {
      return cacheDeFuentesFontAwesome.get(archivo);
    }

    let base64 = null;
    try {
      if (typeof fetch === 'function') {
        const respuesta = await fetch(`${URL_WEBCFONTS_FONT_AWESOME}${archivo}`, { mode: 'cors' });
        if (respuesta && respuesta.ok) {
          base64 = convertirArrayBufferABase64(await respuesta.arrayBuffer());
        }
      }
    } catch (error) {
      base64 = null;
    }

    cacheDeFuentesFontAwesome.set(archivo, base64);
    return base64;
  }

  /**
   * Incrusta las tipografías de Font Awesome dentro del SVG clonado. Si la
   * descarga a base64 funciona, la fuente queda embebida (imprescindible para
   * que la rasterización a Canvas resuelva los glifos); en caso contrario se
   * recurre a la URL remota del CDN como respaldo.
   * @param {SVGSVGElement} svgElement
   * @returns {Promise<SVGSVGElement>}
   */
  async function incrustarFuentesFontAwesomeEnSvg(svgElement) {
    if (!svgElement || typeof svgElement.querySelectorAll !== 'function') {
      return svgElement;
    }

    const declaraciones = [];
    for (const fuente of FUENTES_FONT_AWESOME) {
      const base64 = await obtenerFuenteFontAwesomeEnBase64(fuente.archivo);
      const origenDeDatos = base64
        ? `url("data:${TIPO_MIME_WOFF2};base64,${base64}") format("woff2")`
        : `url("${URL_WEBCFONTS_FONT_AWESOME}${fuente.archivo}") format("woff2")`;
      declaraciones.push(
        `@font-face { font-family: "${fuente.familia}"; font-style: normal; font-weight: ${fuente.peso}; font-display: block; src: ${origenDeDatos}; }`
      );
    }
    declaraciones.push(
      '.fa, .fas, .far, .fab, .openmermaid-icono-font-awesome { font-family: "Font Awesome 6 Free", "Font Awesome 6 Brands", sans-serif; }'
    );

    const estilo = document.createElementNS(NAMESPACE_SVG, 'style');
    estilo.setAttribute('data-font-awesome', 'true');
    estilo.textContent = declaraciones.join(' ');

    if (svgElement.firstChild) {
      svgElement.insertBefore(estilo, svgElement.firstChild);
    } else {
      svgElement.appendChild(estilo);
    }
    return svgElement;
  }

  // ------------------------------------------------------------------------
  // Marca de agua / pie de página
  // ------------------------------------------------------------------------

  /**
   * Construye el grupo SVG del pie de página (píldora + texto) anclado en la
   * esquina inferior derecha del `viewBox`.
   * @param {number} ancho
   * @param {number} alto
   * @param {{texto:string, colorTexto?:string, colorFondo?:string, opacidad?:number}} marcaDeAgua
   * @param {{x?:number, y?:number}} [origen] desplazamiento del viewBox (x/y)
   * @returns {SVGGElement|null}
   */
  function construirMarcaDeAguaSvg(ancho, alto, marcaDeAgua, origen) {
    if (!marcaDeAgua || typeof marcaDeAgua.texto !== 'string' || !marcaDeAgua.texto.trim()) {
      return null;
    }

    const origenX = origen && Number.isFinite(origen.x) ? origen.x : 0;
    const origenY = origen && Number.isFinite(origen.y) ? origen.y : 0;
    const texto = marcaDeAgua.texto.trim();
    const tamanoFuente = MARCA_DE_AGUA_TAMANO_FUENTE;
    const rellenoHorizontal = 9;
    const rellenoVertical = 5;

    const anchoPildora = Math.max(48, texto.length * tamanoFuente * 0.62 + rellenoHorizontal * 2);
    const altoPildora = tamanoFuente + rellenoVertical * 2;
    const x = Math.max(origenX + MARCA_DE_AGUA_MARGEN, origenX + ancho - MARCA_DE_AGUA_MARGEN - anchoPildora);
    const y = Math.max(origenY + MARCA_DE_AGUA_MARGEN, origenY + alto - MARCA_DE_AGUA_MARGEN - altoPildora);

    const grupo = document.createElementNS(NAMESPACE_SVG, 'g');
    grupo.setAttribute('class', 'openmermaid-marca-de-agua');
    grupo.setAttribute('pointer-events', 'none');

    const pildora = document.createElementNS(NAMESPACE_SVG, 'rect');
    pildora.setAttribute('x', String(x));
    pildora.setAttribute('y', String(y));
    pildora.setAttribute('width', String(anchoPildora));
    pildora.setAttribute('height', String(altoPildora));
    pildora.setAttribute('rx', '6');
    pildora.setAttribute('fill', marcaDeAgua.colorFondo || MARCA_DE_AGUA_RELLENO);
    pildora.setAttribute('opacity', String(marcaDeAgua.opacidad ?? 0.92));

    const nodoTexto = document.createElementNS(NAMESPACE_SVG, 'text');
    nodoTexto.setAttribute('x', String(origenX + ancho - MARCA_DE_AGUA_MARGEN - rellenoHorizontal));
    nodoTexto.setAttribute('y', String(y + altoPildora - rellenoVertical - 1));
    nodoTexto.setAttribute('text-anchor', 'end');
    nodoTexto.setAttribute('font-family', "'Inter', 'Segoe UI', system-ui, sans-serif");
    nodoTexto.setAttribute('font-size', String(tamanoFuente));
    nodoTexto.setAttribute('fill', marcaDeAgua.colorTexto || MARCA_DE_AGUA_TEXTO);
    nodoTexto.textContent = texto;

    grupo.append(pildora, nodoTexto);
    return grupo;
  }

  // ------------------------------------------------------------------------
  // Construcción del SVG exportable
  // ------------------------------------------------------------------------

  /**
   * Elimina del clon los estilos interactivos del visor (zoom, transform,
   * escalado al 100 %) que romperían la exportación.
   * @param {SVGSVGElement} clonSvg
   */
  function limpiarEstilosInteractivos(clonSvg) {
    clonSvg.removeAttribute('style');
    ['width', 'height', 'max-width', 'min-width', 'transform', 'transform-origin'].forEach((propiedad) => {
      if (clonSvg.style) {
        clonSvg.style.removeProperty(propiedad);
      }
    });
  }

  /**
   * Neutraliza en el clon todo lo que «contaminaría» (tainting) el lienzo al
   * rasterizar el SVG: un `<foreignObject>` dentro de un SVG cargado como
   * imagen provoca `Tainted canvases may not be exported` en Chromium y Safari,
   * y las imágenes externas (no `data:`) también lo contaminan. Se aplica solo
   * al clon destinado al lienzo; el SVG descargable se conserva intacto.
   * @param {SVGSVGElement} clonSvg
   */
  function neutralizarRecursosQueContaminanLienzo(clonSvg) {
    if (typeof clonSvg.querySelectorAll !== 'function') {
      return;
    }

    clonSvg.querySelectorAll('foreignObject').forEach((foreignObject) => {
      const padre = foreignObject.parentNode;
      if (!padre) return;
      const texto = (foreignObject.textContent || '').replace(/\s+/g, ' ').trim();
      if (!texto) {
        padre.removeChild(foreignObject);
        return;
      }
      const x = Number(foreignObject.getAttribute('x')) || 0;
      const y = Number(foreignObject.getAttribute('y')) || 0;
      const ancho = Number(foreignObject.getAttribute('width')) || 0;
      const alto = Number(foreignObject.getAttribute('height')) || 0;
      const reemplazo = document.createElementNS(NAMESPACE_SVG, 'text');
      reemplazo.setAttribute('x', String(x + ancho / 2));
      reemplazo.setAttribute('y', String(y + alto / 2));
      reemplazo.setAttribute('text-anchor', 'middle');
      reemplazo.setAttribute('dominant-baseline', 'middle');
      reemplazo.setAttribute('font-size', '14');
      reemplazo.textContent = texto;
      padre.replaceChild(reemplazo, foreignObject);
    });

    clonSvg.querySelectorAll('image').forEach((imagen) => {
      const href = imagen.getAttribute('href')
        || imagen.getAttributeNS(NAMESPACE_XLINK, 'href')
        || '';
      if (href && !/^data:/i.test(href)) {
        if (imagen.parentNode) {
          imagen.parentNode.removeChild(imagen);
        }
      }
    });
  }

  /**
   * Garantiza que el clon incluya una hoja de estilo coherente para textos.
   * Los `<style>` internos del SVG ya viajan con `cloneNode(true)`; aquí se
   * añade un bloque de fuente para evitar tipografías de reemplazo genéricas.
   * @param {SVGSVGElement} clonSvg
   * @returns {SVGSVGElement}
   */
  function asegurarEstilosIncrustados(clonSvg) {
    const selector = 'style[data-openmermaid-exportacion]';
    if (typeof clonSvg.querySelector === 'function' && clonSvg.querySelector(selector)) {
      return clonSvg;
    }
    const estilo = document.createElementNS(NAMESPACE_SVG, 'style');
    estilo.setAttribute('data-openmermaid-exportacion', 'true');
    estilo.textContent =
      'text, tspan, .nodeLabel, .edgeLabel, .label, foreignObject {' +
      ' font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; }';
    clonSvg.insertBefore(estilo, clonSvg.firstChild);
    return clonSvg;
  }

  /**
   * Inserta el rectángulo de fondo cubriendo exactamente el `viewBox`.
   * @param {SVGSVGElement} clonSvg
   * @param {{x:number, y:number, ancho:number, alto:number}} limites
   * @param {string} colorFondo
   */
  function insertarFondoEnSvg(clonSvg, limites, colorFondo) {
    const rectangulo = document.createElementNS(NAMESPACE_SVG, 'rect');
    rectangulo.setAttribute('x', String(limites.x));
    rectangulo.setAttribute('y', String(limites.y));
    rectangulo.setAttribute('width', String(limites.ancho));
    rectangulo.setAttribute('height', String(limites.alto));
    rectangulo.setAttribute('fill', colorFondo);
    clonSvg.insertBefore(rectangulo, clonSvg.firstChild);
  }

  /**
   * Construye el clon SVG autónomo listo para serializar o rasterizar.
   * @param {SVGSVGElement} elementoSvg
   * @param {{colorFondo:string|null, marcaDeAgua:Object|null}} opcionesResueltas
   * @param {boolean} [paraRasterizado] neutraliza recursos que contaminan el lienzo
   * @param {boolean} [incrustarFuentes] embebe Font Awesome en base64 en el clon
   * @returns {Promise<{clonSvg:SVGSVGElement, ancho:number, alto:number, limites:Object}>}
   */
  async function construirSvgExportable(elementoSvg, opcionesResueltas, paraRasterizado, incrustarFuentes) {
    const { colorFondo, marcaDeAgua } = opcionesResueltas;
    const limites = medirLimitesVectoriales(elementoSvg);
    const ancho = Math.max(1, Math.ceil(limites.ancho));
    const alto = Math.max(1, Math.ceil(limites.alto));

    const clonSvg = elementoSvg.cloneNode(true);
    limpiarEstilosInteractivos(clonSvg);

    if (paraRasterizado) {
      neutralizarRecursosQueContaminanLienzo(clonSvg);
    }

    clonSvg.setAttribute('viewBox', `${limites.x} ${limites.y} ${limites.ancho} ${limites.alto}`);
    clonSvg.setAttribute('width', String(ancho));
    clonSvg.setAttribute('height', String(alto));
    clonSvg.setAttribute('xmlns', NAMESPACE_SVG);
    clonSvg.setAttribute('xmlns:xlink', NAMESPACE_XLINK);
    clonSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    asegurarEstilosIncrustados(clonSvg);

    if (incrustarFuentes) {
      await incrustarFuentesFontAwesomeEnSvg(clonSvg);
    }

    if (colorFondo) {
      insertarFondoEnSvg(clonSvg, limites, colorFondo);
    }

    const grupoMarcaDeAgua = construirMarcaDeAguaSvg(ancho, alto, marcaDeAgua, limites);
    if (grupoMarcaDeAgua) {
      clonSvg.appendChild(grupoMarcaDeAgua);
    }

    return { clonSvg, ancho, alto, limites };
  }

  /**
   * Serializa el SVG como documento autónomo con encabezado XML.
   * @param {SVGSVGElement} elementoSvg
   * @param {string|null} colorFondo color sólido o null para transparencia
   * @param {{texto:string, colorTexto?:string, colorFondo?:string, opacidad?:number}|null} [marcaDeAgua]
   * @param {boolean} [paraRasterizado] neutraliza recursos que contaminan el lienzo
   * @param {boolean} [incrustarFuentes] embebe Font Awesome en base64 en el clon
   * @returns {Promise<{cadenaSvg:string, ancho:number, alto:number}>}
   */
  async function serializarSvgAutonomo(elementoSvg, colorFondo, marcaDeAgua, paraRasterizado, incrustarFuentes) {
    const { clonSvg, ancho, alto } = await construirSvgExportable(
      elementoSvg,
      { colorFondo, marcaDeAgua },
      paraRasterizado,
      incrustarFuentes
    );
    const cuerpo = new XMLSerializer().serializeToString(clonSvg);
    return { cadenaSvg: `${ENCABEZADO_XML}${cuerpo}`, ancho, alto };
  }

  // ------------------------------------------------------------------------
  // Rasterizado (Canvas API)
  // ------------------------------------------------------------------------

  /**
   * Carga una imagen a partir de una URL y espera su decodificación.
   * @param {string} urlImagen
   * @returns {Promise<HTMLImageElement>}
   */
  function cargarImagenDesdeUrl(urlImagen) {
    return new Promise((resolver, rechazar) => {
      const imagen = new Image();
      imagen.onload = () => resolver(imagen);
      imagen.onerror = () => rechazar(new Error('No se pudo rasterizar el SVG a una imagen.'));
      imagen.src = urlImagen;
    });
  }

  /**
   * Serializa una cadena SVG a una imagen cargada.
   *
   * Se prioriza la `data:` URL porque un SVG cargado desde `data:` nunca
   * «contamina» el lienzo, a diferencia de las Blob URL cuando la aplicación se
   * abre directamente con el protocolo `file://` (origen opaco), donde el canvas
   * quedaría marcado como tainted. Las Blob URL se conservan como respaldo para
   * diagramas tan grandes que rebasen los límites prácticos de una data URL.
   * @param {string} cadenaSvg
   * @returns {Promise<HTMLImageElement>}
   */
  async function cargarImagenDesdeCadenaSvg(cadenaSvg) {
    try {
      return await cargarImagenDesdeUrl(`data:${TIPO_MIME_SVG},${encodeURIComponent(cadenaSvg)}`);
    } catch (error) {
      const puedeUsarBlob = typeof Blob !== 'undefined' && typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function';
      if (!puedeUsarBlob) {
        throw error;
      }
      const urlBlob = URL.createObjectURL(new Blob([cadenaSvg], { type: TIPO_MIME_SVG }));
      return cargarImagenDesdeUrl(urlBlob).finally(() => URL.revokeObjectURL(urlBlob));
    }
  }

  /**
   * Rasteriza el SVG a un lienzo fuera de pantalla con super-sampling.
   * @param {SVGSVGElement} elementoSvg
   * @param {number} factorEscala multiplicador de densidad (1x, 2x, 3x, 4x…)
   * @param {string|null} colorFondo
   * @param {{texto:string, colorTexto?:string, colorFondo?:string, opacidad?:number}|null} [marcaDeAgua]
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function rasterizarSvgALienzo(elementoSvg, factorEscala, colorFondo, marcaDeAgua) {
    const escala = Number.isFinite(factorEscala) && factorEscala > 0 ? factorEscala : 1;
    const { cadenaSvg, ancho, alto } = await serializarSvgAutonomo(elementoSvg, colorFondo, marcaDeAgua, true, true);
    const imagen = await cargarImagenDesdeCadenaSvg(cadenaSvg);

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));

    const contexto = lienzo.getContext('2d');
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = 'high';
    if (colorFondo) {
      contexto.fillStyle = colorFondo;
      contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    }
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    return lienzo;
  }

  /**
   * Convierte el lienzo a un Blob PNG.
   * @param {HTMLCanvasElement} lienzo
   * @returns {Promise<Blob>}
   */
  function convertirLienzoABlobPng(lienzo) {
    return new Promise((resolver, rechazar) => {
      lienzo.toBlob((blob) => {
        if (blob) {
          resolver(blob);
        } else {
          rechazar(new Error('No se pudo generar el PNG desde el lienzo.'));
        }
      }, TIPO_MIME_PNG);
    });
  }

  // ------------------------------------------------------------------------
  // Opciones y utilidades
  // ------------------------------------------------------------------------

  /**
   * Normaliza las opciones de exportación (fondo y marca de agua), admitiendo
   * tanto presets (`fondo`) como colores explícitos y la API heredada.
   * @param {{fondo?:string, colorFondo?:string|null, fondoTransparente?:boolean, marcaDeAgua?:Object|null}|undefined} opciones
   * @returns {{colorFondo:string|null, marcaDeAgua:Object|null}}
   */
  function resolverOpcionesDeExportacion(opciones) {
    const configuracion = opciones || {};
    let colorFondo;

    if (typeof configuracion.fondo === 'string') {
      const preset = configuracion.fondo.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(PRESETS_DE_FONDO, preset)) {
        colorFondo = PRESETS_DE_FONDO[preset];
      } else if (preset === 'tema') {
        colorFondo = configuracion.colorFondo || PRESETS_DE_FONDO.blanco;
      } else {
        colorFondo = configuracion.fondo;
      }
    } else if (configuracion.fondoTransparente) {
      colorFondo = null;
    } else {
      colorFondo = configuracion.colorFondo || PRESETS_DE_FONDO.blanco;
    }

    const marcaDeAgua = configuracion.marcaDeAgua && configuracion.marcaDeAgua.texto
      ? configuracion.marcaDeAgua
      : null;

    return { colorFondo, marcaDeAgua };
  }

  /**
   * Asegura que el nombre de archivo tenga la extensión indicada.
   * @param {string} nombreArchivo
   * @param {string} extension
   * @returns {string}
   */
  function asegurarExtension(nombreArchivo, extension) {
    const nombreBase = (nombreArchivo || 'diagrama-openmermaid').replace(/\.(svg|png|pdf|mmd|txt)$/i, '');
    return `${nombreBase}.${extension}`;
  }

  /**
   * Descarga un Blob como archivo usando un enlace temporal.
   * @param {Blob} blob
   * @param {string} nombreArchivo
   */
  function descargarBlobComoArchivo(blob, nombreArchivo) {
    const urlTemporal = URL.createObjectURL(blob);
    const enlaceDescarga = document.createElement('a');
    enlaceDescarga.href = urlTemporal;
    enlaceDescarga.download = nombreArchivo;
    document.body.appendChild(enlaceDescarga);
    enlaceDescarga.click();
    document.body.removeChild(enlaceDescarga);
    URL.revokeObjectURL(urlTemporal);
  }

  // ------------------------------------------------------------------------
  // Exportaciones a archivo
  // ------------------------------------------------------------------------

  /**
   * Exporta el diagrama como SVG 100 % vectorial y autónomo (con las fuentes
   * Font Awesome incrustadas para que los iconos viajen con el archivo).
   * @param {SVGSVGElement} elementoSvg
   * @param {string} nombreArchivo
   * @param {{fondo?:string, colorFondo?:string|null, fondoTransparente?:boolean, marcaDeAgua?:Object|null}} [opciones]
   * @returns {Promise<{ancho:number, alto:number}>}
   */
  async function exportarSvgLimpio(elementoSvg, nombreArchivo, opciones) {
    const { colorFondo, marcaDeAgua } = resolverOpcionesDeExportacion(opciones);
    const { cadenaSvg, ancho, alto } = await serializarSvgAutonomo(elementoSvg, colorFondo, marcaDeAgua, false, true);
    descargarBlobComoArchivo(new Blob([cadenaSvg], { type: TIPO_MIME_SVG }), asegurarExtension(nombreArchivo, 'svg'));
    return { ancho, alto };
  }

  /**
   * Exporta el diagrama como PNG de alta resolución (HiDPI / super-sampling).
   * @param {SVGSVGElement} elementoSvg
   * @param {number} factorEscala 1x, 2x, 3x, 4x…
   * @param {string} nombreArchivo
   * @param {{fondo?:string, colorFondo?:string|null, fondoTransparente?:boolean, marcaDeAgua?:Object|null}} [opciones]
   * @returns {Promise<{ancho:number, alto:number, factorEscala:number}>}
   */
  async function exportarPngAltaResolucion(elementoSvg, factorEscala, nombreArchivo, opciones) {
    const escala = Number.isFinite(factorEscala) && factorEscala > 0 ? factorEscala : 1;
    const { colorFondo, marcaDeAgua } = resolverOpcionesDeExportacion(opciones);
    const lienzo = await rasterizarSvgALienzo(elementoSvg, escala, colorFondo, marcaDeAgua);
    const blob = await convertirLienzoABlobPng(lienzo);
    const sufijoEscala = escala > 1 ? `@${escala}x` : '';
    descargarBlobComoArchivo(blob, asegurarExtension(`${nombreArchivo}${sufijoEscala}`, 'png'));
    return { ancho: lienzo.width, alto: lienzo.height, factorEscala: escala };
  }

  /**
   * Exporta el diagrama como PDF vectorial de alta densidad, eligiendo la
   * orientación de página según la proporción del diagrama.
   * @param {SVGSVGElement} elementoSvg
   * @param {string} nombreArchivo
   * @param {{fondo?:string, colorFondo?:string|null, marcaDeAgua?:Object|null}} [opciones]
   * @returns {Promise<{orientacion:string}>}
   */
  async function exportarPdfVectorial(elementoSvg, nombreArchivo, opciones) {
    const constructorJsPdf = window.jspdf && window.jspdf.jsPDF;
    if (!constructorJsPdf) {
      throw new Error('La librería jsPDF no está disponible.');
    }

    const { colorFondo, marcaDeAgua } = resolverOpcionesDeExportacion({ ...opciones, fondoTransparente: false });
    const limites = medirLimitesVectoriales(elementoSvg);
    const ancho = limites.ancho;
    const alto = limites.alto;
    const orientacion = ancho >= alto ? 'landscape' : 'portrait';

    const lienzo = await rasterizarSvgALienzo(elementoSvg, FACTOR_RASTERIZADO_PDF, colorFondo, marcaDeAgua);
    const urlDeDatos = lienzo.toDataURL(TIPO_MIME_PNG);

    const documento = new constructorJsPdf({ unit: 'mm', format: 'a4', orientation: orientacion });
    const anchoPagina = documento.internal.pageSize.getWidth();
    const altoPagina = documento.internal.pageSize.getHeight();
    const anchoMaximo = anchoPagina - MARGEN_PDF_MILIMETROS * 2;
    const altoMaximo = altoPagina - MARGEN_PDF_MILIMETROS * 2;
    const proporcion = ancho / alto;

    let anchoDibujo = anchoMaximo;
    let altoDibujo = anchoDibujo / proporcion;
    if (altoDibujo > altoMaximo) {
      altoDibujo = altoMaximo;
      anchoDibujo = altoDibujo * proporcion;
    }

    const posicionX = (anchoPagina - anchoDibujo) / 2;
    const posicionY = (altoPagina - altoDibujo) / 2;
    documento.addImage(urlDeDatos, 'PNG', posicionX, posicionY, anchoDibujo, altoDibujo, undefined, 'FAST');
    documento.save(asegurarExtension(nombreArchivo, 'pdf'));
    return { orientacion };
  }

  /**
   * Exporta el código fuente Mermaid como archivo .mmd.
   * @param {string} codigoMermaid
   * @param {string} nombreArchivo
   */
  function exportarCodigoFuente(codigoMermaid, nombreArchivo) {
    descargarBlobComoArchivo(new Blob([codigoMermaid], { type: TIPO_MIME_TEXTO }), asegurarExtension(nombreArchivo, 'mmd'));
  }

  // ------------------------------------------------------------------------
  // Portapapeles
  // ------------------------------------------------------------------------

  /**
   * Copia el código fuente Mermaid como texto plano.
   * @param {string} codigoMermaid
   * @returns {Promise<void>}
   */
  async function copiarCodigoFuenteAlPortapapeles(codigoMermaid) {
    await navegadorPortapapeles().writeText(codigoMermaid);
  }

  /**
   * Copia el SVG serializado como texto (sin fuentes embebidas para mantener
   * ligero el contenido del portapapeles).
   * @param {SVGSVGElement} elementoSvg
   * @returns {Promise<void>}
   */
  async function copiarSvgAlPortapapeles(elementoSvg) {
    const { cadenaSvg } = await serializarSvgAutonomo(elementoSvg, null, null, false, false);
    await navegadorPortapapeles().writeText(cadenaSvg);
  }

  /**
   * Copia el diagrama como imagen PNG al portapapeles.
   * @param {SVGSVGElement} elementoSvg
   * @param {{fondo?:string, colorFondo?:string|null, fondoTransparente?:boolean, marcaDeAgua?:Object|null}} [opciones]
   * @returns {Promise<void>}
   */
  async function copiarPngAlPortapapeles(elementoSvg, opciones) {
    if (typeof ClipboardItem === 'undefined') {
      throw new Error('El portapapeles de imágenes no es compatible con este navegador.');
    }
    const { colorFondo, marcaDeAgua } = resolverOpcionesDeExportacion(opciones);
    const lienzo = await rasterizarSvgALienzo(elementoSvg, FACTOR_RASTERIZADO_PORTAPAPELES, colorFondo, marcaDeAgua);
    const blob = await convertirLienzoABlobPng(lienzo);
    await navegadorPortapapeles().write([new ClipboardItem({ [TIPO_MIME_PNG]: blob })]);
  }

  /**
   * Devuelve el portapapeles del navegador validando su disponibilidad.
   * @returns {Clipboard}
   */
  function navegadorPortapapeles() {
    if (!navigator.clipboard) {
      throw new Error('El portapapeles no está disponible en este contexto.');
    }
    return navigator.clipboard;
  }

  namespaceOpenMermaid.Exporter = {
    TIPO_MIME_SVG_PLANO,
    PRESETS_DE_FONDO,
    FACTOR_RASTERIZADO_PDF,
    medirLimitesVectoriales,
    calcularDimensionesIntrinsecasDelSvg,
    construirMarcaDeAguaSvg,
    construirSvgExportable,
    incrustarFuentesFontAwesomeEnSvg,
    serializarSvgAutonomo,
    descargarBlobComoArchivo,
    exportarSvgLimpio,
    exportarPngAltaResolucion,
    exportarPdfVectorial,
    exportarCodigoFuente,
    copiarCodigoFuenteAlPortapapeles,
    copiarSvgAlPortapapeles,
    copiarPngAlPortapapeles,
    // Alias heredados (compatibilidad con la API previa).
    exportarComoSvg: exportarSvgLimpio,
    exportarComoPng: exportarPngAltaResolucion,
    exportarComoPdf: exportarPdfVectorial
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
