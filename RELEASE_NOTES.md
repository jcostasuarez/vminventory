# VM Inventory v2.1.0 - Módulo Consultor, Inspección y UX

## 🚀 Resumen del Lanzamiento

Esta versión menor (`v2.1.0`) introduce el nuevo módulo **Consultor** en el backend, mejoras sustanciales de filtrado y visualización en el panel de consulta, nuevas insignias de versión/editor en el inspector, y un rediseño de filtros más simple y potente.

### 🌟 Principales Mejoras y Novedades

#### 1. Backend: Nuevo Módulo `consultor`
- **Extracción del motor de consultas:** Se separa la lógica de sugerencias y consulta de software en un módulo Rust dedicado (`consultor.rs`), desacoplado de los comandos Tauri. Refactor interno sin cambios en la interfaz de comandos.
- **Sugerencias aisladas por aplicación y versión:** El motor ahora aísla las sugerencias por app/versión, evitando mezclar candidatos de distintas versiones.
- **Cobertura de pruebas:** Tests end-to-end del ciclo completo de consulta de software y de aislamiento de sugerencias por versión.

#### 2. Consultor: Filtrado y Búsqueda Mejorados
- **Búsqueda por editor:** El filtro de programa/aplicación ahora también coincide contra el editor del software.
- **Normalización de guiones bajos y espacios:** La búsqueda es tolerante a `_` y espacios (`SQL_Server` ⇄ `SQL Server`).
- **Deducción de entidad desde el reporte:** Cuando una VM no tiene propietario/elemento asignado, se infiere la entidad (Persona, Disco o Servidor) a partir del nombre del archivo JSON del reporte.
- **Alias de sistema operativo:** El filtro reconoce `windows`/`win` y `linux`/`lin`.
- **Filtros consolidados:** El panel de filtros ahora usa un selector único **Tipo / Ubicación** (Personas, Discos, Servidores) junto a **Asignado / Elemento**, simplificando la experiencia de consulta.

#### 3. Grafo de Dependencias
- **Agrupación por programa y versión:** Cada versión de una aplicación tiene su propia tarjeta en el diagrama, mostrando la versión y el total de VM(s) asociadas.

#### 4. Inspector y Design System
- **Insignias de versión y editor:** Se muestran de forma destacada en la tabla del inspector.
- **Nuevo design system:** Se incorpora la hoja de estilos `shadcn.css` para una apariencia más moderna y consistente.

---

## 📦 Enlaces de Descarga de Artefactos

| Plataforma | Artefacto | Descripción |
| :--- | :--- | :--- |
| **Windows x64** | `VM.Inventory_2.1.0_x64-setup.exe` | Instalador ejecutable estándar para Windows 10/11 |
| **Windows x64** | `VM.Inventory_2.1.0_x64_en-US.msi` | Paquete de instalación MSI empresarial |
| **Código Fuente** | `v2.1.0.tar.gz` / `v2.1.0.zip` | Código fuente del release |

---

## 🔒 Verificación de Integridad (SHA-256 Checksums)

Para verificar la autenticidad y verificar que el archivo descargado no ha sido alterado, ejecuta el siguiente comando en **PowerShell**:

### Comando de verificación rápida:
```powershell
Get-FileHash -Path ".\VM.Inventory_2.1.0_x64-setup.exe" -Algorithm SHA256 | Format-List
```

### Script de validación automatizada contra lista de hashes:
```powershell
$ExpectedHashes = @{
    "VM.Inventory_2.1.0_x64-setup.exe" = "95c159c7344a1ec5299f25a6b4d5c719ccff07412917ab4a25ccb3980a7b8220"
    "VM.Inventory_2.1.0_x64_en-US.msi" = "d8c214228e8a66d4c50c90d119a904625bed55e12fc0830f496c098656ca3382"
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
- `src-tauri/target/release/bundle/nsis/VM Inventory_2.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/VM Inventory_2.1.0_x64_en-US.msi`
