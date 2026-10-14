/**
 * OpenMermaid Studio - Buscador y reemplazador de texto del editor.
 *
 * Implementa una barra flotante de búsqueda incremental sobre el `<textarea>`
 * del editor: navegación cíclica de coincidencias, contador "n de m",
 * reemplazo puntual y reemplazo de todas las apariciones. Opera directamente
 * sobre el valor del textarea y emite `input` para disparar el renderizado.
 *
 * @module find-replace
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const referencias = {
    editor: null,
    elementos: null,
    eventosRegistrados: false
  };

  /**
   * Cuenta las apariciones (sin solapamiento) de una aguja en un texto.
   * @param {string} texto
   * @param {string} aguja
   * @returns {number}
   */
  function contarOcurrencias(texto, aguja) {
    if (!aguja) {
      return 0;
    }
    let total = 0;
    let posicion = texto.indexOf(aguja);
    while (posicion !== -1) {
      total += 1;
      posicion = texto.indexOf(aguja, posicion + aguja.length);
    }
    return total;
  }

  /**
   * Inicializa el buscador con sus dependencias y enlaza sus eventos.
   * @param {{editor:HTMLTextAreaElement, elementos:Object}} opciones
   */
  function inicializarBuscadorDeTexto(opciones = {}) {
    referencias.editor = opciones.editor || null;
    referencias.elementos = opciones.elementos || null;

    if (referencias.eventosRegistrados || !referencias.elementos) {
      return;
    }
    const { elementos } = referencias;

    if (elementos.botonBuscarSiguiente) {
      elementos.botonBuscarSiguiente.addEventListener('click', buscarSiguiente);
    }
    if (elementos.botonBuscarAnterior) {
      elementos.botonBuscarAnterior.addEventListener('click', buscarAnterior);
    }
    if (elementos.botonReemplazar) {
      elementos.botonReemplazar.addEventListener('click', reemplazarActual);
    }
    if (elementos.botonReemplazarTodo) {
      elementos.botonReemplazarTodo.addEventListener('click', reemplazarTodos);
    }
    if (elementos.botonCerrarBusqueda) {
      elementos.botonCerrarBusqueda.addEventListener('click', cerrarPanelDeBusqueda);
    }
    if (elementos.entradaBuscar) {
      elementos.entradaBuscar.addEventListener('input', actualizarContadorDeCoincidencias);
      elementos.entradaBuscar.addEventListener('keydown', manejarTeclaEnCampoBuscar);
    }
    if (elementos.entradaReemplazar) {
      elementos.entradaReemplazar.addEventListener('keydown', manejarTeclaEnCampoReemplazar);
    }

    referencias.eventosRegistrados = true;
  }

  /**
   * Abre la barra de búsqueda.
   * @param {{mostrarReemplazo?:boolean}} [opciones]
   */
  function abrirPanelDeBusqueda(opciones = {}) {
    const { elementos, editor } = referencias;
    if (!elementos || !elementos.barraBusqueda) {
      return;
    }

    // Si hay texto seleccionado en el editor, se precarga como término.
    if (editor && editor.selectionStart !== editor.selectionEnd) {
      const seleccion = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (seleccion && !seleccion.includes('\n')) {
        elementos.entradaBuscar.value = seleccion;
      }
    }

    if (elementos.filaReemplazo) {
      elementos.filaReemplazo.hidden = !opciones.mostrarReemplazo;
    }

    elementos.barraBusqueda.hidden = false;
    actualizarContadorDeCoincidencias();
    if (elementos.entradaBuscar) {
      elementos.entradaBuscar.focus();
      elementos.entradaBuscar.select();
    }
  }

  /** Cierra la barra de búsqueda y devuelve el foco al editor. */
  function cerrarPanelDeBusqueda() {
    const { elementos, editor } = referencias;
    if (!elementos || !elementos.barraBusqueda) {
      return;
    }
    elementos.barraBusqueda.hidden = true;
    if (editor) {
      editor.focus();
    }
  }

  /** @returns {boolean} */
  function estaElPanelVisible() {
    const barra = referencias.elementos && referencias.elementos.barraBusqueda;
    return Boolean(barra && !barra.hidden);
  }

  /**
   * Determina el índice de la ocurrencia que contiene la posición dada.
   * @param {string} texto
   * @param {string} aguja
   * @param {number} posicion
   * @returns {number} índice 1-based, o 0 si no aplica
   */
  function calcularIndiceDeOcurrencia(texto, aguja, posicion) {
    if (!aguja) {
      return 0;
    }
    let indice = 0;
    let cursor = texto.indexOf(aguja);
    while (cursor !== -1 && cursor < posicion) {
      indice += 1;
      cursor = texto.indexOf(aguja, cursor + aguja.length);
    }
    return indice;
  }

  /** Actualiza el contador "n de m" del panel. */
  function actualizarContadorDeCoincidencias() {
    const { elementos, editor } = referencias;
    if (!elementos || !elementos.contadorCoincidencias || !editor) {
      return;
    }
    const aguja = elementos.entradaBuscar ? elementos.entradaBuscar.value : '';
    const total = contarOcurrencias(editor.value, aguja);
    const actual = total === 0
      ? 0
      : Math.max(1, calcularIndiceDeOcurrencia(editor.value, aguja, editor.selectionStart));

    elementos.contadorCoincidencias.textContent = aguja
      ? `${actual} de ${total}`
      : '0 de 0';
    elementos.contadorCoincidencias.classList.toggle('sin-resultados', Boolean(aguja) && total === 0);
  }

  /**
   * Busca la siguiente aparición desde el cursor (con envoltura).
   * @returns {boolean}
   */
  function buscarSiguiente() {
    const { elementos, editor } = referencias;
    if (!elementos || !editor) {
      return false;
    }
    const aguja = elementos.entradaBuscar ? elementos.entradaBuscar.value : '';
    if (!aguja) {
      return false;
    }
    const texto = editor.value;
    const desde = editor.selectionEnd;
    let posicion = texto.indexOf(aguja, desde);
    if (posicion === -1) {
      posicion = texto.indexOf(aguja);
    }
    if (posicion === -1) {
      actualizarContadorDeCoincidencias();
      return false;
    }
    seleccionarRangoDelEditor(posicion, posicion + aguja.length);
    actualizarContadorDeCoincidencias();
    return true;
  }

  /**
   * Busca la aparición anterior al cursor (con envoltura).
   * @returns {boolean}
   */
  function buscarAnterior() {
    const { elementos, editor } = referencias;
    if (!elementos || !editor) {
      return false;
    }
    const aguja = elementos.entradaBuscar ? elementos.entradaBuscar.value : '';
    if (!aguja) {
      return false;
    }
    const texto = editor.value;
    const desde = Math.max(0, editor.selectionStart - 1);
    let posicion = texto.lastIndexOf(aguja, desde);
    if (posicion === -1) {
      posicion = texto.lastIndexOf(aguja);
    }
    if (posicion === -1) {
      actualizarContadorDeCoincidencias();
      return false;
    }
    seleccionarRangoDelEditor(posicion, posicion + aguja.length);
    actualizarContadorDeCoincidencias();
    return true;
  }

  /**
   * Selecciona y revela un rango del editor.
   * @param {number} inicio
   * @param {number} fin
   */
  function seleccionarRangoDelEditor(inicio, fin) {
    const { editor } = referencias;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(inicio, fin);
    revelarLineaEnEditor(editor, inicio);
  }

  /**
   * Aproxima el desplazamiento vertical para dejar visible la coincidencia.
   * @param {HTMLTextAreaElement} editor
   * @param {number} posicion
   */
  function revelarLineaEnEditor(editor, posicion) {
    const alturaLinea = parseFloat(window.getComputedStyle(editor).lineHeight) || 21;
    const numeroDeLinea = editor.value.slice(0, posicion).split('\n').length - 1;
    const objetivo = numeroDeLinea * alturaLinea;
    if (objetivo < editor.scrollTop || objetivo > editor.scrollTop + editor.clientHeight - alturaLinea) {
      editor.scrollTop = Math.max(0, objetivo - editor.clientHeight / 2);
    }
  }

  /** Reemplaza la coincidencia actual, si hay una seleccionada. */
  function reemplazarActual() {
    const { elementos, editor } = referencias;
    if (!elementos || !editor) {
      return;
    }
    const aguja = elementos.entradaBuscar ? elementos.entradaBuscar.value : '';
    const reemplazo = elementos.entradaReemplazar ? elementos.entradaReemplazar.value : '';
    if (!aguja) {
      return;
    }

    const seleccionActual = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (seleccionActual === aguja) {
      const inicio = editor.selectionStart;
      editor.setRangeText(reemplazo, inicio, editor.selectionEnd, 'end');
      notificarCambioDelEditor();
      editor.setSelectionRange(inicio + reemplazo.length, inicio + reemplazo.length);
    }
    buscarSiguiente();
    actualizarContadorDeCoincidencias();
  }

  /** Reemplaza todas las apariciones de la aguja. */
  function reemplazarTodos() {
    const { elementos, editor } = referencias;
    if (!elementos || !editor) {
      return;
    }
    const aguja = elementos.entradaBuscar ? elementos.entradaBuscar.value : '';
    const reemplazo = elementos.entradaReemplazar ? elementos.entradaReemplazar.value : '';
    if (!aguja) {
      return;
    }

    const total = contarOcurrencias(editor.value, aguja);
    if (total === 0) {
      actualizarContadorDeCoincidencias();
      return;
    }
    const posicionCursor = editor.selectionStart;
    editor.value = editor.value.split(aguja).join(reemplazo);
    editor.setSelectionRange(
      Math.min(posicionCursor, editor.value.length),
      Math.min(posicionCursor, editor.value.length)
    );
    notificarCambioDelEditor();
    actualizarContadorDeCoincidencias();
  }

  /** Emite un evento `input` sintético para que el editor reprocese. */
  function notificarCambioDelEditor() {
    referencias.editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  /**
   * Maneja Enter/Shift+Enter/Escape en el campo de búsqueda.
   * @param {KeyboardEvent} evento
   */
  function manejarTeclaEnCampoBuscar(evento) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      if (evento.shiftKey) {
        buscarAnterior();
      } else {
        buscarSiguiente();
      }
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      cerrarPanelDeBusqueda();
    }
  }

  /**
   * Maneja Enter/Escape en el campo de reemplazo.
   * @param {KeyboardEvent} evento
   */
  function manejarTeclaEnCampoReemplazar(evento) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      reemplazarActual();
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      cerrarPanelDeBusqueda();
    }
  }

  namespaceOpenMermaid.FindReplace = {
    contarOcurrencias,
    inicializarBuscadorDeTexto,
    abrirPanelDeBusqueda,
    cerrarPanelDeBusqueda,
    estaElPanelVisible,
    buscarSiguiente,
    buscarAnterior,
    reemplazarActual,
    reemplazarTodos
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
