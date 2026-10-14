/**
 * OpenMermaid Studio - Estilizado y manipulación de código Mermaid.
 *
 * Responsabilidad única: transformar texto Mermaid (inyectar la directiva de
 * tema, alternar la orientación del flujo, añadir clases de estilo) SIN
 * renderizar. Todas las funciones son puras y devuelven cadenas nuevas.
 *
 * Nota sobre la directiva de tema:
 *   Se emite JSON válido (comillas dobles). Mermaid acepta JSON tanto si lo
 *   procesa con un parser JSON como si lo interpreta como YAML, por lo que es
 *   la representación más portable entre versiones.
 *
 * @module diagram-styler
 */
(function (namespaceOpenMermaid) {
  'use strict';

  /** Coincide con una directiva init al principio del documento (con o sin sangría). */
  const PATRON_DIRECTIVA_INIT = /^[ \t]*%%\{[\s\S]*?\}%%[ \t]*\r?\n?/;

  /** Coincide con la declaración de orientación de un flowchart/graph. */
  const PATRON_DECLARACION_FLUJO = /^([ \t]*)(flowchart|graph)([ \t]+)(TB|TD|BT|LR|RL)\b/m;

  const ORIENTACIONES_VERTICALES = ['TD', 'TB', 'BT'];

  /**
   * Convierte un objeto de variables de tema en una directiva Mermaid init.
   * @param {Object} variablesTema mapa de themeVariables de Mermaid
   * @returns {string}
   */
  function construirDirectivaInit(variablesTema) {
    const configuracion = { theme: 'base', themeVariables: variablesTema };
    return `%%{init: ${JSON.stringify(configuracion)}}%%`;
  }

  /**
   * Elimina cualquier directiva init existente al inicio del código.
   * @param {string} codigoMermaid
   * @returns {string}
   */
  function eliminarDirectivaInitExistente(codigoMermaid) {
    return codigoMermaid.replace(PATRON_DIRECTIVA_INIT, '');
  }

  /**
   * Inyecta o reemplaza limpiamente la directiva init al comienzo del código.
   * Si la primera línea es el frontmatter YAML de Mermaid (--- ... ---), la
   * directiva se coloca justo después para no romper los metadatos.
   * @param {string} codigoMermaid
   * @param {Object} variablesTema
   * @returns {string}
   */
  function inyectarDirectivaInit(codigoMermaid, variablesTema) {
    const codigoSinDirectiva = eliminarDirectivaInitExistente(codigoMermaid).replace(/^\s+/, '');
    const directiva = construirDirectivaInit(variablesTema);

    const coincidenciaFrontmatter = codigoSinDirectiva.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (coincidenciaFrontmatter) {
      const frontmatter = coincidenciaFrontmatter[0].replace(/\s*$/, '');
      const restoDelDocumento = codigoSinDirectiva.slice(frontmatter.length).replace(/^\s+/, '');
      return `${frontmatter}\n${directiva}\n${restoDelDocumento}`;
    }

    return `${directiva}\n${codigoSinDirectiva}`;
  }

  /**
   * Traduce la paleta del motor de color a themeVariables de Mermaid.
   * @param {Object} paleta resultado de ColorAlgorithms.generarPaletaArmonica
   * @returns {Object}
   */
  function construirVariablesTemaDesdePaleta(paleta) {
    return {
      primaryColor: paleta.colorPrimario,
      primaryTextColor: paleta.colorPrimarioTexto,
      primaryBorderColor: paleta.colorPrimarioBorde,
      secondaryColor: paleta.colorSecundario,
      secondaryTextColor: paleta.colorSecundarioTexto,
      secondaryBorderColor: paleta.colorSecundarioBorde,
      tertiaryColor: paleta.colorTerciario,
      tertiaryTextColor: paleta.colorTerciarioTexto,
      tertiaryBorderColor: paleta.colorTerciarioBorde,
      lineColor: paleta.colorLinea,
      textColor: paleta.colorTextoGeneral,
      titleColor: paleta.colorTextoGeneral,
      background: paleta.fondo,
      mainBkg: paleta.colorPrimario,
      nodeBorder: paleta.colorPrimarioBorde,
      nodeTextColor: paleta.colorPrimarioTexto,
      clusterBkg: paleta.fondoAgrupador,
      clusterBorder: paleta.colorPrimarioBorde,
      edgeLabelBackground: paleta.fondo,
      fontFamily: paleta.tipografia,
      fontSize: '16px'
    };
  }

  /**
   * Determina la orientación opuesta dentro de una misma familia.
   * Vertical (TD/TB/BT) <-> Horizontal (LR/RL).
   * @param {string} orientacionActual
   * @returns {string}
   */
  function calcularOrientacionOpuesta(orientacionActual) {
    if (ORIENTACIONES_VERTICALES.includes(orientacionActual)) {
      return 'LR';
    }
    return 'TD';
  }

  /**
   * Alterna la orientación de un diagrama de flujo sin tocar sus nodos.
   * @param {string} codigoMermaid
   * @returns {string}
   */
  function alternarOrientacionDeFlujo(codigoMermaid) {
    if (!PATRON_DECLARACION_FLUJO.test(codigoMermaid)) {
      return codigoMermaid;
    }

    return codigoMermaid.replace(
      PATRON_DECLARACION_FLUJO,
      (coincidencia, sangria, palabraClave, espacio, orientacionActual) => {
        const orientacionNueva = calcularOrientacionOpuesta(orientacionActual);
        return `${sangria}${palabraClave}${espacio}${orientacionNueva}`;
      }
    );
  }

  /**
   * Indica si el código corresponde a un diagrama de flujo (flowchart/graph).
   * @param {string} codigoMermaid
   * @returns {boolean}
   */
  function esDiagramaDeFlujo(codigoMermaid) {
    return /^\s*(flowchart|graph)\b/m.test(eliminarDirectivaInitExistente(codigoMermaid));
  }

  /**
   * Genera definiciones classDef a partir de la paleta para enriquecer los
   * nodos de un flowchart con dos estilos auxiliares reutilizables.
   * @param {Object} paleta
   * @returns {string[]} líneas classDef listas para anexar
   */
  function construirClasesDeEstiloDesdePaleta(paleta) {
    return [
      `classDef destacado fill:${paleta.colorSecundario},stroke:${paleta.colorSecundarioBorde},color:${paleta.colorSecundarioTexto};`,
      `classDef tenue fill:${paleta.colorTerciario},stroke:${paleta.colorTerciarioBorde},color:${paleta.colorTerciarioTexto};`
    ];
  }

  /**
   * Anexa definiciones classDef al final de un flowchart si aún no existen.
   * Se evita inyectar en otros tipos de diagrama porque rompería la sintaxis.
   * @param {string} codigoMermaid
   * @param {Object} paleta
   * @returns {string}
   */
  function inyectarClasesDeEstiloEnFlujo(codigoMermaid, paleta) {
    if (!esDiagramaDeFlujo(codigoMermaid) || /classDef\s+destacado/.test(codigoMermaid)) {
      return codigoMermaid;
    }
    const clases = construirClasesDeEstiloDesdePaleta(paleta).join('\n');
    return `${codigoMermaid.replace(/\s*$/, '')}\n${clases}`;
  }

  /**
   * Elimina las clases de estilo autogeneradas para dejar el código limpio.
   * @param {string} codigoMermaid
   * @returns {string}
   */
  function eliminarClasesDeEstiloEnFlujo(codigoMermaid) {
    return codigoMermaid
      .split(/\r?\n/)
      .filter((linea) => !/^\s*classDef\s+(destacado|tenue)\b/.test(linea))
      .join('\n');
  }

  namespaceOpenMermaid.DiagramStyler = {
    construirDirectivaInit,
    eliminarDirectivaInitExistente,
    inyectarDirectivaInit,
    construirVariablesTemaDesdePaleta,
    calcularOrientacionOpuesta,
    alternarOrientacionDeFlujo,
    esDiagramaDeFlujo,
    construirClasesDeEstiloDesdePaleta,
    inyectarClasesDeEstiloEnFlujo,
    eliminarClasesDeEstiloEnFlujo
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
