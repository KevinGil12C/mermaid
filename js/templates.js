/**
 * OpenMermaid Studio - Catálogo de plantillas de diagramas.
 *
 * Cada plantilla es un objeto inmutable con metadatos para la galería y el
 * código Mermaid de partida. Mantenerlas en un único arreglo facilita añadir
 * nuevas sin tocar la lógica de la interfaz.
 *
 * @module templates
 */
(function (namespaceOpenMermaid) {
  'use strict';

  /**
   * @typedef {Object} PlantillaDiagrama
   * @property {string} identificador clave única de la plantilla
   * @property {string} nombre etiqueta visible
   * @property {string} descripcion breve explicación de uso
   * @property {string} icono ligadura de Material Symbols
   * @property {string} codigo fuente Mermaid
   */

  /** @type {PlantillaDiagrama[]} */
  const CATALOGO_DE_PLANTILLAS = [
    {
      identificador: 'flowchart',
      nombre: 'Diagrama de flujo',
      descripcion: 'Procesos, decisiones y rutas condicionales.',
      icono: 'account_tree',
      codigo: [
        'flowchart TD',
        '    A([Inicio]) --> B{¿Usuario autenticado?}',
        '    B -- Sí --> C[Cargar panel principal]',
        '    B -- No --> D[Mostrar formulario de acceso]',
        '    D --> E[Validar credenciales]',
        '    E -- Correcto --> C',
        '    E -- Incorrecto --> D',
        '    C --> F([Fin])'
      ].join('\n')
    },
    {
      identificador: 'sequence',
      nombre: 'Diagrama de secuencia',
      descripcion: 'Interacción temporal entre participantes.',
      icono: 'swap_horiz',
      codigo: [
        'sequenceDiagram',
        '    participant Usuario',
        '    participant Navegador',
        '    participant Servidor',
        '    Usuario->>Navegador: Ingresa credenciales',
        '    Navegador->>Servidor: POST /login',
        '    Servidor-->>Navegador: Token JWT',
        '    Navegador-->>Usuario: Redirige al panel'
      ].join('\n')
    },
    {
      identificador: 'class',
      nombre: 'Diagrama de clases',
      descripcion: 'Modelo de objetos, atributos y herencia.',
      icono: 'schema',
      codigo: [
        'classDiagram',
        '    class Usuario {',
        '        +String nombre',
        '        +String correo',
        '        +iniciarSesion()',
        '    }',
        '    class Administrador {',
        '        +gestionarUsuarios()',
        '    }',
        '    class Cliente {',
        '        +realizarPedido()',
        '    }',
        '    Usuario <|-- Administrador',
        '    Usuario <|-- Cliente'
      ].join('\n')
    },
    {
      identificador: 'state',
      nombre: 'Diagrama de estados',
      descripcion: 'Ciclo de vida y transiciones de una entidad.',
      icono: 'toggle_on',
      codigo: [
        'stateDiagram-v2',
        '    [*] --> Borrador',
        '    Borrador --> Revision: Enviar',
        '    Revision --> Aprobado: Aprobar',
        '    Revision --> Borrador: Rechazar',
        '    Aprobado --> [*]'
      ].join('\n')
    },
    {
      identificador: 'erd',
      nombre: 'Diagrama entidad-relación',
      descripcion: 'Esquema de base de datos y cardinalidades.',
      icono: 'table_chart',
      codigo: [
        'erDiagram',
        '    CLIENTE ||--o{ PEDIDO : realiza',
        '    PEDIDO ||--|{ LINEA_PEDIDO : contiene',
        '    PRODUCTO ||--o{ LINEA_PEDIDO : incluye',
        '    CLIENTE {',
        '        int id',
        '        string nombre',
        '        string correo',
        '    }',
        '    PEDIDO {',
        '        int id',
        '        date fecha',
        '    }'
      ].join('\n')
    },
    {
      identificador: 'gantt',
      nombre: 'Diagrama de Gantt',
      descripcion: 'Planificación temporal de tareas por etapas.',
      icono: 'calendar_month',
      codigo: [
        'gantt',
        '    title Plan de proyecto',
        '    dateFormat YYYY-MM-DD',
        '    section Diseño',
        '        Investigación :a1, 2026-01-01, 7d',
        '        Prototipo :after a1, 10d',
        '    section Desarrollo',
        '        Implementación :2026-01-20, 20d',
        '        Pruebas :2026-02-10, 10d'
      ].join('\n')
    },
    {
      identificador: 'gitgraph',
      nombre: 'GitGraph',
      descripcion: 'Historial de ramas y fusiones del repositorio.',
      icono: 'fork_right',
      codigo: [
        'gitGraph',
        '    commit id: "Inicio"',
        '    branch develop',
        '    checkout develop',
        '    commit id: "Feature A"',
        '    commit id: "Feature B"',
        '    checkout main',
        '    merge develop',
        '    commit id: "Release 1.0"'
      ].join('\n')
    },
    {
      identificador: 'mindmap',
      nombre: 'Mindmap',
      descripcion: 'Mapa mental jerárquico de ideas.',
      icono: 'bubble_chart',
      codigo: [
        'mindmap',
        '  root((OpenMermaid Studio))',
        '    Editor',
        '      Numeración de líneas',
        '      Tabulaciones',
        '    Diseño',
        '      Armonías de color',
        '      Contraste WCAG',
        '    Exportación',
        '      SVG',
        '      PNG',
        '      PDF'
      ].join('\n')
    },
    {
      identificador: 'pie',
      nombre: 'Gráfico circular',
      descripcion: 'Distribución proporcional de datos.',
      icono: 'pie_chart',
      codigo: [
        'pie showData',
        '    title Distribución de diagramas',
        '    "Flowchart" : 35',
        '    "Sequence" : 25',
        '    "Class" : 15',
        '    "State" : 10',
        '    "Otros" : 15'
      ].join('\n')
    }
  ];

  /**
   * Recupera una plantilla por su identificador.
   * @param {string} identificador
   * @returns {PlantillaDiagrama|undefined}
   */
  function obtenerPlantillaPorIdentificador(identificador) {
    return CATALOGO_DE_PLANTILLAS.find((plantilla) => plantilla.identificador === identificador);
  }

  /**
   * Devuelve el código de la primera plantilla como contenido inicial.
   * @returns {string}
   */
  function obtenerCodigoDePlantillaInicial() {
    return CATALOGO_DE_PLANTILLAS[0].codigo;
  }

  namespaceOpenMermaid.Templates = {
    CATALOGO_DE_PLANTILLAS,
    obtenerPlantillaPorIdentificador,
    obtenerCodigoDePlantillaInicial
  };
})(window.OpenMermaidStudio = window.OpenMermaidStudio || {});
