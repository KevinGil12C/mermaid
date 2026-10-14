/**
 * OpenMermaid Studio - Sistema de archivos virtual sobre localStorage.
 *
 * Responsabilidad única: administrar el árbol de carpetas y diagramas del
 * usuario (crear, renombrar, eliminar, guardar y respaldar) y persistirlo bajo
 * la clave `openmermaid_workspace_v1`.
 *
 * Decisiones de diseño:
 *  - El espacio de trabajo es un único documento JSON serializado; toda
 *    mutación pasa por `_persistirEspacioDeTrabajo()` para garantizar una sola
 *    ruta de escritura (DRY).
 *  - Las carpetas son planas (solo la raíz marca `esRaiz`). Al eliminar una
 *    carpeta sus archivos se reasignan a la raíz para evitar pérdida de datos.
 *  - La generación de identificadores usa `crypto.randomUUID` cuando existe y
 *    cae a un esquema de tiempo + azar en contextos no seguros.
 *
 * @module file-system
 */
(function (namespaceOpenMermaid) {
  'use strict';

  const CLAVE_ALMACENAMIENTO_ESPACIO = 'openmermaid_workspace_v1';
  const VERSION_ESQUEMA_ESPACIO = '1.0.0';
  const ID_CARPETA_RAIZ_PREDETERMINADA = 'carpeta-raiz';
  const ID_ARCHIVO_PREDETERMINADO = 'id-diagrama-defecto';
  const NOMBRE_CARPETA_RAIZ = 'Mis Diagramas';
  const NOMBRE_ARCHIVO_PREDETERMINADO = 'Diagrama Inicial';

  /** Límite aproximado y habitual de localStorage por origen (5 MB). */
  const LIMITE_ALMACENAMIENTO_BYTES = 5 * 1024 * 1024;

  /**
   * Número máximo de versiones históricas conservadas por diagrama. Cada
   * entrada es un snapshot (fecha + código) y ocupa espacio en localStorage,
   * por lo que conviene acotarlo.
   */
  const LIMITE_VERSIONES_HISTORICAS = 10;

  const CODIGO_DIAGRAMA_INICIAL = [
    'graph TD',
    '    A[Inicio] --> B(Proceso)',
    '    B --> C{Condicion}',
    '    C -->|Si| D[Resultado]',
    '    C -->|No| E[Fin]'
  ].join('\n');

  /**
   * Genera un identificador único con prefijo semántico.
   * @param {string} prefijo
   * @returns {string}
   */
  function generarIdentificadorUnico(prefijo) {
    const sufijoAleatorio = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefijo}-${sufijoAleatorio}`;
  }

  /**
   * Clase que administra el espacio de trabajo del usuario.
   */
  class FileSystemManager {
    /**
     * @param {string} [claveAlmacenamiento] clave de localStorage a utilizar
     */
    constructor(claveAlmacenamiento = CLAVE_ALMACENAMIENTO_ESPACIO) {
      this.claveAlmacenamiento = claveAlmacenamiento;
      this.espacioDeTrabajo = null;
    }

    // ----------------------------------------------------------------------
    // Ciclo de vida
    // ----------------------------------------------------------------------

    /**
     * Carga el espacio de trabajo o crea la estructura por defecto.
     * @returns {Object} espacio de trabajo listo para usar
     */
    inicializarEspacioDeTrabajo() {
      const espacioAlmacenado = this._leerEspacioDeAlmacenamiento();
      this.espacioDeTrabajo = espacioAlmacenado || this._crearEspacioDeTrabajoPredeterminado();
      this._garantizarIntegridadDelEspacio();
      this._persistirEspacioDeTrabajo();
      return this.espacioDeTrabajo;
    }

    /**
     * Reemplaza el espacio completo (usado tras importar un respaldo).
     * @param {Object} espacioDeTrabajo
     */
    _establecerEspacioDeTrabajo(espacioDeTrabajo) {
      this.espacioDeTrabajo = espacioDeTrabajo;
      this._garantizarIntegridadDelEspacio();
      this._persistirEspacioDeTrabajo();
    }

    // ----------------------------------------------------------------------
    // Consultas
    // ----------------------------------------------------------------------

    /** @returns {Object} */
    obtenerEspacioDeTrabajo() {
      return this.espacioDeTrabajo;
    }

    /** @returns {Object} */
    obtenerConfiguracion() {
      return this.espacioDeTrabajo.configuracion;
    }

    /**
     * Actualiza de forma parcial la configuración persistida.
     * @param {Object} cambios
     * @returns {Object} configuración resultante
     */
    actualizarConfiguracion(cambios) {
      this.espacioDeTrabajo.configuracion = { ...this.espacioDeTrabajo.configuracion, ...cambios };
      this._persistirEspacioDeTrabajo();
      return this.espacioDeTrabajo.configuracion;
    }

    /** @returns {Array<Object>} */
    obtenerCarpetas() {
      return this.espacioDeTrabajo.carpetas;
    }

    /** @returns {Array<Object>} */
    obtenerArchivos() {
      return this.espacioDeTrabajo.archivos;
    }

    /**
     * @param {string} carpetaId
     * @returns {Object|undefined}
     */
    obtenerCarpetaPorId(carpetaId) {
      return this.espacioDeTrabajo.carpetas.find((carpeta) => carpeta.id === carpetaId);
    }

    /**
     * @param {string} archivoId
     * @returns {Object|undefined}
     */
    obtenerArchivoPorId(archivoId) {
      return this.espacioDeTrabajo.archivos.find((archivo) => archivo.id === archivoId);
    }

    /**
     * Devuelve los archivos contenidos en una carpeta.
     * @param {string} carpetaId
     * @returns {Array<Object>}
     */
    obtenerArchivosDeCarpeta(carpetaId) {
      return this.espacioDeTrabajo.archivos.filter((archivo) => archivo.carpetaId === carpetaId);
    }

    /** @returns {Object|undefined} */
    obtenerArchivoActivo() {
      return this.obtenerArchivoPorId(this.espacioDeTrabajo.configuracion.archivoActivoId);
    }

    /** @returns {string|null} */
    obtenerIdArchivoActivo() {
      return this.espacioDeTrabajo.configuracion.archivoActivoId;
    }

    /**
     * Marca un archivo como activo.
     * @param {string} archivoId
     * @returns {boolean}
     */
    establecerArchivoActivo(archivoId) {
      if (!this.obtenerArchivoPorId(archivoId)) {
        return false;
      }
      this.espacioDeTrabajo.configuracion.archivoActivoId = archivoId;
      this._persistirEspacioDeTrabajo();
      return true;
    }

    /**
     * Devuelve el identificador de la carpeta raíz.
     * @returns {string}
     */
    obtenerIdCarpetaRaiz() {
      const carpetaRaiz = this.espacioDeTrabajo.carpetas.find((carpeta) => carpeta.esRaiz);
      return carpetaRaiz ? carpetaRaiz.id : ID_CARPETA_RAIZ_PREDETERMINADA;
    }

    // ----------------------------------------------------------------------
    // Operaciones sobre carpetas
    // ----------------------------------------------------------------------

    /**
     * Crea una carpeta nueva validando nombre no vacío y sin duplicados.
     * @param {string} nombreCarpeta
     * @returns {{exito:boolean, carpeta?:Object, mensajeError?:string}}
     */
    crearCarpeta(nombreCarpeta) {
      const nombreLimpio = (nombreCarpeta || '').trim();
      if (!nombreLimpio) {
        return { exito: false, mensajeError: 'El nombre de la carpeta no puede estar vacío.' };
      }
      if (this._existeCarpetaConNombre(nombreLimpio)) {
        return { exito: false, mensajeError: 'Ya existe una carpeta con ese nombre.' };
      }

      const carpetaNueva = {
        id: generarIdentificadorUnico('carpeta'),
        nombre: nombreLimpio,
        esRaiz: false,
        fechaCreacion: new Date().toISOString()
      };
      this.espacioDeTrabajo.carpetas.push(carpetaNueva);
      this._persistirEspacioDeTrabajo();
      return { exito: true, carpeta: carpetaNueva };
    }

    /**
     * Renombra una carpeta existente.
     * @param {string} carpetaId
     * @param {string} nuevoNombre
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    renombrarCarpeta(carpetaId, nuevoNombre) {
      const nombreLimpio = (nuevoNombre || '').trim();
      if (!nombreLimpio) {
        return { exito: false, mensajeError: 'El nombre de la carpeta no puede estar vacío.' };
      }
      const carpeta = this.obtenerCarpetaPorId(carpetaId);
      if (!carpeta) {
        return { exito: false, mensajeError: 'La carpeta indicada no existe.' };
      }
      if (this._existeCarpetaConNombre(nombreLimpio, carpetaId)) {
        return { exito: false, mensajeError: 'Ya existe otra carpeta con ese nombre.' };
      }

      carpeta.nombre = nombreLimpio;
      this._persistirEspacioDeTrabajo();
      return { exito: true };
    }

    /**
     * Elimina una carpeta y reasigna sus archivos a la raíz.
     * @param {string} carpetaId
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    eliminarCarpeta(carpetaId) {
      const carpeta = this.obtenerCarpetaPorId(carpetaId);
      if (!carpeta) {
        return { exito: false, mensajeError: 'La carpeta indicada no existe.' };
      }
      if (carpeta.esRaiz) {
        return { exito: false, mensajeError: 'No se puede eliminar la carpeta raíz.' };
      }

      const idRaiz = this.obtenerIdCarpetaRaiz();
      this.espacioDeTrabajo.archivos
        .filter((archivo) => archivo.carpetaId === carpetaId)
        .forEach((archivo) => { archivo.carpetaId = idRaiz; });

      this.espacioDeTrabajo.carpetas =
        this.espacioDeTrabajo.carpetas.filter((carpetaIterada) => carpetaIterada.id !== carpetaId);
      this._persistirEspacioDeTrabajo();
      return { exito: true };
    }

    // ----------------------------------------------------------------------
    // Operaciones sobre archivos
    // ----------------------------------------------------------------------

    /**
     * Crea un archivo de diagrama nuevo.
     * @param {Object} datosArchivo
     * @param {string} [datosArchivo.nombre]
     * @param {string} [datosArchivo.carpetaId]
     * @param {string} [datosArchivo.codigo]
     * @returns {Object} archivo creado
     */
    crearArchivo(datosArchivo = {}) {
      const archivoNuevo = {
        id: generarIdentificadorUnico('archivo'),
        carpetaId: datosArchivo.carpetaId || this.obtenerIdCarpetaRaiz(),
        nombre: (datosArchivo.nombre || 'Diagrama sin título').trim(),
        codigo: typeof datosArchivo.codigo === 'string' ? datosArchivo.codigo : CODIGO_DIAGRAMA_INICIAL,
        fechaModificacion: new Date().toISOString(),
        historial: []
      };
      this.espacioDeTrabajo.archivos.push(archivoNuevo);
      this._persistirEspacioDeTrabajo();
      return archivoNuevo;
    }

    /**
     * Renombra un archivo existente.
     * @param {string} archivoId
     * @param {string} nuevoNombre
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    renombrarArchivo(archivoId, nuevoNombre) {
      const nombreLimpio = (nuevoNombre || '').trim();
      if (!nombreLimpio) {
        return { exito: false, mensajeError: 'El nombre del diagrama no puede estar vacío.' };
      }
      const archivo = this.obtenerArchivoPorId(archivoId);
      if (!archivo) {
        return { exito: false, mensajeError: 'El diagrama indicado no existe.' };
      }

      archivo.nombre = nombreLimpio;
      archivo.fechaModificacion = new Date().toISOString();
      this._persistirEspacioDeTrabajo();
      return { exito: true };
    }

    /**
     * Sobrescribe el contenido del archivo activo.
     * @param {string} codigoMermaid
     * @returns {{exito:boolean, archivo?:Object, mensajeError?:string}}
     */
    guardarDiagramaActual(codigoMermaid) {
      const archivoActivo = this.obtenerArchivoActivo();
      if (!archivoActivo) {
        return { exito: false, mensajeError: 'No hay un diagrama activo para guardar.' };
      }

      // Captura automática: antes de sobrescribir, se archiva el código vigente
      // como una versión recuperable (solo si el contenido realmente cambió).
      if (codigoMermaid !== archivoActivo.codigo) {
        this._registrarVersionHistorica(archivoActivo, archivoActivo.codigo, { forzar: true });
      }

      archivoActivo.codigo = codigoMermaid;
      archivoActivo.fechaModificacion = new Date().toISOString();
      this._persistirEspacioDeTrabajo();
      return { exito: true, archivo: archivoActivo };
    }

    /**
     * Guarda el contenido como un archivo nuevo y lo marca como activo.
     * @param {string} nombreNuevo
     * @param {string} carpetaDestinoId
     * @param {string} codigoMermaid
     * @returns {{exito:boolean, archivo?:Object, mensajeError?:string}}
     */
    guardarDiagramaComo(nombreNuevo, carpetaDestinoId, codigoMermaid) {
      const nombreLimpio = (nombreNuevo || '').trim();
      if (!nombreLimpio) {
        return { exito: false, mensajeError: 'Debes indicar un nombre para el diagrama.' };
      }
      const carpetaValida = this.obtenerCarpetaPorId(carpetaDestinoId)
        ? carpetaDestinoId
        : this.obtenerIdCarpetaRaiz();

      const archivoNuevo = this.crearArchivo({
        nombre: nombreLimpio,
        carpetaId: carpetaValida,
        codigo: codigoMermaid
      });
      this.establecerArchivoActivo(archivoNuevo.id);
      return { exito: true, archivo: archivoNuevo };
    }

    /**
     * Recupera el código de un archivo por su identificador.
     * @param {string} archivoId
     * @returns {string|null}
     */
    cargarArchivoPorId(archivoId) {
      const archivo = this.obtenerArchivoPorId(archivoId);
      return archivo ? archivo.codigo : null;
    }

    // ----------------------------------------------------------------------
    // Historial de versiones
    // ----------------------------------------------------------------------

    /**
     * Devuelve las versiones históricas de un archivo, de la más reciente a la
     * más antigua. Cada entrada incluye su índice original para poder restaurar.
     * @param {string} archivoId
     * @returns {Array<{indice:number, id:string, fecha:string, codigo:string}>}
     */
    obtenerHistorialDeArchivo(archivoId) {
      const archivo = this.obtenerArchivoPorId(archivoId);
      if (!archivo || !Array.isArray(archivo.historial)) {
        return [];
      }
      return archivo.historial.map((version, indice) => ({
        indice,
        id: version.id,
        fecha: version.fecha,
        codigo: version.codigo
      }));
    }

    /**
     * Restaura una versión histórica concreta. Antes de hacerlo archiva el
     * código vigente para no perder el estado actual.
     * @param {string} archivoId
     * @param {number} indiceVersion
     * @returns {{exito:boolean, archivo?:Object, codigo?:string, mensajeError?:string}}
     */
    restaurarVersionDeArchivo(archivoId, indiceVersion) {
      const archivo = this.obtenerArchivoPorId(archivoId);
      if (!archivo || !Array.isArray(archivo.historial)) {
        return { exito: false, mensajeError: 'El diagrama indicado no tiene historial.' };
      }
      const version = archivo.historial[indiceVersion];
      if (!version) {
        return { exito: false, mensajeError: 'La versión seleccionada no existe.' };
      }

      this._registrarVersionHistorica(archivo, archivo.codigo, { forzar: true });
      archivo.codigo = version.codigo;
      archivo.fechaModificacion = new Date().toISOString();
      this._persistirEspacioDeTrabajo();
      return { exito: true, archivo, codigo: version.codigo };
    }

    /**
     * Vacía el historial de un archivo.
     * @param {string} archivoId
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    limpiarHistorialDeArchivo(archivoId) {
      const archivo = this.obtenerArchivoPorId(archivoId);
      if (!archivo) {
        return { exito: false, mensajeError: 'El diagrama indicado no existe.' };
      }
      archivo.historial = [];
      this._persistirEspacioDeTrabajo();
      return { exito: true };
    }

    /**
     * Registra un snapshot del código en el historial del archivo, evitando
     * duplicar el último código archivado y respetando el límite de versiones.
     * @param {Object} archivo
     * @param {string} codigo
     * @param {{forzar?:boolean}} [opciones]
     * @private
     */
    _registrarVersionHistorica(archivo, codigo, opciones = {}) {
      if (!archivo || typeof codigo !== 'string') {
        return;
      }
      if (!Array.isArray(archivo.historial)) {
        archivo.historial = [];
      }

      const versionMasReciente = archivo.historial[0];
      const yaRegistrado = versionMasReciente && versionMasReciente.codigo === codigo;
      if (yaRegistrado && !opciones.forzar) {
        return;
      }
      if (codigo === archivo.codigo && !opciones.forzar) {
        // Nada que archivar: el estado solicitado es idéntico al vigente.
        return;
      }

      archivo.historial.unshift({
        id: generarIdentificadorUnico('version'),
        fecha: new Date().toISOString(),
        codigo
      });

      if (archivo.historial.length > LIMITE_VERSIONES_HISTORICAS) {
        archivo.historial.length = LIMITE_VERSIONES_HISTORICAS;
      }
    }

    /**
     * Elimina un archivo. Si era el activo, activa otro o crea uno vacío.
     * @param {string} archivoId
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    eliminarArchivo(archivoId) {
      const archivo = this.obtenerArchivoPorId(archivoId);
      if (!archivo) {
        return { exito: false, mensajeError: 'El diagrama indicado no existe.' };
      }

      this.espacioDeTrabajo.archivos =
        this.espacioDeTrabajo.archivos.filter((archivoIterado) => archivoIterado.id !== archivoId);

      const eraElActivo = this.espacioDeTrabajo.configuracion.archivoActivoId === archivoId;
      if (eraElActivo) {
        const archivoSiguiente = this.espacioDeTrabajo.archivos[0];
        if (archivoSiguiente) {
          this.espacioDeTrabajo.configuracion.archivoActivoId = archivoSiguiente.id;
        } else {
          const archivoDeReemplazo = this.crearArchivo({
            nombre: NOMBRE_ARCHIVO_PREDETERMINADO,
            codigo: CODIGO_DIAGRAMA_INICIAL
          });
          this.espacioDeTrabajo.configuracion.archivoActivoId = archivoDeReemplazo.id;
        }
      }

      this._persistirEspacioDeTrabajo();
      return { exito: true };
    }

    // ----------------------------------------------------------------------
    // Respaldo e importación
    // ----------------------------------------------------------------------

    /**
     * Serializa el espacio de trabajo para descargarlo como archivo JSON.
     * @returns {{nombreArchivo:string, contenido:string}}
     */
    exportarEspacioDeTrabajoAJson() {
      return {
        nombreArchivo: 'openmermaid_backup.json',
        contenido: JSON.stringify(this.espacioDeTrabajo, null, 2)
      };
    }

    /**
     * Valida e importa un respaldo JSON.
     * @param {string} contenidoJson
     * @returns {{exito:boolean, mensajeError?:string}}
     */
    importarEspacioDeTrabajoDesdeJson(contenidoJson) {
      let espacioImportado;
      try {
        espacioImportado = JSON.parse(contenidoJson);
      } catch (error) {
        return { exito: false, mensajeError: 'El archivo no contiene JSON válido.' };
      }

      const errorDeEsquema = this._validarEsquemaImportado(espacioImportado);
      if (errorDeEsquema) {
        return { exito: false, mensajeError: errorDeEsquema };
      }

      this._establecerEspacioDeTrabajo(this._normalizarEspacioImportado(espacioImportado));
      return { exito: true };
    }

    // ----------------------------------------------------------------------
    // Métricas de almacenamiento
    // ----------------------------------------------------------------------

    /**
     * Calcula métricas de uso de localStorage para el portal de documentación.
     * @returns {{bytesUsados:number, bytesDisponibles:number, limiteBytes:number, porcentajeUso:number, totalDiagramas:number, totalCarpetas:number}}
     */
    calcularMetricasDeAlmacenamiento() {
      const serializado = JSON.stringify(this.espacioDeTrabajo);
      const bytesUsados = new Blob([serializado]).size;

      return {
        bytesUsados,
        bytesDisponibles: Math.max(0, LIMITE_ALMACENAMIENTO_BYTES - bytesUsados),
        limiteBytes: LIMITE_ALMACENAMIENTO_BYTES,
        porcentajeUso: Math.min(100, (bytesUsados / LIMITE_ALMACENAMIENTO_BYTES) * 100),
        totalDiagramas: this.espacioDeTrabajo.archivos.length,
        totalCarpetas: this.espacioDeTrabajo.carpetas.length
      };
    }

    // ----------------------------------------------------------------------
    // Utilidades internas
    // ----------------------------------------------------------------------

    /**
     * Crea la estructura de espacio de trabajo por defecto.
     * @returns {Object}
     * @private
     */
    _crearEspacioDeTrabajoPredeterminado() {
      const marcaDeTiempo = new Date().toISOString();
      return {
        version: VERSION_ESQUEMA_ESPACIO,
        configuracion: {
          tema: 'dark',
          sidebarVisible: true,
          archivoActivoId: ID_ARCHIVO_PREDETERMINADO
        },
        carpetas: [
          {
            id: ID_CARPETA_RAIZ_PREDETERMINADA,
            nombre: NOMBRE_CARPETA_RAIZ,
            esRaiz: true,
            fechaCreacion: marcaDeTiempo
          }
        ],
        archivos: [
          {
            id: ID_ARCHIVO_PREDETERMINADO,
            carpetaId: ID_CARPETA_RAIZ_PREDETERMINADA,
            nombre: NOMBRE_ARCHIVO_PREDETERMINADO,
            codigo: CODIGO_DIAGRAMA_INICIAL,
            fechaModificacion: marcaDeTiempo,
            historial: []
          }
        ]
      };
    }

    /**
     * Lee y deserializa el espacio de trabajo almacenado.
     * @returns {Object|null}
     * @private
     */
    _leerEspacioDeAlmacenamiento() {
      try {
        const serializado = window.localStorage.getItem(this.claveAlmacenamiento);
        return serializado ? JSON.parse(serializado) : null;
      } catch (error) {
        return null;
      }
    }

    /**
     * Persiste el espacio de trabajo completo.
     * @private
     */
    _persistirEspacioDeTrabajo() {
      try {
        window.localStorage.setItem(this.claveAlmacenamiento, JSON.stringify(this.espacioDeTrabajo));
      } catch (error) {
        /* Cuota excedida o almacenamiento no disponible: se ignora de forma segura. */
      }
    }

    /**
     * Asegura que la estructura cargada sea coherente y tenga raíz y activo.
     * @private
     */
    _garantizarIntegridadDelEspacio() {
      const espacio = this.espacioDeTrabajo;
      espacio.version = espacio.version || VERSION_ESQUEMA_ESPACIO;
      espacio.configuracion = espacio.configuracion || {};
      espacio.carpetas = Array.isArray(espacio.carpetas) ? espacio.carpetas : [];
      espacio.archivos = Array.isArray(espacio.archivos) ? espacio.archivos : [];

      if (!espacio.carpetas.some((carpeta) => carpeta.esRaiz)) {
        espacio.carpetas.unshift({
          id: ID_CARPETA_RAIZ_PREDETERMINADA,
          nombre: NOMBRE_CARPETA_RAIZ,
          esRaiz: true,
          fechaCreacion: new Date().toISOString()
        });
      }

      if (espacio.archivos.length === 0) {
        espacio.archivos.push({
          id: ID_ARCHIVO_PREDETERMINADO,
          carpetaId: this.obtenerIdCarpetaRaiz(),
          nombre: NOMBRE_ARCHIVO_PREDETERMINADO,
          codigo: CODIGO_DIAGRAMA_INICIAL,
          fechaModificacion: new Date().toISOString(),
          historial: []
        });
      }

      espacio.archivos.forEach((archivo) => {
        if (!Array.isArray(archivo.historial)) {
          archivo.historial = [];
        } else if (archivo.historial.length > LIMITE_VERSIONES_HISTORICAS) {
          archivo.historial.length = LIMITE_VERSIONES_HISTORICAS;
        }
      });

      const idActivoValido = espacio.archivos.some(
        (archivo) => archivo.id === espacio.configuracion.archivoActivoId
      );
      if (!idActivoValido) {
        espacio.configuracion.archivoActivoId = espacio.archivos[0].id;
      }

      if (typeof espacio.configuracion.sidebarVisible !== 'boolean') {
        espacio.configuracion.sidebarVisible = true;
      }
      if (espacio.configuracion.tema !== 'light') {
        espacio.configuracion.tema = 'dark';
      }
    }

    /**
     * Comprueba si ya existe una carpeta con el nombre dado.
     * @param {string} nombreBuscado
     * @param {string} [carpetaIgnoradaId]
     * @returns {boolean}
     * @private
     */
    _existeCarpetaConNombre(nombreBuscado, carpetaIgnoradaId) {
      const nombreNormalizado = nombreBuscado.toLowerCase();
      return this.espacioDeTrabajo.carpetas.some((carpeta) => {
        if (carpeta.id === carpetaIgnoradaId) {
          return false;
        }
        return carpeta.nombre.toLowerCase() === nombreNormalizado;
      });
    }

    /**
     * Valida el esquema mínimo de un respaldo importado.
     * @param {unknown} espacioImportado
     * @returns {string|null} mensaje de error o null si es válido
     * @private
     */
    _validarEsquemaImportado(espacioImportado) {
      if (!espacioImportado || typeof espacioImportado !== 'object') {
        return 'El respaldo no tiene una estructura de objeto válida.';
      }
      if (!Array.isArray(espacioImportado.carpetas)) {
        return 'El respaldo no incluye un arreglo "carpetas" válido.';
      }
      if (!Array.isArray(espacioImportado.archivos)) {
        return 'El respaldo no incluye un arreglo "archivos" válido.';
      }

      const archivoInvalido = espacioImportado.archivos.find(
        (archivo) => !archivo || typeof archivo.codigo !== 'string' || typeof archivo.id !== 'string'
      );
      if (archivoInvalido) {
        return 'Uno de los diagramas del respaldo no tiene "id" o "codigo" válidos.';
      }
      return null;
    }

    /**
     * Normaliza un respaldo importado a una estructura segura.
     * @param {Object} espacioImportado
     * @returns {Object}
     * @private
     */
    _normalizarEspacioImportado(espacioImportado) {
      const archivosNormalizados = espacioImportado.archivos.map((archivo) => ({
        ...archivo,
        historial: Array.isArray(archivo.historial)
          ? archivo.historial.slice(0, LIMITE_VERSIONES_HISTORICAS)
          : []
      }));

      return {
        version: espacioImportado.version || VERSION_ESQUEMA_ESPACIO,
        configuracion: espacioImportado.configuracion || {
          tema: 'dark',
          sidebarVisible: true,
          archivoActivoId: espacioImportado.archivos[0] ? espacioImportado.archivos[0].id : null
        },
        carpetas: espacioImportado.carpetas,
        archivos: archivosNormalizados
      };
    }

    /**
     * Formatea un tamaño en bytes a una cadena legible.
     * @param {number} bytes
     * @returns {string}
     */
    static formatearTamanoLegibleDeBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  }

  namespaceOpenMermaid.FileSystemManager = FileSystemManager;
  namespaceOpenMermaid.CODIGO_DIAGRAMA_INICIAL = CODIGO_DIAGRAMA_INICIAL;
  namespaceOpenMermaid.LIMITE_VERSIONES_HISTORICAS = LIMITE_VERSIONES_HISTORICAS;
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
