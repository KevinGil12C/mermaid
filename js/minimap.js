/**
 * OpenMermaid Studio - Minimapa de navegación.
 *
 * Ofrece una vista en miniatura del diagrama con un recuadro que representa la
 * región visible en el lienzo. Permite saltar a cualquier zona con un clic y
 * arrastrar el recuadro para desplazar la vista, sincronizándose con el zoom y
 * el paneo que gestiona `app.js`.
 *
 * @module minimap
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const referencias = {
    elementos: null,
    obtenerVista: null,
    alDesplazarVista: null,
    svgOrigen: null,
    svgClonado: null,
    ultimaGeometria: null,
    ultimaVista: null,
    arrastrando: false,
    eventosRegistrados: false
  };

  /**
   * Calcula la geometría de proyección del diagrama dentro del minimapa.
   * Función pura (sin DOM) para poder verificarla de forma aislada.
   *
   * @param {{mapaAncho:number, mapaAlto:number, anchoDiagrama:number, altoDiagrama:number,
   *          anchoLienzo:number, altoLienzo:number, zoom:number,
   *          desplazamientoX:number, desplazamientoY:number}} datos
   * @returns {{escala:number, anchoDibujo:number, altoDibujo:number, offsetX:number,
   *            offsetY:number, izquierda:number, arriba:number,
   *            anchoRecuadro:number, altoRecuadro:number}|null}
   */
  function calcularGeometriaDeMinimapa(datos) {
    const {
      mapaAncho, mapaAlto, anchoDiagrama, altoDiagrama,
      anchoLienzo, altoLienzo, zoom, desplazamientoX, desplazamientoY
    } = datos || {};

    const valoresValidos = [mapaAncho, mapaAlto, anchoDiagrama, altoDiagrama, anchoLienzo, altoLienzo, zoom]
      .every((valor) => Number.isFinite(valor) && valor > 0);
    if (!valoresValidos) {
      return null;
    }

    const escala = Math.min(mapaAncho / anchoDiagrama, mapaAlto / altoDiagrama);
    const anchoDibujo = anchoDiagrama * escala;
    const altoDibujo = altoDiagrama * escala;
    const offsetX = (mapaAncho - anchoDibujo) / 2;
    const offsetY = (mapaAlto - altoDibujo) / 2;

    // Región del diagrama actualmente visible en el lienzo (coordenadas de
    // diagrama): el origen del lienzo equivale a un desplazamiento en píxeles.
    const visibleX = -desplazamientoX / zoom;
    const visibleY = -desplazamientoY / zoom;
    const anchoVisible = anchoLienzo / zoom;
    const altoVisible = altoLienzo / zoom;

    return {
      escala,
      anchoDibujo,
      altoDibujo,
      offsetX,
      offsetY,
      izquierda: offsetX + visibleX * escala,
      arriba: offsetY + visibleY * escala,
      anchoRecuadro: anchoVisible * escala,
      altoRecuadro: altoVisible * escala
    };
  }

  /**
   * Inicializa el minimapa con sus dependencias.
   * @param {{elementos:Object, obtenerVista:()=>Object, alDesplazarVista:(x:number,y:number)=>void}} opciones
   */
  function inicializarMinimapa(opciones = {}) {
    referencias.elementos = opciones.elementos || null;
    referencias.obtenerVista = typeof opciones.obtenerVista === 'function' ? opciones.obtenerVista : null;
    referencias.alDesplazarVista = typeof opciones.alDesplazarVista === 'function' ? opciones.alDesplazarVista : null;
    registrarEventosDeArrastre();
  }

  /**
   * Reconstruye el clon del SVG si cambió el origen.
   * @param {SVGSVGElement} elementoSvg
   */
  function sincronizarClonDelSvg(elementoSvg) {
    const contenido = referencias.elementos && referencias.elementos.minimapaContenido;
    if (!contenido || !elementoSvg) {
      return;
    }
    if (referencias.svgOrigen === elementoSvg && referencias.svgClonado) {
      return;
    }

    if (referencias.svgClonado && referencias.svgClonado.parentNode) {
      referencias.svgClonado.parentNode.removeChild(referencias.svgClonado);
    }

    const clon = elementoSvg.cloneNode(true);
    clon.removeAttribute('style');
    clon.removeAttribute('width');
    clon.removeAttribute('height');
    clon.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    clon.classList.add('minimapa__svg');
    clon.style.position = 'absolute';
    clon.style.pointerEvents = 'none';

    contenido.insertBefore(clon, contenido.firstChild);
    referencias.svgOrigen = elementoSvg;
    referencias.svgClonado = clon;
  }

  /**
   * Redibuja el recuadro del minimapa a partir del estado actual de la vista.
   */
  function actualizarMinimapa() {
    if (!referencias.elementos || !referencias.elementos.minimapaContenido || !referencias.obtenerVista) {
      return;
    }
    const contenido = referencias.elementos.minimapaContenido;
    const vista = referencias.obtenerVista();
    if (!vista || !vista.elementoSvg) {
      return;
    }

    const geometria = calcularGeometriaDeMinimapa({
      mapaAncho: contenido.clientWidth,
      mapaAlto: contenido.clientHeight,
      anchoDiagrama: vista.anchoDiagrama,
      altoDiagrama: vista.altoDiagrama,
      anchoLienzo: vista.anchoLienzo,
      altoLienzo: vista.altoLienzo,
      zoom: vista.zoom,
      desplazamientoX: vista.desplazamientoX,
      desplazamientoY: vista.desplazamientoY
    });
    if (!geometria) {
      return;
    }

    referencias.ultimaGeometria = geometria;
    referencias.ultimaVista = vista;

    sincronizarClonDelSvg(vista.elementoSvg);

    if (referencias.svgClonado) {
      const estiloClon = referencias.svgClonado.style;
      estiloClon.left = `${geometria.offsetX}px`;
      estiloClon.top = `${geometria.offsetY}px`;
      estiloClon.width = `${geometria.anchoDibujo}px`;
      estiloClon.height = `${geometria.altoDibujo}px`;
      estiloClon.maxWidth = 'none';
    }

    const viewport = referencias.elementos.minimapaViewport;
    if (viewport) {
      viewport.style.left = `${geometria.izquierda}px`;
      viewport.style.top = `${geometria.arriba}px`;
      viewport.style.width = `${Math.max(6, geometria.anchoRecuadro)}px`;
      viewport.style.height = `${Math.max(6, geometria.altoRecuadro)}px`;
    }
  }

  /**
   * Traslada la vista del lienzo para centrarla en un punto del minimapa.
   * @param {PointerEvent} evento
   */
  function centrarVistaEnPuntoDelMinimapa(evento) {
    const contenido = referencias.elementos && referencias.elementos.minimapaContenido;
    const geometria = referencias.ultimaGeometria;
    const vista = referencias.ultimaVista;
    if (!contenido || !geometria || !vista || !referencias.alDesplazarVista) {
      return;
    }

    const rectangulo = contenido.getBoundingClientRect();
    const xEnMapa = evento.clientX - rectangulo.left;
    const yEnMapa = evento.clientY - rectangulo.top;

    const xEnDiagrama = (xEnMapa - geometria.offsetX) / geometria.escala;
    const yEnDiagrama = (yEnMapa - geometria.offsetY) / geometria.escala;

    const nuevoDesplazamientoX = vista.anchoLienzo / 2 - xEnDiagrama * vista.zoom;
    const nuevoDesplazamientoY = vista.altoLienzo / 2 - yEnDiagrama * vista.zoom;

    referencias.alDesplazarVista(nuevoDesplazamientoX, nuevoDesplazamientoY);
  }

  /** Registra los eventos de arrastre sobre el minimapa. */
  function registrarEventosDeArrastre() {
    if (referencias.eventosRegistrados) {
      return;
    }
    const contenido = referencias.elementos && referencias.elementos.minimapaContenido;
    if (!contenido) {
      return;
    }

    contenido.addEventListener('pointerdown', (evento) => {
      if (evento.button !== 0) {
        return;
      }
      evento.preventDefault();
      referencias.arrastrando = true;
      if (typeof contenido.setPointerCapture === 'function') {
        contenido.setPointerCapture(evento.pointerId);
      }
      centrarVistaEnPuntoDelMinimapa(evento);
    });

    contenido.addEventListener('pointermove', (evento) => {
      if (referencias.arrastrando) {
        centrarVistaEnPuntoDelMinimapa(evento);
      }
    });

    const finalizar = (evento) => {
      referencias.arrastrando = false;
      if (typeof contenido.hasPointerCapture === 'function' && contenido.hasPointerCapture(evento.pointerId)) {
        contenido.releasePointerCapture(evento.pointerId);
      }
    };
    contenido.addEventListener('pointerup', finalizar);
    contenido.addEventListener('pointercancel', finalizar);

    referencias.eventosRegistrados = true;
  }

  /**
   * Fija la visibilidad del minimapa.
   * @param {boolean} visible
   */
  function establecerVisibilidadDelMinimapa(visible) {
    const minimapa = referencias.elementos && referencias.elementos.minimapa;
    if (!minimapa) {
      return;
    }
    minimapa.hidden = !visible;
    minimapa.classList.toggle('minimapa--visible', Boolean(visible));
    if (visible && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(actualizarMinimapa);
    } else if (visible) {
      actualizarMinimapa();
    }
  }

  /** Alterna la visibilidad y devuelve el nuevo estado. @returns {boolean} */
  function alternarVisibilidadDelMinimapa() {
    const minimapa = referencias.elementos && referencias.elementos.minimapa;
    if (!minimapa) {
      return false;
    }
    const seraVisible = minimapa.hidden;
    establecerVisibilidadDelMinimapa(seraVisible);
    return seraVisible;
  }

  namespaceOpenMermaid.Minimap = {
    calcularGeometriaDeMinimapa,
    inicializarMinimapa,
    actualizarMinimapa,
    establecerVisibilidadDelMinimapa,
    alternarVisibilidadDelMinimapa
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
