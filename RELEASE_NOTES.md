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
