/**
 * OpenMermaid Studio - Control del viewport del lienzo.
 *
 * Gestiona el estado de zoom y desplazamiento (pan) del diagrama renderizado,
 * aplicando la transformación sobre el elemento SVG o sobre la capa de
 * transformación `canvas-viewport`. Se apoya en delegación de eventos para
 * mantener los listeners estables entre re-renderizados.
 *
 * @module canvas-viewport
 */

(function (namespaceOpenMermaid) {
  'use strict';

  const estadoLienzo = {
    escala: 1,
    desplazamientoX: 0,
    desplazamientoY: 0,
    escalaMinima: 0.1,
    escalaMaxima: 5.0,
    pasoEscala: 0.15
  };

  const elementos = {};

  function obtenerCapaTransformable() {
    if (elementos.canvasViewport && elementos.canvasViewport instanceof Element) {
      return elementos.canvasViewport;
    }
    const candidato = document.querySelector('#canvas-viewport') || document.querySelector('#contenidoLienzo') || document.querySelector('#contenidoLienzo > svg') || document.querySelector('#lienzo svg');
    if (candidato) {
      elementos.canvasViewport = candidato;
      return candidato;
    }
    const svg = elementos.contenidoLienzo
      ? elementos.contenidoLienzo.querySelector('svg')
      : (document.querySelector('#contenidoLienzo svg') || document.querySelector('#lienzo svg'));
    return svg || null;
  }

  function aplicarTransformacionLienzo() {
    const capaTransform = obtenerCapaTransformable();
    const etiquetaZoom = elementos.zoomLevelText
      || document.getElementById('zoom-level-text')
      || document.getElementById('indicadorZoom');

    if (capaTransform) {
      capaTransform.style.transform = `translate(${estadoLienzo.desplazamientoX}px, ${estadoLienzo.desplazamientoY}px) scale(${estadoLienzo.escala})`;
      capaTransform.style.transformOrigin = '0 0';
    }

    if (etiquetaZoom) {
      etiquetaZoom.textContent = `${Math.round(estadoLienzo.escala * 100)}%`;
    }
  }

  function aumentarZoom() {
    estadoLienzo.escala = Math.min(
      estadoLienzo.escala + estadoLienzo.pasoEscala,
      estadoLienzo.escalaMaxima
    );
    aplicarTransformacionLienzo();
  }

  function disminuirZoom() {
    estadoLienzo.escala = Math.max(
      estadoLienzo.escala - estadoLienzo.pasoEscala,
      estadoLienzo.escalaMinima
    );
    aplicarTransformacionLienzo();
  }

  function resetearVistaLienzo() {
    estadoLienzo.escala = 1.0;
    estadoLienzo.desplazamientoX = 0;
    estadoLienzo.desplazamientoY = 0;
    aplicarTransformacionLienzo();
  }

  function ajustarDiagramaAlLienzo() {
    const contenedor = elementos.canvasContainer
      || document.getElementById('canvas-container')
      || document.getElementById('lienzo')
      || document.getElementById('contenidoLienzo');
    const svg = elementos.contenidoLienzo
      ? elementos.contenidoLienzo.querySelector('svg')
      : (contenedor ? contenedor.querySelector('svg') : (document.querySelector('#contenidoLienzo svg') || document.querySelector('#lienzo svg') || document.querySelector('svg')));

    if (!contenedor || !svg) {
      return;
    }

    let limitesSvg;
    try {
      limitesSvg = svg.getBBox();
    } catch (error) {
      limitesSvg = { x: 0, y: 0, width: 800, height: 600 };
    }

    let rectContenedor;
    try {
      rectContenedor = contenedor.getBoundingClientRect();
    } catch (error) {
      rectContenedor = { width: contenedor.clientWidth || 800, height: contenedor.clientHeight || 600 };
    }

    const margen = 50;
    const escalaHorizontal = (rectContenedor.width - margen * 2) / (limitesSvg.width || 1);
    const escalaVertical = (rectContenedor.height - margen * 2) / (limitesSvg.height || 1);
    const escalaOptima = Math.min(escalaHorizontal, escalaVertical, 1.2);

    estadoLienzo.escala = Math.max(escalaOptima, 0.2);
    estadoLienzo.desplazamientoX = (rectContenedor.width - limitesSvg.width * estadoLienzo.escala) / 2 - limitesSvg.x * estadoLienzo.escala;
    estadoLienzo.desplazamientoY = (rectContenedor.height - limitesSvg.height * estadoLienzo.escala) / 2 - limitesSvg.y * estadoLienzo.escala;

    aplicarTransformacionLienzo();
  }

  function alternarPantallaCompletaLienzo() {
    const contenedor = elementos.canvasContainer
      || document.getElementById('canvas-container')
      || document.getElementById('lienzo') || document.getElementById('contenidoLienzo');
    if (!contenedor) {
      return;
    }

    if (!document.fullscreenElement) {
      if (contenedor.requestFullscreen) {
        contenedor.requestFullscreen().catch(() => {
          if (document.body) {
            document.body.classList.toggle('modo-presentacion');
          }
        });
      } else {
        if (document.body) {
          document.body.classList.toggle('modo-presentacion');
        }
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  function inicializarViewport(configuracion) {
    const cfg = configuracion || {};
    elementos.canvasContainer = cfg.canvasContainer || document.getElementById('canvas-container') || document.getElementById('lienzo');
    elementos.contenidoLienzo = cfg.contenidoLienzo || document.getElementById('contenidoLienzo');
    elementos.canvasViewport = cfg.canvasViewport || document.getElementById('canvas-viewport');
    elementos.zoomLevelText = cfg.zoomLevelText || document.getElementById('zoom-level-text') || document.getElementById('indicadorZoom');

    // Cuando otro módulo (app.js) ya gobierna el zoom y el paneo del lienzo, no
    // se vuelven a enlazar los mismos botones: dos listeners sobre el mismo
    // control aplicarían transformaciones superpuestas y romperían el estado.
    if (cfg.vincularControles === false) {
      aplicarTransformacionLienzo();
      return;
    }

    document.getElementById('btn-zoom-in')?.addEventListener('click', aumentarZoom);
    document.getElementById('btn-zoom-out')?.addEventListener('click', disminuirZoom);
    document.getElementById('zoom-level-text')?.addEventListener('click', resetearVistaLienzo);
    document.getElementById('btn-zoom-reset')?.addEventListener('click', resetearVistaLienzo);
    document.getElementById('btn-fit-screen')?.addEventListener('click', ajustarDiagramaAlLienzo);
    document.getElementById('btn-fullscreen')?.addEventListener('click', alternarPantallaCompletaLienzo);

    document.getElementById('botonAcercar')?.addEventListener('click', aumentarZoom);
    document.getElementById('botonAlejar')?.addEventListener('click', disminuirZoom);
    document.getElementById('indicadorZoom')?.addEventListener('click', resetearVistaLienzo);
    document.getElementById('botonZoom100')?.addEventListener('click', resetearVistaLienzo);
    document.getElementById('botonAjustar')?.addEventListener('click', ajustarDiagramaAlLienzo);
    document.getElementById('botonCentrar')?.addEventListener('click', resetearVistaLienzo);

    aplicarTransformacionLienzo();
  }

  function obtenerEstadoLienzo() {
    return estadoLienzo;
  }

  function establecerEstadoLienzo(nuevoEstado) {
    if (!nuevoEstado) return;
    if (Number.isFinite(nuevoEstado.escala)) {
      estadoLienzo.escala = Math.max(estadoLienzo.escalaMinima, Math.min(nuevoEstado.escala, estadoLienzo.escalaMaxima));
    }
    if (Number.isFinite(nuevoEstado.desplazamientoX)) estadoLienzo.desplazamientoX = nuevoEstado.desplazamientoX;
    if (Number.isFinite(nuevoEstado.desplazamientoY)) estadoLienzo.desplazamientoY = nuevoEstado.desplazamientoY;
    aplicarTransformacionLienzo();
  }

  namespaceOpenMermaid.CanvasViewport = {
    inicializarViewport,
    aplicarTransformacionLienzo,
    aumentarZoom,
    disminuirZoom,
    resetearVistaLienzo,
    ajustarDiagramaAlLienzo,
    alternarPantallaCompletaLienzo,
    obtenerEstadoLienzo,
    establecerEstadoLienzo
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
