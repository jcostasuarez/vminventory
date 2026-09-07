# VM Inventory v2.0.0 - Engine & UI Refactor

## 🚀 Resumen del Lanzamiento

Esta versión mayor (`v2.0.0`) introduce una refactorización arquitectónica completa del motor de inspección estática **`vmspect`** y significativas optimizaciones en la experiencia de usuario y telemetría de **VM Inventory**.

### 🌟 Principales Mejoras y Novedades

#### 1. Motor de Inspección `vmspect` y Backend `qemu-nbd`
- **Migración 100% a `qemu-nbd`:** Eliminación total de dependencias, constantes y validaciones de `qemu-img`. Todo el pipeline de montaje de almacenamiento virtual opera ahora a través de NBD de alto rendimiento.
- **Resolución Automática en Windows:** Detección predeterminada y comprobación prioritaria del ejecutable en `C:\Program Files\qemu\qemu-nbd.exe`, con fallback a `C:\Program Files (x86)\qemu\qemu-nbd.exe`, variable de entorno `QEMU_NBD` y `PATH`.
- **Validación del Binario:** Ejecución silenciosa de `qemu-nbd.exe --version` con flags de supresión de ventana en Windows (`CREATE_NO_WINDOW`) y timeout estricto.
- **Optimización de I/O y Timeouts (5s):** Aislamiento de lecturas en hilos con timeout de 5 segundos para evitar bloqueos por volúmenes inalcanzables o colmenas de registro inaccesibles (`Windows\System32\config`) durante escaneos masivos.

#### 2. Experiencia de Usuario (UI/UX) y Telemetría
- **Cronómetro Autónomo (1s):** Temporizador desacoplado de la frecuencia de emisión del backend, actualizando la métrica de tiempo transcurrido estrictamente cada 1000 ms.
- **Barra de Progreso Continuo:** Animaciones con aceleración por hardware y transición suave (`transition: width 0.5s ease-in-out`) en todas las barras de progreso global, por VM y del inspector forense.
- **Sincronización Inteligente de Drift:** Detección de desfase temporal y corrección automática sin saltos visuales abruptos.

---

## 📦 Enlaces de Descarga de Artefactos

| Plataforma | Artefacto | Descripción |
| :--- | :--- | :--- |
| **Windows x64** | `VM Inventory_2.0.0_x64-setup.exe` | Instalador ejecutable estándar para Windows 10/11 |
| **Windows x64** | `VM Inventory_2.0.0_x64_en-US.msi` | Paquete de instalación MSI empresarial |
| **Código Fuente** | `v2.0.0.tar.gz` / `v2.0.0.zip` | Código fuente del release |

---

## 🔒 Verificación de Integridad (SHA-256 Checksums)

Para verificar la autenticidad y verificar que el archivo descargado no ha sido alterado, ejecuta el siguiente comando en **PowerShell**:

### Comando de verificación rápida:
```powershell
Get-FileHash -Path ".\VM Inventory_2.0.0_x64-setup.exe" -Algorithm SHA256 | Format-List
```

### Script de validación automatizada contra lista de hashes:
```powershell
$ExpectedHashes = @{
    "VM Inventory_2.0.0_x64-setup.exe" = "d1bfe3cda487a6cff59fc0f7e91b6edf93807c1e6062a5fcdada244b49896d99"
    "VM Inventory_2.0.0_x64_en-US.msi" = "5d29c678ab42e4e01b23676adc3c3a83165a30877e58b1b1b7d765923c661737"
}

foreach ($File in $ExpectedHashes.Keys) {
    if (Test-Path $File) {
        $Actual = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
        $Expected = $ExpectedHashes[$File].ToLower()
        if ($Actual -eq $Expected) {
            Write-Host "[OK] $File coincide con el checksum SHA-256." -ForegroundColor Green
        } else {
            Write-Host "[ERROR] $File NO coincide con el checksum esperado!" -ForegroundColor Red
        }
    } else {
        Write-Host "[SKIP] $File no encontrado en el directorio actual." -ForegroundColor Yellow
    }
}
```

---

## 📋 Instrucciones de Empaquetado y Distribución

Para compilar y empaquetar los instaladores de distribución autónomos:

```bash
# 1. Asegurar dependencias de Node.js y compilar frontend
npm install
npm run build

# 2. Generar instaladores MSI y EXE de producción con Tauri v2
npm run tauri build
```

Los instaladores resultantes se ubicarán en:
- `src-tauri/target/release/bundle/nsis/VM Inventory_2.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_2.0.0_x64_en-US.msi`
