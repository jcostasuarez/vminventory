# VM Inventory

Aplicación de escritorio para inspeccionar discos de máquinas virtuales sin
encenderlas, inventariar el software instalado y generar reportes JSON.
Está construida con Tauri 2, Rust, TypeScript, Vite y el motor `vmspect`.

> Este README documenta especialmente el funcionamiento de `rules.json`, que
> controla las exclusiones del escaneo y la clasificación del software.

## Qué hace

- Inspecciona imágenes `.vmdk`, `.vdi`, `.vhd`, `.vhdx`, `.qcow`, `.qcow2`,
  `.raw` e `.img`.
- Recorre un directorio de forma recursiva y procesa las imágenes encontradas
  con `vmspect`.
- Detecta el sistema operativo, particiones, metadatos y software instalado.
- Clasifica el software por proveedor, categoría y etiquetas.
- Guarda un inventario consolidado en JSON.
- Permite consultar inventarios existentes y revisar una imagen individual.
- Puede usar `qemu-nbd` cuando `vmspect` lo necesita para acceder a una imagen.

La aplicación analiza discos en reposo: no inicia las máquinas virtuales ni
modifica su contenido.

## Flujo de uso

1. En **Analizador**, seleccioná el directorio que contiene las imágenes.
2. Seleccioná el directorio donde se guardará el inventario JSON.
3. En **Configuración**, opcionalmente indicá un archivo propio en **Archivo
   de reglas**.
4. Ejecutá el relevamiento.
5. Abrí el resultado desde **Consultor** o inspeccioná una imagen desde
   **Reporte**.

El relevamiento carga las reglas una vez al comenzar la operación. Una nueva
edición del archivo se toma en el siguiente relevamiento o inspección; no hay
un observador de archivos que cambie una operación que ya está ejecutándose.

## `rules.json`: idea general

`rules.json` es una configuración externa. No es un archivo de resultados y no
contiene la lista de máquinas virtuales. Define dos cosas diferentes:

1. **Qué no recorrer:** carpetas y archivos que deben excluirse durante el
   descubrimiento de imágenes.
2. **Cómo tratar el software detectado:** software prioritario, software
   específico que debe clasificarse, ruido del sistema y categorías generales.

Las reglas externas **se combinan con las reglas integradas**; no las
reemplazan. Esto permite agregar reglas propias sin copiar toda la plantilla
predeterminada.

### `exclusions` y `noise` no hacen lo mismo

| Sección | Qué evalúa | Cuándo actúa | Resultado |
| --- | --- | --- | --- |
| `exclusions` | Rutas, carpetas y nombres de archivos de disco | Antes de inspeccionar la imagen | La imagen o el recorrido excluido no se procesa. |
| `noise` | Nombre y editor del software instalado | Después de inspeccionar la VM | El programa se omite del inventario normal, pero la VM sí fue inspeccionada. |

Ejemplo: si agregás `"*.iso"` a `exclusions.files`, no se inspeccionan las
imágenes ISO encontradas. Si agregás `"microsoft .net framework"` a `noise`,
la imagen sí se inspecciona, pero ese programa no aparece en el resultado
normal. Con **modo dump**, el programa marcado como ruido vuelve a aparecer con
`relevante: false`.

En resumen:

- Usá `exclusions` para reducir el alcance del escaneo y evitar recorrer
  contenido que no querés analizar.
- Usá `noise` para quitar del inventario software repetitivo o poco útil que
  igualmente necesitás detectar durante la inspección.

### Dónde se busca el archivo

Cuando no se especifica una ruta personalizada, la aplicación busca en este
orden:

1. `rules.json` en el directorio de trabajo actual.
2. `rules.toml` en el directorio de trabajo actual.
3. `rules.json` junto al ejecutable.
4. En Windows, `%APPDATA%\VMInventory\rules.json`.
5. En Linux y macOS, `~/.config/vminventory/rules.json`.
6. Como último recurso, `rules.json` relativo al directorio actual.

La ruta indicada en **Analizador → Configuración → Archivo de reglas** tiene
prioridad sobre toda esta búsqueda. Una ruta personalizada no válida no activa
un archivo alternativo: la aplicación registra una advertencia y utiliza las
reglas integradas.

Al iniciar Tauri, si no existe el archivo predeterminado resuelto, se crea
una plantilla con las reglas integradas. La ruta personalizada no se crea
automáticamente.

### Los dos `rules.json` versionados

El repositorio contiene:

- `rules.json`: útil cuando el directorio de trabajo es la raíz del proyecto y
  también sirve como configuración de desarrollo.
- `src-tauri/rules.json`: recurso configurado para incluirse en el bundle de
  Tauri mediante `src-tauri/tauri.conf.json`.

El archivo realmente usado no se decide por el nombre del archivo versionado,
sino por la resolución anterior o por la ruta personalizada. Si se mantienen
ambas copias, conviene aplicar los mismos cambios en las dos para evitar
confusiones entre desarrollo y distribución.

## Estructura del archivo

El formato principal es JSON. TOML también es aceptado por el backend, aunque
el archivo distribuido y los ejemplos del proyecto usan JSON.

```json
{
  "version": "2.0.0",
  "exclusions": {
    "folders": ["node_modules", "Temp", "mi-directorio-privado"],
    "files": ["*.tmp", "*.iso", "secreto-*.vmdk"]
  },
  "classifications": [
    {
      "vendor": "Acme",
      "software": "Acme Control Suite",
      "patterns": ["*Acme Control*", "acme-control.exe"],
      "category": "Automatización Industrial",
      "tags": ["acme", "control"]
    }
  ],
  "noise": [
    {
      "nombre": "mi componente auxiliar",
      "motivo": "Componente técnico que no debe aparecer en el inventario normal."
    }
  ],
  "categories": [
    {
      "nombre": "Herramientas internas",
      "patrones": ["intranet", "portal interno"],
      "tags": ["interno"]
    }
  ]
}
```

Los campos desconocidos, como `$schema`, se ignoran. `version` también es
informativa actualmente: el backend no la usa para cambiar el comportamiento.

### `exclusions`

| Campo | Tipo | Funcionamiento |
| --- | --- | --- |
| `folders` | array de strings | Excluye directorios y segmentos de ruta que coincidan. |
| `files` | array de strings | Excluye el nombre de archivo de la imagen encontrada. |

Las exclusiones integradas incluyen, entre otras, `System Volume Information`,
`$RECYCLE.BIN`, `Temp`, `.git`, `node_modules`, `*.tmp`, `*.sys`, `*.iso` y
`*.log`. Las exclusiones del archivo externo se agregan a las integradas y no
eliminan las existentes.

### `classifications`

Cada elemento describe una clasificación específica:

| Campo | Obligatorio | Funcionamiento |
| --- | --- | --- |
| `vendor` | No | Patrón para comparar con el editor/proveedor detectado. Si se omite, coincide con cualquier proveedor. |
| `software` | No estricto | Nombre descriptivo que aparece en el motivo de clasificación. |
| `patterns` | No | Patrones comparados con el nombre del software o ejecutable. |
| `category` | No | Categoría que se asigna; si falta, se usa `Automatización Industrial`. |
| `tags` | No | Etiquetas que se guardan en el resultado. |

Las clasificaciones escritas por el usuario se colocan antes de las
clasificaciones integradas. Si dos clasificaciones coinciden, gana la primera.

### `noise`

Cada entrada tiene:

- `nombre`: patrón del nombre del software. También se acepta como `patron`.
- `editor`: patrón opcional del proveedor. También se aceptan `vendor` y
  `fabricante`.
- `motivo`: explicación que se conserva en el veredicto.

El software que coincide se considera no relevante y se descarta del resultado
normal. En el archivo también puede llamarse `ruido`.

Por ejemplo, para ocultar 7-Zip en un relevamiento normal:

```json
"noise": [
  {
    "nombre": "7-zip",
    "motivo": "Utilidad no relevante para este inventario."
  },
  {
    "nombre": "7zip",
    "motivo": "Variante del nombre de 7-Zip."
  }
]
```

Los patrones no distinguen mayúsculas de minúsculas. No hace falta quitar
`7-zip` de `classifications` ni de `categories`: `noise` se evalúa primero, por
lo que el programa se descarta aunque también coincida con otras reglas.

El **modo dump** del Analizador cambia únicamente el filtrado final: conserva
todo el software detectado, incluso el que las reglas marcaron como ruido.
Por eso el campo `relevante` puede ser `false` en un resultado generado con
modo dump. Si querés que 7-Zip no aparezca, desactivá **Conservar todo el
software detectado (modo dump)**.

Si una regla `noise` parece no funcionar, verificá lo siguiente:

1. El nombre está dentro de la sección `noise`, no dentro de `exclusions`.
   `exclusions.files` solo compara nombres de archivos de disco; no compara
   nombres de programas instalados.
2. La ruta configurada en **Analizador → Configuración → Archivo de reglas** es
   el archivo que editaste. Si está vacía, se usa la ruta predeterminada; el
   repositorio contiene tanto `rules.json` como `src-tauri/rules.json`.
3. Ejecutaste un nuevo relevamiento. Los reportes JSON existentes no se
   reclasifican al cambiar las reglas.
4. El modo dump está desactivado.

### `categories`

`categories` **no filtra software**: no lo incluye por sí sola ni lo elimina.
Solo agrega una categoría y sus etiquetas a un programa que ya fue considerado
relevante.

Cada categoría contiene:

- `nombre`: nombre que se muestra en el resultado.
- `patrones`: lista de patrones para el nombre del software.
- `tags`: etiquetas asociadas.

También se aceptan `categoria` y `categorias` como nombres alternativos de la
sección. Las categorías externas se agregan después de las categorías
integradas. Se usa la primera categoría cuyos patrones coincidan.

La diferencia con `classifications` es:

| Sección | Uso principal | Datos que puede evaluar |
| --- | --- | --- |
| `classifications` | Clasificación específica | Nombre, editor/proveedor, categoría, etiquetas y nombre descriptivo del software |
| `categories` | Clasificación general | Solo el nombre del software, categoría y etiquetas |

Ejemplo: `7-zip` puede coincidir con la categoría `Utilidades`, pero seguirá
apareciendo si no está en `noise`. Para ocultarlo hay que agregarlo a `noise`,
no solo a `categories`.

## Orden de evaluación

Para cada programa detectado, el backend aplica este orden:

```text
1. noise
2. classifications
3. categories
4. software no categorizado
```

El resultado práctico es:

- `noise` siempre gana frente a `classifications` y `categories`.
- Una clasificación específica se aplica solo si el programa no coincide con `noise`.
- `noise` elimina el programa del inventario normal.
- Una categoría asigna nombre y etiquetas, pero no es necesaria para que el
  programa sea relevante.
- Si nada coincide, el software se conserva como relevante y sin categoría.
- Con **modo dump**, se conservan también los programas descartados por ruido.

Usá `noise` para una excepción negativa: software repetitivo o poco útil que
debe ocultarse del inventario normal. Todo software que no coincida con una
regla `noise` se conserva, con o sin categoría.

## Patrones admitidos

Todos los patrones se comparan sin distinguir mayúsculas de minúsculas.

### Literales

- Un literal con espacios o signos se busca como subcadena. Por ejemplo,
  `visual studio` coincide con `Microsoft Visual Studio 2022`.
- Un literal alfanumérico sin espacios se compara como palabra. También puede
  coincidir con el comienzo de una palabra cuando el patrón tiene al menos
  cuatro caracteres. Por ejemplo, `chrome` coincide con `chromedriver`.
- Los literales vacíos no coinciden.

### Comodines

- `*` coincide con cualquier cantidad de caracteres, incluso ninguno.
- `?` coincide con exactamente un carácter.
- Los comodines se aplican al texto completo porque el patrón generado queda
  anclado al principio y al final.

Ejemplos:

```text
*.iso          -> imagen.iso
*Step7*        -> Siemens STEP 7 Professional
file?.tmp      -> file7.tmp, pero no file77.tmp
```

Los caracteres especiales de una expresión con comodines se tratan como
literales, no como operadores de regex.

### Expresiones regulares

Una expresión se interpreta como regex si:

- comienza con `^`,
- termina con `$`, o
- comienza con `regex:`.

El prefijo `regex:` se elimina antes de compilar. Las regex son
*case-insensitive* y usan la sintaxis de la crate `regex` de Rust.

```text
^sql\s+server\s+.*$
regex:^release-[0-9]+$
```

Si una regex es inválida, la aplicación registra una advertencia y conserva
una coincidencia literal de respaldo; no aborta todo el relevamiento.

## Cómo agregar una regla

1. Copiá el archivo que querés usar como base o creá un JSON con la estructura
   anterior.
2. Agregá el patrón en la sección adecuada:
   - `exclusions` para no recorrer imágenes o directorios.
   - `classifications` para una regla específica con proveedor y etiquetas.
   - `noise` para ocultar componentes repetitivos del sistema.
   - `categories` para clasificar software general.
3. Validá que el archivo sea JSON válido y que todas las comas estén bien
   colocadas.
4. Seleccioná la ruta desde la configuración del Analizador o reemplazá el
   archivo predeterminado.
5. Ejecutá una nueva inspección. Los cambios no se aplican retroactivamente a
   reportes JSON ya generados.

Para probar una regla concreta, se puede ejecutar una inspección pequeña y
revisar el campo `categoria`, `tags` y `relevante` del reporte resultante. La
clasificación también está implementada en `src-tauri/src/clasificacion.rs`,
y la aplicación expone comandos Tauri de consulta y simulación para clientes
que los utilicen.

## Desarrollo

### Requisitos

- Node.js 18 o superior.
- Rust 1.77.2 o superior.
- Herramientas de compilación nativas: Visual Studio C++ Build Tools en
  Windows, o las dependencias de Tauri para Linux/macOS.
- `qemu-nbd` para imágenes que requieran ese backend. `vmspect` resuelve y
  ejecuta el binario cuando la inspección lo necesita.

### Instalación y comprobaciones

```bash
npm install
npm run typecheck
npm test
```

### Comandos útiles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia solo Vite en `http://localhost:5173`. |
| `npm run tauri dev` | Inicia la aplicación Tauri en desarrollo. |
| `npm run build` | Compila el frontend en `dist/`. |
| `npm test` | Ejecuta las pruebas frontend y backend. |
| `npm run test:frontend` | Ejecuta los contratos del frontend. |
| `npm run test:backend` | Ejecuta las pruebas Rust. |
| `npm run typecheck` | Valida TypeScript sin emitir archivos. |
| `npm run tauri build` | Genera los artefactos de distribución. |

## Estructura relevante

```text
vminventory/
├── rules.json                 # Reglas para desarrollo/directorio actual
├── src/
│   └── js/                    # Frontend TypeScript
├── src-tauri/
│   ├── rules.json             # Recurso incluido en el bundle de Tauri
│   ├── src/
│   │   ├── clasificacion.rs   # Carga, combinación y evaluación de reglas
│   │   ├── commands.rs        # Comandos IPC de Tauri
│   │   ├── models.rs          # DTOs y configuración
│   │   └── relevamiento.rs    # Escaneo y filtrado del inventario
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/                     # Contratos y pruebas del frontend
├── index.html
├── package.json
└── README.md
```

## Notas de implementación

- El archivo de reglas se lee y sus patrones se compilan al iniciar cada
  operación de inspección o relevamiento.
- El descubrimiento y la inspección de imágenes pertenecen a `vmspect`; VM
  Inventory adapta sus resultados y aplica la clasificación propia.
- Un lote conserva informes parciales y errores por imagen.
- Solo una operación de inspección o relevamiento puede estar activa a la vez.
- Los reportes generados son datos persistidos: cambiar `rules.json` no los
  vuelve a clasificar automáticamente.
