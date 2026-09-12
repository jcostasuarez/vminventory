# VM Inventory v4.0.0 - Consultor visual, agrupación y contrato de reglas renovado

## 🚀 Resumen del lanzamiento

`v4.0.0` incorpora nuevas vistas de tabla y mapa para el Consultor, agrupación
backend por múltiples criterios y filtrado directo desde tarjetas y celdas.
También actualiza el contrato de clasificación y la precedencia de reglas.

## ⚠️ Cambios rompientes

- Se elimina la configuración `whitelist` integrada y externa; el ruido del
  sistema se descarta antes de cualquier clasificación.
- Se elimina el campo `es_whitelist` del resultado de clasificación.
- El comando de consulta admite agrupación y paginación, y las respuestas
  agrupadas usan `grupos` con compatibilidad de lectura para datos históricos.
- Los consumidores de `rules.json` y del contrato IPC deben actualizarse antes
  de adoptar esta versión.

## ✨ Cambios principales

- **Consultor:** vistas de tarjetas, tabla ordenable y mapa relacional con
  límites de rendimiento, selección accesible y filtros desde resultados.
- **Agrupación:** agrupación por máquina virtual, categoría, sistema operativo,
  responsable o tipo, conservando el orden de las tarjetas dentro de cada grupo.
- **Backend:** nuevos DTOs, resumen de grupos, paginación y contratos de prueba
  para consultas agrupadas.
- **Reglas:** simplificación del modelo de patrones y nueva precedencia para
  descartar ruido del sistema antes de clasificar.
- **Frontend:** nuevos estilos, controles de agrupación y dependencias D3 para
  el mapa del Consultor.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_4.0.0_x64-setup.exe` | 2,891,069 bytes | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_4.0.0_x64_en-US.msi` | 4,304,896 bytes | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v4.0.0.tar.gz` / `v4.0.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_4.0.0_x64-setup.exe` | `71966312632cb3769ebdd7a70e7b328ef399a3e639262f82b4ac2479de2350ec` |
| `VM Inventory_4.0.0_x64_en-US.msi` | `f7342bbf2144c0ccc308a7d813a9d7cd53c4a6c2026f3ea44f5223f3173a5fc7` |

Los hashes fueron calculados después de generar y validar los instaladores.

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 30 contratos frontend, 15 pruebas unitarias y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run build`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente con `vmspect v0.9.0`.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_4.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_4.0.0_x64_en-US.msi`

---

# VM Inventory v3.3.0 - Telemetría visual y actualización de vmspect

## 🚀 Resumen del lanzamiento

La versión menor `v3.3.0` actualiza `vmspect` a `v0.9.0` y desacopla la frecuencia de consulta de snapshots de la frecuencia de redibujado visual del Analizador. El cambio reduce trabajo innecesario en la interfaz sin alterar el contrato funcional de progreso ni introducir cambios rompientes.

## 🔧 Cambios principales

- **Motor actualizado:** `vmspect v0.9.0` queda fijado en Cargo y sus contratos backend verifican la versión utilizada.
- **Telemetría eficiente:** el Analizador consulta snapshots cada 400 ms, pero actualiza la representación visual una vez por segundo.
- **Supervisión segura:** se separan los temporizadores de consulta y presentación, se liberan al finalizar o desmontar la vista y se ignoran respuestas IPC de ejecuciones obsoletas.
- **Documentación sincronizada:** Cargo, Tauri, npm, lockfiles, README y los artefactos Windows se publican como `v3.3.0`.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_3.3.0_x64-setup.exe` | 2,865,540 bytes | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_3.3.0_x64_en-US.msi` | 4,272,128 bytes | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v3.3.0.tar.gz` / `v3.3.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_3.3.0_x64-setup.exe` | `f71199e6b90ea6f1e945b5b27665a4261e3c08263dba0ef15e806ae532ed6930` |
| `VM Inventory_3.3.0_x64_en-US.msi` | `aa16015fc30851671d7c23fa14d92ec9521ee23f104b79b798c083bd32485254` |

Los hashes fueron calculados después de generar y validar los instaladores.

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 12 contratos frontend, 14 pruebas unitarias y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run build`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente con `vmspect v0.9.0`.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_3.3.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_3.3.0_x64_en-US.msi`

---

# VM Inventory v3.2.0 - Progreso por snapshots y Consultor dinámico

## 🚀 Resumen del lanzamiento

La versión menor `v3.2.0` actualiza `vmspect` a `v0.8.0` y moderniza la supervisión de relevamientos e inspecciones mediante snapshots atómicos de progreso. También incorpora un Consultor basado en carpetas de inventario, configuración avanzada del Analizador y una clasificación más eficiente.

## 🔧 Cambios principales

- **Motor actualizado:** `vmspect v0.8.0` publica progreso agregado para lotes e inspecciones individuales sin callbacks de telemetría desde los workers.
- **Progreso y cancelación:** el frontend consulta snapshots, adapta etapas y porcentajes, limpia el polling al terminar y conserva resultados parciales.
- **Clasificación eficiente:** los patrones se compilan una sola vez, con advertencias para expresiones inválidas y coincidencia de respaldo.
- **Consultor dinámico:** cada subcarpeta directa y legible se convierte en un tipo; se añaden filtros por versión, tipo y responsable, sugerencias, chips de filtros y agrupación.
- **Configuración avanzada:** se centralizan reglas, modo dump, SYSTEM, discrepancias, workers, acceso a discos y seguimiento de bitácora.
- **Accesibilidad y UX:** se añaden roles ARIA, navegación por teclado, estados vivos y superficies revisadas para Analizador, Consultor y Reporte.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_3.2.0_x64-setup.exe` | 2,864,415 bytes | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_3.2.0_x64_en-US.msi` | 4,272,128 bytes | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v3.2.0.tar.gz` / `v3.2.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_3.2.0_x64-setup.exe` | `b3b1c5a5b7869ff91d048a94129b92b9c1301ee6f6076598169cf5ebe0fe9f8b` |
| `VM Inventory_3.2.0_x64_en-US.msi` | `d8628a10038cc8ad8c5306d4266d687481ec9bed035bc84d80b42df72888a942` |

Los hashes fueron calculados después de generar y validar los instaladores.

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 12 contratos frontend, 13 pruebas unitarias y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run build`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente con `vmspect v0.8.0`.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_3.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_3.2.0_x64_en-US.msi`

---

# VM Inventory v3.0.0 - Delegación completa de qemu-nbd

## 🚀 Resumen del lanzamiento

La versión mayor `v3.0.0` centraliza en `vmspect` la resolución, validación y ejecución de `qemu-nbd`, eliminando la duplicación de lógica en la capa Tauri y haciendo explícita la frontera de integración del motor.

## ⚠️ Cambios rompientes

- Se elimina el comando IPC Tauri `validar_binario_qemu`.
- Se elimina el método frontend `validarQemu` y la UI de validación manual de `qemu-nbd`.
- Las integraciones que consumían esa operación deben depender de la resolución y validación que `vmspect` realiza durante la inspección.

## 🔧 Cambios principales

- VM Inventory transmite a `vmspect` únicamente la ruta opcional configurada y la solicitud de backend NBD.
- El diagnóstico del sistema ya no reporta disponibilidad de `qemu-nbd` fuera de una operación de inspección.
- Se añaden contratos backend que garantizan que la ruta explícita y la opción `force_nbd` llegan al motor sin resolución local.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_3.0.0_x64-setup.exe` | 2,838,034 bytes | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_3.0.0_x64_en-US.msi` | 4,235,264 bytes | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v3.0.0.tar.gz` / `v3.0.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_3.0.0_x64-setup.exe` | `ae7b6002b10b0bfcc1971b8009308395a1ae9a7de6ba43e693524ca668a3bd5e` |
| `VM Inventory_3.0.0_x64_en-US.msi` | `87ff8aa420cc876f318e8d74113a396bb99df8f7dacdef7d8ed0a21760014e23` |

Para verificar un archivo descargado desde PowerShell:

```powershell
Get-FileHash -Path ".\VM Inventory_3.0.0_x64-setup.exe" -Algorithm SHA256
Get-FileHash -Path ".\VM Inventory_3.0.0_x64_en-US.msi" -Algorithm SHA256
```

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 7 contratos frontend y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run build`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente con `vmspect v0.4.2`.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_3.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_3.0.0_x64_en-US.msi`

---

# VM Inventory v2.3.1 - Actualización de vmspect

## 🚀 Resumen del lanzamiento

La versión de mantenimiento `v2.3.1` fija el motor estático `vmspect` en `v0.4.2`, sincroniza el versionado de Cargo, Tauri y npm, y conserva sin cambios el contrato funcional de VM Inventory.

### 🔧 Cambios

- **Motor actualizado:** `vmspect` pasa de `v0.4.1` a `v0.4.2` en la aplicación y el lockfile de Cargo.
- **Versionado sincronizado:** la aplicación se publica como `v2.3.1` en Cargo, Tauri, npm, README y los artefactos Windows.
- **Compatibilidad:** no se introducen cambios rompientes ni nuevas interfaces públicas.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_2.3.1_x64-setup.exe` | 2,846,223 bytes | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_2.3.1_x64_en-US.msi` | 4,251,648 bytes | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v2.3.1.tar.gz` / `v2.3.1.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_2.3.1_x64-setup.exe` | `da4e693ed047e7ea9c616fbf23d122fd8fece23e1feca1bdc8ab1021089369a9` |
| `VM Inventory_2.3.1_x64_en-US.msi` | `6e28848551222ef78bfe3e73675d2ef1ae3c8754f79bfc186aeb19a40359bc1a` |

Para verificar un archivo descargado desde PowerShell:

```powershell
Get-FileHash -Path ".\VM Inventory_2.3.1_x64-setup.exe" -Algorithm SHA256
Get-FileHash -Path ".\VM Inventory_2.3.1_x64_en-US.msi" -Algorithm SHA256
```

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 7 contratos frontend y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente con `vmspect v0.4.2`.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_2.3.1_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_2.3.1_x64_en-US.msi`

---

# VM Inventory v2.3.0 - Descubrimiento y concurrencia con vmspect

## 🚀 Resumen del lanzamiento

La versión menor `v2.3.0` delega el descubrimiento recursivo, la concurrencia, la inspección y la cancelación en la API pública de `vmspect`, conservando el contrato de inventario JSON, la clasificación y la supervisión Tauri. No se introduce una ruptura confirmada en la interfaz pública de la aplicación.

### 🌟 Principales mejoras y novedades

- **Descubrimiento único:** `vmspect::list_vms` recorre el origen recursivamente y filtra extents secundarios sin mantener un segundo walker en la aplicación.
- **Procesamiento concurrente:** `vmspect::ConcurrentProcessor` y `InspectionEngine` coordinan workers, resultados por imagen y cancelación compartida.
- **Telemetría integrada:** Los eventos de progreso y la duración de cada inspección se traducen al contrato de supervisión existente.
- **Tolerancia a fallos:** Un error de una imagen se conserva como observación en el inventario sin descartar el resto del lote.
- **Compatibilidad funcional:** Las exclusiones configurables, la clasificación de programas, las discrepancias y la persistencia JSON siguen gestionándose desde VM Inventory.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_2.3.0_x64-setup.exe` | 2,846,961 bytes (2.72 MiB) | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_2.3.0_x64_en-US.msi` | 4,251,648 bytes (4.05 MiB) | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v2.3.0.tar.gz` / `v2.3.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_2.3.0_x64-setup.exe` | `dbb8d1b39a379a27186cbceafe54bf2f89166a1ca779b924e64694eec8eb1fdb` |
| `VM Inventory_2.3.0_x64_en-US.msi` | `dae4b7a21cf1f8633330141ecf333bdc0c50a4d010e44d004af530546e907bae` |

Para verificar un archivo descargado desde PowerShell:

```powershell
Get-FileHash -Path ".\VM Inventory_2.3.0_x64-setup.exe" -Algorithm SHA256
Get-FileHash -Path ".\VM Inventory_2.3.0_x64_en-US.msi" -Algorithm SHA256
```

## ✅ Verificación del release

- `npm run typecheck`
- `npm test`: 7 contratos frontend y 4 contratos backend aprobados.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `npm run tauri build`: bundles NSIS y MSI Windows x64 generados correctamente.

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_2.3.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_2.3.0_x64_en-US.msi`

---

# VM Inventory v2.2.0 - Frontend TypeScript y contratos backend

## 🚀 Resumen del lanzamiento

La versión menor `v2.2.0` incorpora una frontera frontend/backend tipada, reorganiza la integración con `vmspect` y añade contratos automatizados para validar la aplicación sin depender de una máquina virtual real. El alcance no introduce una ruptura confirmada en la interfaz de usuario pública; los comandos Tauri internos se mantienen centralizados en la API del frontend.

### 🌟 Principales mejoras y novedades

#### 1. Frontend TypeScript
- **Migración modular:** El frontend pasa de módulos JavaScript aislados a `main.ts`, `ui.ts`, `theme.ts` y `types.ts`.
- **Contratos IPC tipados:** La API de invocación Tauri centraliza relevamiento, consulta, inspección, diagnóstico, validación de QEMU y controles de ventana.
- **Configuración robusta:** Se normalizan límites de workers, rutas, nombre de salida y preferencias persistidas del Analizador y Consultor.
- **Versión consistente:** La interfaz usa la versión declarada en `src-tauri/Cargo.toml`, con fallback de Vite y confirmación desde `CARGO_PKG_VERSION`.

#### 2. Backend y motor `vmspect`
- **Integración desacoplada:** La construcción de opciones, resolución de `qemu-nbd` e inspección se concentran en `src-tauri/src/vmspect_backend.rs`.
- **Runtime Tauri:** Las tareas bloqueantes usan `tauri::async_runtime::spawn_blocking`, evitando una dependencia de runtime duplicada.
- **Cancelación compartida:** La bandera atómica se entrega al motor para detener relevamientos e inspecciones de forma consistente.
- **Cierre seguro:** El comando de cierre utiliza la ventana Tauri en lugar de terminar el proceso directamente.

#### 3. Herramientas y experiencia de usuario
- **Analizador, Consultor y Reporte:** Las tres herramientas comparten una API y estado tipados, con selección de carpetas/archivos y control de operaciones concurrentes.
- **Inspector simplificado:** Se conserva la presentación de metadatos, particiones, software y progreso directo en una interfaz más compacta.
- **Estilos consolidados:** La aplicación utiliza la hoja principal `src/styles/app.css`.

#### 4. Verificación automatizada
- **Frontend:** `npm run typecheck` y 7 pruebas de contrato con `tsx`.
- **Backend:** 4 pruebas de contrato Rust para reglas, filtros, cancelación y lectura de reportes JSON sintéticos.
- **Producción:** Build Vite y empaquetado Tauri Windows x64 verificados antes del release.

## 📦 Artefactos de descarga

| Plataforma | Artefacto | Tamaño aproximado | Descripción |
| :--- | :--- | ---: | :--- |
| **Windows x64** | `VM Inventory_2.2.0_x64-setup.exe` | 2.8 MiB | Instalador NSIS estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_2.2.0_x64_en-US.msi` | 4.1 MiB | Paquete MSI para despliegue empresarial |
| **Código fuente** | `v2.2.0.tar.gz` / `v2.2.0.zip` | — | Generados automáticamente por GitHub al publicar el tag |

## 🔒 Integridad SHA-256

Hashes calculados sobre los instaladores generados por `npm run tauri build`:

| Artefacto | SHA-256 |
| :--- | :--- |
| `VM Inventory_2.2.0_x64-setup.exe` | `75fa071cade563d9c9375ab78e06548b17b7a84b5a6c7f6754406c7fa967b8fb` |
| `VM Inventory_2.2.0_x64_en-US.msi` | `bbde1a72537823d90e62135d4877aaaad69ace552754e81aef98d8163119e441` |

Para verificar un archivo descargado desde PowerShell:

```powershell
Get-FileHash -Path ".\VM Inventory_2.2.0_x64-setup.exe" -Algorithm SHA256
Get-FileHash -Path ".\VM Inventory_2.2.0_x64_en-US.msi" -Algorithm SHA256
```

## 📋 Construcción reproducible

```bash
npm install
npm run typecheck
npm test
npm run tauri build
```

Los instaladores se generan en:

- `src-tauri/target/release/bundle/nsis/VM Inventory_2.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_2.2.0_x64_en-US.msi`
