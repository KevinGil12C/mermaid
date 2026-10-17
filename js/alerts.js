/**
 * OpenMermaid Studio - Despachador centralizado de alertas SweetAlert2.
 *
 * Provee toasts, diálogos de confirmación, loaders y feedback temático.
 * Se adapta al tema activo (data-bs-theme="dark"/"light").
 *
 * @module alerts
 */
(function (namespaceOpenMermaid) {
  "use strict";

  const COLORES = {
    oscuro: { background: "#1e293b", color: "#e2e8f0" },
    claro: { background: "#ffffff", color: "#1f2937" },
    primario: "#2563eb"
  };

  function sweetalertDisponible() {
    return typeof window.Swal !== "undefined" && window.Swal && typeof window.Swal.fire === "function";
  }

  function esTemaOscuro() {
    return document.documentElement.getAttribute("data-bs-theme") === "dark";
  }

  function opcionesAdaptadasAlTema() {
    const colores = esTemaOscuro() ? COLORES.oscuro : COLORES.claro;
    return {
      background: colores.background,
      color: colores.color,
      confirmButtonColor: COLORES.primario,
      cancelButtonColor: "#64748b"
    };
  }

  function mostrarCargador(titulo, descripcion) {
    if (!sweetalertDisponible()) return;
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      title: titulo || "Generando archivo en alta resolución...",
      text: descripcion || "Renderizando capas vectoriales e iconos Font Awesome en alta resolución...",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => window.Swal.showLoading()
    }));
  }

  function cerrarCargador() {
    if (sweetalertDisponible()) window.Swal.close();
  }

  function notificarExito(mensaje, opciones) {
    if (!sweetalertDisponible()) return;
    const cfg = opciones || {};
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: cfg.toast !== false,
      position: cfg.position || "top-end",
      icon: "success",
      title: mensaje,
      showConfirmButton: false,
      timer: cfg.timer || 2500,
      timerProgressBar: true,
      didOpen: (toast) => {
        if (toast && typeof toast.addEventListener === "function") {
          toast.addEventListener("mouseenter", window.Swal.stopTimer);
          toast.addEventListener("mouseleave", window.Swal.resumeTimer);
        }
      }
    }));
  }

  function notificarInfo(mensaje, opciones) {
    if (!sweetalertDisponible()) return;
    const cfg = opciones || {};
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: true,
      position: cfg.position || "top-end",
      icon: "info",
      title: mensaje,
      showConfirmButton: false,
      timer: cfg.timer || 2200,
      timerProgressBar: true
    }));
  }

  function notificarError(titulo, descripcion) {
    if (!sweetalertDisponible()) return;
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      icon: "error",
      title: titulo || "Error",
      text: descripcion || "",
      confirmButtonText: "Entendido"
    }));
  }

  function notificarAdvertencia(mensaje, opciones) {
    if (!sweetalertDisponible()) return;
    const cfg = opciones || {};
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: true,
      position: cfg.position || "top-end",
      icon: "warning",
      title: mensaje,
      showConfirmButton: false,
      timer: cfg.timer || 2800,
      timerProgressBar: true
    }));
  }

  function notificarErrorDeSintaxis(mensaje) {
    if (!sweetalertDisponible()) return;
    window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      toast: true,
      position: "top-end",
      icon: "error",
      title: mensaje || "Error de sintaxis Mermaid",
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true
    }));
  }

  function mostrarNotificacionAccionExitosa(mensaje) {
    notificarExito(mensaje);
  }

  async function confirmarAccion(titulo, texto, opciones) {
    if (!sweetalertDisponible()) return true;
    const res = await window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      title: titulo || "¿Confirmar acción?",
      text: texto || "",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: opciones && opciones.confirmarTexto ? opciones.confirmarTexto : "Confirmar",
      cancelButtonText: "Cancelar"
    }));
    return !!res.isConfirmed;
  }

  async function solicitarTexto(titulo, etiqueta, valorInicial, opciones) {
    if (!sweetalertDisponible()) return null;
    const res = await window.Swal.fire(Object.assign({}, opcionesAdaptadasAlTema(), {
      title: titulo || "Ingrese valor",
      input: "text",
      inputLabel: etiqueta || "",
      inputValue: valorInicial || "",
      showCancelButton: true,
      confirmButtonText: "Aceptar",
      cancelButtonText: "Cancelar",
      inputValidator: (v) => {
        if ((opciones && opciones.requerido !== false) && (!v || !v.trim())) return "Este campo es obligatorio";
        return null;
      }
    }));
    return res.isConfirmed ? (res.value || "") : null;
  }

  async function confirmarEliminacion(nombre, textoAdicional) {
    const etiqueta = nombre ? `'${nombre}'` : "este elemento";
    const texto = textoAdicional || "Esta acción no se puede deshacer.";
    return confirmarAccion(`¿Eliminar ${etiqueta}?`, texto, {
      confirmarTexto: "Sí, eliminar",
      icono: "warning"
    });
  }

  function mostrarToastRápido(mensaje) {
    notificarExito(mensaje);
  }

  const mostrarToastRapido = mostrarToastRápido;

  namespaceOpenMermaid.Alerts = {
    mostrarCargador,
    cerrarCargador,
    notificarExito,
    notificarInfo,
    notificarAdvertencia,
    notificarError,
    notificarErrorDeSintaxis,
    mostrarNotificacionAccionExitosa,
    confirmarAccion,
    confirmarEliminacion,
    solicitarTexto,
    mostrarToastRápido,
    mostrarToastRapido
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
