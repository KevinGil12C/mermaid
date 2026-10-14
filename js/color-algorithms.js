/**
 * OpenMermaid Studio - Motor matemático de color.
 *
 * Este módulo concentra TODA la lógica cromática de la aplicación mediante
 * funciones puras y deterministas. No depende del DOM ni de ninguna
 * biblioteca externa, de modo que puede probarse de forma aislada.
 *
 * Decisiones de diseño relevantes:
 *  - Se trabaja internamente con HSL porque las armonías cromáticas se definen
 *    como desplazamientos de matiz sobre el círculo cromático (0°..360°).
 *  - La conversión RGB<->HSL implementa la variante estándar con croma, que es
 *    estable y evita ramificaciones innecesarias.
 *  - El contraste se calcula con la fórmula WCAG 2.1 de luminancia relativa,
 *    que linealiza cada canal sRGB antes de ponderarlo.
 *
 * @module color-algorithms
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const CANAL_MINIMO = 0;
  const CANAL_MAXIMO = 255;
  const GRADOS_MAXIMOS_MATIZ = 360;
  const BLANCO_PURO = '#ffffff';
  const NEGRO_PURO = '#000000';

  /** Umbral de contraste WCAG AA para texto de tamaño normal. */
  const UMBRAL_CONTRASTE_AA = 4.5;

  /**
   * Catálogo de armonías disponibles. Cada armonía define los desplazamientos
   * de matiz (en grados) que se aplican al matiz base para producir la paleta.
   * @readonly
   */
  const CATALOGO_ARMONIAS = Object.freeze({
    monocromatico: { etiqueta: 'Monocromático', desplazamientosMatiz: [0, 0, 0] },
    analogo: { etiqueta: 'Análogo', desplazamientosMatiz: [-30, 0, 30] },
    complementario: { etiqueta: 'Complementario', desplazamientosMatiz: [0, 180, 180] },
    triadico: { etiqueta: 'Triádico', desplazamientosMatiz: [0, 120, 240] }
  });

  /**
   * Restringe un número al intervalo [minimo, maximo].
   * @param {number} valor
   * @param {number} minimo
   * @param {number} maximo
   * @returns {number}
   */
  function limitarValorEnRango(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
  }

  /**
   * Normaliza un ángulo de matiz al intervalo [0, 360).
   * @param {number} gradosMatiz
   * @returns {number}
   */
  function normalizarGradosDeMatiz(gradosMatiz) {
    return ((gradosMatiz % GRADOS_MAXIMOS_MATIZ) + GRADOS_MAXIMOS_MATIZ) % GRADOS_MAXIMOS_MATIZ;
  }

  /**
   * Redondea un número a un número fijo de decimales.
   * @param {number} valor
   * @param {number} decimales
   * @returns {number}
   */
  function redondearConDecimales(valor, decimales) {
    const factorDeEscala = Math.pow(10, decimales);
    return Math.round(valor * factorDeEscala) / factorDeEscala;
  }

  /**
   * Convierte un código de color HEX (#rgb o #rrggbb) a componentes RGB.
   * @param {string} codigoHex
   * @returns {{r:number, g:number, b:number}}
   */
  function convertirHexARgb(codigoHex) {
    if (typeof codigoHex !== 'string') {
      throw new TypeError('El código HEX debe ser una cadena de texto.');
    }

    const hexLimpio = codigoHex.trim().replace(/^#/, '');
    const hexExpandido = hexLimpio.length === 3
      ? hexLimpio.split('').map((digito) => digito + digito).join('')
      : hexLimpio;

    if (!/^[0-9a-fA-F]{6}$/.test(hexExpandido)) {
      throw new Error(`Código HEX inválido: "${codigoHex}"`);
    }

    return {
      r: parseInt(hexExpandido.slice(0, 2), 16),
      g: parseInt(hexExpandido.slice(2, 4), 16),
      b: parseInt(hexExpandido.slice(4, 6), 16)
    };
  }

  /**
   * Convierte componentes RGB a un código HEX de 6 dígitos.
   * @param {{r:number, g:number, b:number}} colorRgb
   * @returns {string}
   */
  function convertirRgbAHex(colorRgb) {
    const canalAHex = (valorCanal) =>
      limitarValorEnRango(Math.round(valorCanal), CANAL_MINIMO, CANAL_MAXIMO)
        .toString(16)
        .padStart(2, '0');

    return `#${canalAHex(colorRgb.r)}${canalAHex(colorRgb.g)}${canalAHex(colorRgb.b)}`;
  }

  /**
   * Convierte componentes RGB a HSL. Ángulos matiz en grados y porcentajes
   * de saturación/luminosidad en el rango 0..100.
   * @param {{r:number, g:number, b:number}} colorRgb
   * @returns {{h:number, s:number, l:number}}
   */
  function convertirRgbAHsl(colorRgb) {
    const rojoNormalizado = colorRgb.r / CANAL_MAXIMO;
    const verdeNormalizado = colorRgb.g / CANAL_MAXIMO;
    const azulNormalizado = colorRgb.b / CANAL_MAXIMO;

    const canalMaximo = Math.max(rojoNormalizado, verdeNormalizado, azulNormalizado);
    const canalMinimo = Math.min(rojoNormalizado, verdeNormalizado, azulNormalizado);
    const diferenciaCromatica = canalMaximo - canalMinimo;

    let gradosMatiz = 0;
    if (diferenciaCromatica !== 0) {
      if (canalMaximo === rojoNormalizado) {
        gradosMatiz = ((verdeNormalizado - azulNormalizado) / diferenciaCromatica) % 6;
      } else if (canalMaximo === verdeNormalizado) {
        gradosMatiz = (azulNormalizado - rojoNormalizado) / diferenciaCromatica + 2;
      } else {
        gradosMatiz = (rojoNormalizado - verdeNormalizado) / diferenciaCromatica + 4;
      }
      gradosMatiz *= 60;
    }

    const luminosidad = (canalMaximo + canalMinimo) / 2;
    const saturacion = diferenciaCromatica === 0
      ? 0
      : diferenciaCromatica / (1 - Math.abs(2 * luminosidad - 1));

    return {
      h: normalizarGradosDeMatiz(gradosMatiz),
      s: saturacion * 100,
      l: luminosidad * 100
    };
  }

  /**
   * Convierte HSL a componentes RGB.
   * @param {{h:number, s:number, l:number}} colorHsl
   * @returns {{r:number, g:number, b:number}}
   */
  function convertirHslARgb(colorHsl) {
    const saturacion = limitarValorEnRango(colorHsl.s, 0, 100) / 100;
    const luminosidad = limitarValorEnRango(colorHsl.l, 0, 100) / 100;

    const croma = (1 - Math.abs(2 * luminosidad - 1)) * saturacion;
    const matizPrima = normalizarGradosDeMatiz(colorHsl.h) / 60;
    const componenteSecundaria = croma * (1 - Math.abs((matizPrima % 2) - 1));

    let componenteRoja = 0;
    let componenteVerde = 0;
    let componenteAzul = 0;

    if (matizPrima >= 0 && matizPrima < 1) {
      [componenteRoja, componenteVerde, componenteAzul] = [croma, componenteSecundaria, 0];
    } else if (matizPrima < 2) {
      [componenteRoja, componenteVerde, componenteAzul] = [componenteSecundaria, croma, 0];
    } else if (matizPrima < 3) {
      [componenteRoja, componenteVerde, componenteAzul] = [0, croma, componenteSecundaria];
    } else if (matizPrima < 4) {
      [componenteRoja, componenteVerde, componenteAzul] = [0, componenteSecundaria, croma];
    } else if (matizPrima < 5) {
      [componenteRoja, componenteVerde, componenteAzul] = [componenteSecundaria, 0, croma];
    } else {
      [componenteRoja, componenteVerde, componenteAzul] = [croma, 0, componenteSecundaria];
    }

    const ajusteDeLuminosidad = luminosidad - croma / 2;

    return {
      r: Math.round((componenteRoja + ajusteDeLuminosidad) * CANAL_MAXIMO),
      g: Math.round((componenteVerde + ajusteDeLuminosidad) * CANAL_MAXIMO),
      b: Math.round((componenteAzul + ajusteDeLuminosidad) * CANAL_MAXIMO)
    };
  }

  /**
   * Convierte HEX a HSL.
   * @param {string} codigoHex
   * @returns {{h:number, s:number, l:number}}
   */
  function convertirHexAHsl(codigoHex) {
    return convertirRgbAHsl(convertirHexARgb(codigoHex));
  }

  /**
   * Convierte HSL a un código HEX.
   * @param {{h:number, s:number, l:number}} colorHsl
   * @returns {string}
   */
  function convertirHslAHex(colorHsl) {
    return convertirRgbAHex(convertirHslARgb(colorHsl));
  }

  /**
   * Linealiza un canal sRGB según la especificación WCAG 2.1.
   * @param {number} valorCanal valor 0..255
   * @returns {number}
   */
  function linealizarCanalSrgb(valorCanal) {
    const proporcion = valorCanal / CANAL_MAXIMO;
    return proporcion <= 0.03928
      ? proporcion / 12.92
      : Math.pow((proporcion + 0.055) / 1.055, 2.4);
  }

  /**
   * Calcula la luminancia relativa de un color RGB (WCAG 2.1).
   * @param {{r:number, g:number, b:number}} colorRgb
   * @returns {number} valor entre 0 (negro) y 1 (blanco)
   */
  function calcularLuminanciaRelativa(colorRgb) {
    const rojoLineal = linealizarCanalSrgb(colorRgb.r);
    const verdeLineal = linealizarCanalSrgb(colorRgb.g);
    const azulLineal = linealizarCanalSrgb(colorRgb.b);
    return 0.2126 * rojoLineal + 0.7152 * verdeLineal + 0.0722 * azulLineal;
  }

  /**
   * Calcula el ratio de contraste WCAG entre dos colores.
   * @param {string} colorHexUno
   * @param {string} colorHexDos
   * @returns {number} ratio entre 1 y 21
   */
  function calcularRatioDeContraste(colorHexUno, colorHexDos) {
    const luminanciaUno = calcularLuminanciaRelativa(convertirHexARgb(colorHexUno));
    const luminanciaDos = calcularLuminanciaRelativa(convertirHexARgb(colorHexDos));
    const luminanciaMayor = Math.max(luminanciaUno, luminanciaDos);
    const luminanciaMenor = Math.min(luminanciaUno, luminanciaDos);
    return redondearConDecimales((luminanciaMayor + 0.05) / (luminanciaMenor + 0.05), 2);
  }

  /**
   * Decide automáticamente si conviene texto claro u oscuro sobre un fondo.
   * Elige el color que ofrece mayor contraste real medido con WCAG.
   * @param {string} colorFondoHex
   * @returns {string} '#ffffff' o '#000000'
   */
  function determinarColorDeTextoAccesible(colorFondoHex) {
    const contrasteConBlanco = calcularRatioDeContraste(colorFondoHex, BLANCO_PURO);
    const contrasteConNegro = calcularRatioDeContraste(colorFondoHex, NEGRO_PURO);
    return contrasteConBlanco >= contrasteConNegro ? BLANCO_PURO : NEGRO_PURO;
  }

  /**
   * Verifica si un par de colores cumple el umbral WCAG AA.
   * @param {string} colorTextoHex
   * @param {string} colorFondoHex
   * @returns {boolean}
   */
  function cumpleContrasteMinimoAA(colorTextoHex, colorFondoHex) {
    return calcularRatioDeContraste(colorTextoHex, colorFondoHex) >= UMBRAL_CONTRASTE_AA;
  }

  /**
   * Desplaza el matiz de un color HSL, manteniendo saturación y luminosidad.
   * @param {{h:number, s:number, l:number}} colorHsl
   * @param {number} gradosDesplazamiento
   * @returns {{h:number, s:number, l:number}}
   */
  function desplazarMatizDeColor(colorHsl, gradosDesplazamiento) {
    return { ...colorHsl, h: normalizarGradosDeMatiz(colorHsl.h + gradosDesplazamiento) };
  }

  /**
   * Devuelve los matices que definen una armonía a partir de un matiz base.
   * @param {string} tipoEsquema clave en CATALOGO_ARMONIAS
   * @param {number} gradosMatizBase
   * @returns {number[]}
   */
  function obtenerMaticesDeEsquema(tipoEsquema, gradosMatizBase) {
    const armonia = CATALOGO_ARMONIAS[tipoEsquema] || CATALOGO_ARMONIAS.monocromatico;
    return armonia.desplazamientosMatiz.map((desplazamiento) =>
      normalizarGradosDeMatiz(gradosMatizBase + desplazamiento)
    );
  }

  /**
   * Genera una paleta coherente y contrastada a partir de un matiz base.
   *
   * El algoritmo:
   *  1. Deriva los matices de la armonía seleccionada.
   *  2. Fija luminosidades distintas por rol (fondo, primario, secundario…)
   *     según el modo claro u oscuro para garantizar jerarquía visual.
   *  3. Calcula el color de texto de cada superficie con WCAG.
   *
   * @param {Object} opciones
   * @param {number} [opciones.matizBase=210]
   * @param {number} [opciones.saturacionBase=68]
   * @param {string} [opciones.tipoEsquema='analogo']
   * @param {boolean} [opciones.modoOscuro=false]
   * @param {string} [opciones.tipografia]
   * @returns {Object} paleta con roles de color listos para consumir
   */
  function generarPaletaArmonica(opciones) {
    const configuracion = opciones || {};
    const saturacionBase = limitarValorEnRango(configuracion.saturacionBase ?? 68, 0, 100);
    const gradosMatizBase = normalizarGradosDeMatiz(configuracion.matizBase ?? 210);
    const modoOscuro = Boolean(configuracion.modoOscuro);
    const tipoEsquema = configuracion.tipoEsquema in CATALOGO_ARMONIAS
      ? configuracion.tipoEsquema
      : 'analogo';

    const [matizPrimario, matizSecundario, matizTerciario] =
      obtenerMaticesDeEsquema(tipoEsquema, gradosMatizBase);

    const luminosidadPrimario = modoOscuro ? 44 : 74;
    const luminosidadSecundario = modoOscuro ? 36 : 84;
    const luminosidadTerciario = modoOscuro ? 30 : 90;
    const luminosidadBordePrimario = Math.max(12, luminosidadPrimario - 28);

    const colorPrimario = convertirHslAHex({ h: matizPrimario, s: saturacionBase, l: luminosidadPrimario });
    const colorSecundario = convertirHslAHex({ h: matizSecundario, s: Math.max(0, saturacionBase - 8), l: luminosidadSecundario });
    const colorTerciario = convertirHslAHex({ h: matizTerciario, s: Math.max(0, saturacionBase - 16), l: luminosidadTerciario });

    const fondo = convertirHslAHex({
      h: gradosMatizBase,
      s: modoOscuro ? 22 : 30,
      l: modoOscuro ? 12 : 97
    });
    const fondoAgrupador = convertirHslAHex({
      h: gradosMatizBase,
      s: modoOscuro ? 20 : 26,
      l: modoOscuro ? 18 : 93
    });
    const colorLinea = convertirHslAHex({
      h: matizPrimario,
      s: Math.max(0, saturacionBase - 10),
      l: modoOscuro ? 62 : 42
    });

    return {
      nombreEsquema: CATALOGO_ARMONIAS[tipoEsquema].etiqueta,
      tipoEsquema,
      matizBase: gradosMatizBase,
      saturacionBase,
      modoOscuro,
      fondo,
      fondoAgrupador,
      colorPrimario,
      colorPrimarioTexto: determinarColorDeTextoAccesible(colorPrimario),
      colorPrimarioBorde: convertirHslAHex({ h: matizPrimario, s: saturacionBase, l: luminosidadBordePrimario }),
      colorSecundario,
      colorSecundarioTexto: determinarColorDeTextoAccesible(colorSecundario),
      colorSecundarioBorde: convertirHslAHex({ h: matizSecundario, s: saturacionBase, l: Math.max(12, luminosidadSecundario - 28) }),
      colorTerciario,
      colorTerciarioTexto: determinarColorDeTextoAccesible(colorTerciario),
      colorTerciarioBorde: convertirHslAHex({ h: matizTerciario, s: saturacionBase, l: Math.max(12, luminosidadTerciario - 30) }),
      colorLinea,
      colorTextoGeneral: modoOscuro ? '#e8ebf0' : '#1f2430',
      tipografia: configuracion.tipografia || "'Inter', 'Segoe UI', system-ui, sans-serif"
    };
  }

  /**
   * Genera una paleta aleatoria "inteligente": escoge un matiz y una armonía
   * al azar, pero mantiene los ratios de luminosidad/saturación del algoritmo
   * determinista, de modo que el resultado siempre es coherente y legible.
   * @param {boolean} [modoOscuro=false]
   * @returns {Object} paleta armónica
   */
  function generarPaletaAleatoriaInteligente(modoOscuro) {
    const gradosMatizBase = Math.round(Math.random() * GRADOS_MAXIMOS_MATIZ);
    const saturacionBase = 55 + Math.round(Math.random() * 25);
    const clavesDeEsquema = Object.keys(CATALOGO_ARMONIAS);
    const tipoEsquema = clavesDeEsquema[Math.floor(Math.random() * clavesDeEsquema.length)];

    return generarPaletaArmonica({
      matizBase: gradosMatizBase,
      saturacionBase,
      tipoEsquema,
      modoOscuro: Boolean(modoOscuro)
    });
  }

  /**
   * Devuelve las armonías disponibles para poblar controles de interfaz.
   * @returns {Array<{clave:string, etiqueta:string}>}
   */
  function obtenerArmoniasDisponibles() {
    return Object.keys(CATALOGO_ARMONIAS).map((clave) => ({
      clave,
      etiqueta: CATALOGO_ARMONIAS[clave].etiqueta
    }));
  }

  namespaceOpenMermaid.ColorAlgorithms = {
    CATALOGO_ARMONIAS,
    UMBRAL_CONTRASTE_AA,
    convertirHexARgb,
    convertirRgbAHex,
    convertirRgbAHsl,
    convertirHslARgb,
    convertirHexAHsl,
    convertirHslAHex,
    calcularLuminanciaRelativa,
    calcularRatioDeContraste,
    determinarColorDeTextoAccesible,
    cumpleContrasteMinimoAA,
    desplazarMatizDeColor,
    obtenerMaticesDeEsquema,
    generarPaletaArmonica,
    generarPaletaAleatoriaInteligente,
    obtenerArmoniasDisponibles
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
