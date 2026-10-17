/**
 * OpenMermaid Studio - Controlador de renderizado Mermaid.
 *
 * Encapsula la interacción con la API global `mermaid`:
 *  - inicialización con tema base,
 *  - validación de sintaxis con `mermaid.parse`,
 *  - renderizado a SVG con identificadores únicos,
 *  - normalización de errores para mostrarlos de forma legible,
 *  - conversión de tokens `fa:fa-*` en glifos vectoriales Font Awesome.
 *
 * @module mermaid-renderer
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const PREFIJO_IDENTIFICADOR_RENDER = 'openmermaid-render';

  /** Dimensiones de reserva si el SVG no expone viewBox ni caja medible. */
  const ANCHO_INTRINSECO_PREDETERMINADO = 800;
  const ALTO_INTRINSECO_PREDETERMINADO = 600;

  /** Espacio de nombres XML para crear nodos SVG vía DOM. */
  const ESPACIO_DE_NOMBRES_SVG = 'http://www.w3.org/2000/svg';

  /**
   * Etiqueta usada cuando el motor no expone su número de versión. Mermaid 12
   * (al igual que 11) no publica `version` en el objeto global, por lo que se
   * muestra la versión mayor fijada en el CDN del documento.
   */
  const VERSION_MERMAID_PREDETERMINADA = '12';

  /**
   * Token Font Awesome tal como permanece en el texto cuando Mermaid usa
   * `htmlLabels: false` (no invoca su parser de iconos): `fa:fa-server`,
   * `fab:fa-github`, `fas:fa-user`, `far:fa-circle`, `fal:fa-cube`.
   */
  const PATRON_TOKEN_FONT_AWESOME = /(fa[bklrs]?):fa-([\w-]+)/g;

  /** Traduce el prefijo de estilo al nombre de clase real de Font Awesome 6. */
  const CLASE_POR_PREFIJO_FONT_AWESOME = {
    fa: 'fa-solid',
    fas: 'fa-solid',
    far: 'fa-regular',
    fab: 'fa-brands',
    fal: 'fa-solid',
    fak: 'fa-solid'
  };

  /** Caché de glifos resueltos: `${prefijo}:${nombre}` -> {codigo, familia, peso}. */
  const cacheDeGlifosFontAwesome = new Map();

  let contadorDeRenderizados = 0;

  /**
   * Obtiene una referencia segura al objeto global de mermaid.
   * @returns {Object|null}
   */
  function obtenerMotorMermaid() {
    return typeof window.mermaid !== 'undefined' ? window.mermaid : null;
  }

  /**
   * Indica si el motor Mermaid está disponible (CDN cargado).
   * @returns {boolean}
   */
  function estaMotorMermaidDisponible() {
    return obtenerMotorMermaid() !== null;
  }

  /**
   * Devuelve la versión del motor Mermaid si está expuesta.
   * @returns {string}
   */
  function obtenerVersionDeMermaid() {
    const motor = obtenerMotorMermaid();
    if (!motor) {
      return 'desconocida';
    }
    return motor.version || (motor.mermaidAPI && motor.mermaidAPI.version) || VERSION_MERMAID_PREDETERMINADA;
  }

  /**
   * Inicializa Mermaid con una configuración de tema base.
   * @param {Object} [configuracionAdicional]
   * @returns {boolean} true si se inicializó correctamente
   */
  function inicializarMotorDeRenderizado(configuracionAdicional) {
    const motor = obtenerMotorMermaid();
    if (!motor) {
      return false;
    }

    motor.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif',
      // Las etiquetas se renderizan como <text>/<tspan> nativos en lugar de
      // <foreignObject>. Es imprescindible para poder rasterizar el SVG a PNG/PDF:
      // un <foreignObject> dentro de un SVG cargado como imagen «contamina» el
      // lienzo (Tainted canvases) e impide toBlob/toDataURL en Chromium y Safari.
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: 'basis', useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      ...configuracionAdicional
    });
    return true;
  }

  /**
   * Re-inicializa Mermaid para aplicar cambios globales de configuración.
   * @param {Object} configuracion
   */
  function reconfigurarMotorDeRenderizado(configuracion) {
    const motor = obtenerMotorMermaid();
    if (motor) {
      motor.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif',
        ...configuracion
      });
    }
  }

  /**
   * Valida la sintaxis del código Mermaid. Lanza excepción si es inválido.
   * @param {string} codigoMermaid
   * @returns {Promise<boolean>}
   */
  async function validarSintaxisDeDiagrama(codigoMermaid) {
    const motor = obtenerMotorMermaid();
    if (!motor) {
      throw new Error('El motor Mermaid no está disponible.');
    }
    await motor.parse(codigoMermaid);
    return true;
  }

  /**
   * Genera un identificador único y válido para el contenedor de render.
   * @returns {string}
   */
  function generarIdentificadorDeRenderUnico() {
    contadorDeRenderizados += 1;
    return `${PREFIJO_IDENTIFICADOR_RENDER}-${contadorDeRenderizados}`;
  }

  /**
   * Limpia el mensaje de error que produce Mermaid (contiene ruido de parser).
   * @param {unknown} error
   * @returns {string}
   */
  function normalizarMensajeDeError(error) {
    const mensajeBruto = error && error.message ? String(error.message) : String(error);

    return mensajeBruto
      .replace(/^Error:\s*/i, '')
      .replace(/mermaid version [\d.]+/gi, '')
      .replace(/^\s+|\s+$/g, '')
      .split('\n')
      .slice(0, 6)
      .join('\n')
      .trim() || 'Error de sintaxis desconocido en el diagrama.';
  }

  /**
   * Convierte un atributo de longitud a número, descartando valores relativos.
   * @param {string|null} valor
   * @returns {number|null}
   */
  function convertirLongitudAbsoluta(valor) {
    if (!valor || /%$/.test(valor.trim())) {
      return null;
    }
    const numero = parseFloat(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  /**
   * Deduce las dimensiones intrínsecas del SVG priorizando el `viewBox`, con
   * respaldo en `getBBox()` (cuando existe geometría medible) y, en última
   * instancia, en los atributos `width`/`height` absolutos.
   * @param {SVGSVGElement} elementoSvg
   * @returns {{ancho:number, alto:number}}
   */
  function calcularDimensionesIntrinsecas(elementoSvg) {
    const atributoViewBox = elementoSvg.getAttribute('viewBox');
    if (atributoViewBox) {
      const partes = atributoViewBox.trim().split(/[\s,]+/).map(Number);
      if (partes.length === 4 && partes.every(Number.isFinite) && partes[2] > 0 && partes[3] > 0) {
        return { ancho: Math.ceil(partes[2]), alto: Math.ceil(partes[3]) };
      }
    }

    try {
      if (typeof elementoSvg.getBBox === 'function') {
        const caja = elementoSvg.getBBox();
        if (caja && caja.width > 0 && caja.height > 0) {
          return { ancho: Math.ceil(caja.width), alto: Math.ceil(caja.height) };
        }
      }
    } catch (error) {
      // getBBox falla si el nodo aún no está asociado al documento; se ignora.
    }

    const anchoAtributo = convertirLongitudAbsoluta(elementoSvg.getAttribute('width'));
    const altoAtributo = convertirLongitudAbsoluta(elementoSvg.getAttribute('height'));
    if (anchoAtributo && altoAtributo) {
      return { ancho: Math.ceil(anchoAtributo), alto: Math.ceil(altoAtributo) };
    }

    return { ancho: ANCHO_INTRINSECO_PREDETERMINADO, alto: ALTO_INTRINSECO_PREDETERMINADO };
  }

  /**
   * Normaliza el SVG recién inyectado para garantizar escalado vectorial puro:
   *  - conserva/crea un `viewBox` coherente,
   *  - elimina `width`/`height`/`max-width` en píxeles fijos que Mermaid inyecta,
   *  - hace que el SVG ocupe el 100 % de su contenedor sin deformarse,
   *  - fuerza render preciso de trazos y texto,
   *  - convierte los tokens Font Awesome en glifos vectoriales.
   *
   * Sin esta normalización el SVG se rasteriza a un tamaño mínimo y el zoom por
   * transformación CSS amplía ese mapa de bits (aspecto borroso/pixelado).
   *
   * @param {HTMLElement} elementoContenedor
   * @returns {{ancho:number, alto:number}|null} dimensiones intrínsecas
   */
  function normalizarSvgRenderizado(elementoContenedor) {
    const elementoSvg = elementoContenedor.querySelector('svg');
    if (!elementoSvg) {
      return null;
    }

    const dimensiones = calcularDimensionesIntrinsecas(elementoSvg);

    if (!elementoSvg.getAttribute('viewBox')) {
      elementoSvg.setAttribute('viewBox', `0 0 ${dimensiones.ancho} ${dimensiones.alto}`);
    }
    elementoSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Elimina las restricciones de tamaño que impiden el escalado vectorial.
    // Mermaid inyecta `max-width` (y a veces `min-width`) en píxeles; mientras
    // existan, el SVG deja de ser elástico y el zoom CSS amplía un mapa de bits.
    elementoSvg.removeAttribute('height');
    elementoSvg.removeAttribute('width');
    elementoSvg.style.removeProperty('max-width');
    elementoSvg.style.removeProperty('min-width');
    elementoSvg.style.removeProperty('width');
    elementoSvg.style.removeProperty('height');

    elementoSvg.style.setProperty('width', '100%');
    elementoSvg.style.setProperty('height', '100%');
    elementoSvg.style.setProperty('display', 'block');

    // Se declara por estilo y por atributo: algunos motores de rasterizado
    // (canvas, impresión) solo respetan el atributo de presentación.
    elementoSvg.style.setProperty('shape-rendering', 'geometricPrecision');
    elementoSvg.style.setProperty('text-rendering', 'geometricPrecision');
    elementoSvg.setAttribute('shape-rendering', 'geometricPrecision');
    elementoSvg.setAttribute('text-rendering', 'geometricPrecision');

    elementoSvg.dataset.anchoIntrinseco = String(dimensiones.ancho);
    elementoSvg.dataset.altoIntrinseco = String(dimensiones.alto);

    verificarYRenderizarIconosFontAwesome(elementoSvg);

    return dimensiones;
  }

  /**
   * Extrae el carácter Unicode real del valor CSS `content` (que suele llegar
   * escapado como `"\f233"`). Devuelve cadena vacía si no hay glifo.
   * @param {string} valorContenido
   * @returns {string}
   */
  function extraerCaracterUnicodeDeContenido(valorContenido) {
    if (!valorContenido || valorContenido === 'none' || valorContenido === 'normal') {
      return '';
    }
    const texto = valorContenido.trim().replace(/^["']|["']$/g, '');
    let resultado = '';
    const patronDeEscapes = /\\([0-9a-fA-F]{1,6})\s?|\\(.)/g;
    let coincidencia;
    while ((coincidencia = patronDeEscapes.exec(texto)) !== null) {
      if (coincidencia[1]) {
        resultado += String.fromCodePoint(parseInt(coincidencia[1], 16));
      } else if (coincidencia[2]) {
        resultado += coincidencia[2];
      }
    }
    return resultado || texto;
  }

  /**
   * Resuelve el glifo vectorial de un icono Font Awesome usando un nodo sonda
   * oculto y `getComputedStyle(..., '::before').content`. El resultado se
   * memoriza para no tocar el DOM en cada render.
   * @param {string} prefijo - fa | fas | far | fab | fal | fak
   * @param {string} nombre - nombre del icono sin el prefijo `fa-`
   * @returns {{codigo:string, familia:string, peso:string}|null}
   */
  function resolverGlifoFontAwesome(prefijo, nombre) {
    const clave = `${prefijo}:${nombre}`;
    if (cacheDeGlifosFontAwesome.has(clave)) {
      return cacheDeGlifosFontAwesome.get(clave);
    }

    let resultado = null;
    try {
      const claseDeEstilo = CLASE_POR_PREFIJO_FONT_AWESOME[prefijo] || 'fa-solid';
      const sonda = document.createElement('i');
      sonda.className = `${claseDeEstilo} fa-${nombre}`;
      sonda.setAttribute('aria-hidden', 'true');
      sonda.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
      document.body.appendChild(sonda);

      const pseudoElemento = window.getComputedStyle(sonda, '::before');
      const codigo = extraerCaracterUnicodeDeContenido(pseudoElemento ? pseudoElemento.content : '');
      if (codigo) {
        resultado = {
          codigo,
          familia: (pseudoElemento && pseudoElemento.fontFamily) || 'Font Awesome 6 Free',
          peso: (pseudoElemento && pseudoElemento.fontWeight) || '900'
        };
      }

      document.body.removeChild(sonda);
    } catch (error) {
      resultado = null;
    }

    cacheDeGlifosFontAwesome.set(clave, resultado);
    return resultado;
  }

  /**
   * Sustituye los tokens `fa:fa-*` presentes en cada nodo `<text>`/`<tspan>` por
   * un `<tspan>` hijo que dibuja el glifo con la tipografía Font Awesome. Solo
   * se procesan nodos hoja (sin `<tspan>` descendiente) para no romper la
   * estructura de líneas que genera Mermaid.
   * @param {SVGSVGElement} elementoSvg
   */
  function convertirTokensFontAwesomeEnGlifos(elementoSvg) {
    const nodos = elementoSvg.querySelectorAll('text, tspan');
    nodos.forEach((nodo) => {
      if (nodo.dataset && nodo.dataset.fontAwesomeProcesado === 'true') {
        return;
      }
      if (nodo.querySelector('tspan')) {
        return;
      }

      const textoOriginal = nodo.textContent || '';
      if (!/(fa[bklrs]?):fa-[\w-]+/.test(textoOriginal)) {
        return;
      }

      PATRON_TOKEN_FONT_AWESOME.lastIndex = 0;
      const fragmento = document.createDocumentFragment();
      let ultimoIndice = 0;
      let huboReemplazo = false;
      let coincidencia;

      while ((coincidencia = PATRON_TOKEN_FONT_AWESOME.exec(textoOriginal)) !== null) {
        const textoPrevio = textoOriginal.slice(ultimoIndice, coincidencia.index);
        if (textoPrevio) {
          fragmento.appendChild(document.createTextNode(textoPrevio));
        }

        const glifo = resolverGlifoFontAwesome(coincidencia[1], coincidencia[2]);
        if (glifo) {
          const tspanIcono = document.createElementNS(ESPACIO_DE_NOMBRES_SVG, 'tspan');
          tspanIcono.setAttribute('class', 'openmermaid-icono-font-awesome');
          tspanIcono.setAttribute('font-family', glifo.familia);
          tspanIcono.setAttribute('font-weight', glifo.peso);
          tspanIcono.setAttribute('aria-hidden', 'true');
          tspanIcono.textContent = glifo.codigo;
          fragmento.appendChild(tspanIcono);
          fragmento.appendChild(document.createTextNode('\u2009'));
          huboReemplazo = true;
        } else {
          fragmento.appendChild(document.createTextNode(coincidencia[0]));
        }

        ultimoIndice = PATRON_TOKEN_FONT_AWESOME.lastIndex;
      }

      if (!huboReemplazo) {
        return;
      }

      const textoRestante = textoOriginal.slice(ultimoIndice);
      if (textoRestante) {
        fragmento.appendChild(document.createTextNode(textoRestante));
      }

      nodo.textContent = '';
      nodo.appendChild(fragmento);
      if (nodo.dataset) {
        nodo.dataset.fontAwesomeProcesado = 'true';
      }
    });
  }

  /**
   * Normaliza nodos `<i class="fa...">` por si el SVG se generó con
   * `htmlLabels` habilitado (defensivo; en esta app no debería ocurrir).
   * @param {SVGSVGElement} elementoSvg
   */
  function normalizarNodosDeIconoHtml(elementoSvg) {
    elementoSvg.querySelectorAll('i[class*="fa-"]').forEach((nodo) => {
      if (!nodo.getAttribute('aria-hidden')) {
        nodo.setAttribute('aria-hidden', 'true');
      }
      if (nodo.hasAttribute('font-size')) {
        nodo.removeAttribute('font-size');
      }
    });
  }

  /**
   * Garantiza que los tokens Font Awesome se conviertan en glifos vectoriales
   * dentro del SVG renderizado, de modo que la exportación PNG/PDF no muestre
   * cuadros vacíos (los iconos heredan la tipografía incrustada al exportar).
   * @param {SVGSVGElement} svgElement
   */
  function verificarYRenderizarIconosFontAwesome(svgElement) {
    if (!svgElement || typeof svgElement.querySelectorAll !== 'function') {
      return;
    }
    try {
      convertirTokensFontAwesomeEnGlifos(svgElement);
      normalizarNodosDeIconoHtml(svgElement);
    } catch (error) {
      // Nunca debe interrumpir el render: si falla, los tokens quedan literales.
    }
  }

  /**
   * Renderiza el diagrama dentro del contenedor indicado.
   * @param {string} codigoMermaid
   * @param {HTMLElement} elementoContenedor
   * @returns {Promise<{exito:boolean, svg?:string, dimensiones?:{ancho:number, alto:number}, mensajeError?:string}>}
   */
  async function intentarRenderizarDiagrama(codigoMermaid, elementoContenedor) {
    if (!estaMotorMermaidDisponible()) {
      return { exito: false, mensajeError: 'El motor Mermaid no se ha cargado desde el CDN.' };
    }

    if (!codigoMermaid || !codigoMermaid.trim()) {
      elementoContenedor.innerHTML = '';
      return { exito: false, mensajeError: 'El editor está vacío. Escribe o carga una plantilla.' };
    }

    try {
      await validarSintaxisDeDiagrama(codigoMermaid);
      const identificador = generarIdentificadorDeRenderUnico();
      const resultado = await obtenerMotorMermaid().render(identificador, codigoMermaid);
      elementoContenedor.innerHTML = resultado.svg;
      const dimensiones = normalizarSvgRenderizado(elementoContenedor);
      return { exito: true, svg: resultado.svg, dimensiones };
    } catch (error) {
      return { exito: false, mensajeError: normalizarMensajeDeError(error) };
    }
  }

  /**
   * Crea una función "debounced" que retrasa la ejecución de la tarea.
   * @param {Function} tarea
   * @param {number} milisegundosDeEspera
   * @returns {Function} función aplazada con método .cancelar()
   */
  function crearTareaConRetardo(tarea, milisegundosDeEspera) {
    let identificadorDeTemporizador = null;

    const tareaAplazada = function (...argumentos) {
      if (identificadorDeTemporizador !== null) {
        clearTimeout(identificadorDeTemporizador);
      }
      identificadorDeTemporizador = setTimeout(() => {
        identificadorDeTemporizador = null;
        tarea(...argumentos);
      }, milisegundosDeEspera);
    };

    tareaAplazada.cancelar = function () {
      if (identificadorDeTemporizador !== null) {
        clearTimeout(identificadorDeTemporizador);
        identificadorDeTemporizador = null;
      }
    };

    return tareaAplazada;
  }

  namespaceOpenMermaid.MermaidRenderer = {
    estaMotorMermaidDisponible,
    obtenerVersionDeMermaid,
    inicializarMotorDeRenderizado,
    reconfigurarMotorDeRenderizado,
    validarSintaxisDeDiagrama,
    normalizarMensajeDeError,
    calcularDimensionesIntrinsecas,
    normalizarSvgRenderizado,
    verificarYRenderizarIconosFontAwesome,
    intentarRenderizarDiagrama,
    crearTareaConRetardo
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
