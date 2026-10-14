/**
 * OpenMermaid Studio - Controlador de renderizado Mermaid.
 *
 * Encapsula la interacción con la API global `mermaid`:
 *  - inicialización con tema base,
 *  - validación de sintaxis con `mermaid.parse`,
 *  - renderizado a SVG con identificadores únicos,
 *  - normalización de errores para mostrarlos de forma legible.
 *
 * @module mermaid-renderer
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const PREFIJO_IDENTIFICADOR_RENDER = 'openmermaid-render';

  /** Dimensiones de reserva si el SVG no expone viewBox ni caja medible. */
  const ANCHO_INTRINSECO_PREDETERMINADO = 800;
  const ALTO_INTRINSECO_PREDETERMINADO = 600;

  /**
   * Etiqueta usada cuando el motor no expone su número de versión. Mermaid 12
   * (al igual que 11) no publica `version` en el objeto global, por lo que se
   * muestra la versión mayor fijada en el CDN del documento.
   */
  const VERSION_MERMAID_PREDETERMINADA = '12';

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
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
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
        securityLevel: 'strict',
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
   *  - fuerza render preciso de trazos y texto.
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

    return dimensiones;
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
    intentarRenderizarDiagrama,
    crearTareaConRetardo
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
