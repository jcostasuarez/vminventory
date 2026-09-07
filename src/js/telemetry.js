/**
 * @file telemetry.js
 * @description Módulo de visualización de telemetría, progreso multihilo, bitácora y monitor de inspección interactivo en tiempo real.
 * @module js/telemetry
 */

/**
 * @typedef {Object} LogSupervision
 * @property {string} timestamp - Marca de tiempo con formato HH:MM:SS.
 * @property {'info'|'exito'|'advertencia'|'error'} nivel - Nivel de severidad del mensaje.
 * @property {string} mensaje - Descripción del evento registrado.
 * @property {string|null} [vm] - Nombre de la máquina virtual asociada, si aplica.
 */

/**
 * @typedef {Object} ProgresoActivoVM
 * @property {number} indice - Número ordinal de la VM.
 * @property {string} nombre_vm - Nombre de la carpeta de la VM.
 * @property {number} porcentaje - Progreso individual de 0 a 100.
 * @property {string} etapa - Etapa actual de inspección.
 * @property {string|null} [detalle] - Información complementaria.
 */

/**
 * @typedef {Object} EstadoSupervision
 * @property {string} fase - Fase actual del proceso ('inactivo', 'analizando_v_ms', etc.).
 * @property {number} total_vms - Cantidad total de VMs a procesar.
 * @property {number} hilos_configurados - Cantidad de workers configurados.
 * @property {number} [hilos_activos] - Workers actualmente en ejecución.
 * @property {ProgresoActivoVM[]} [vms_activas] - Lista de VMs procesándose en paralelo.
 * @property {number} vm_actual_indice - Índice de la última VM actualizada.
 * @property {string} vm_actual_nombre - Nombre de la última VM actualizada.
 * @property {number} progreso_vm_actual - Porcentaje de la VM actual.
 * @property {string} etapa_vm_actual - Etapa actual de la VM.
 * @property {string|null} detalle_vm_actual - Detalle adicional.
 * @property {number} progreso_global - Porcentaje unificado global (0 a 100).
 * @property {number} vms_procesadas - Cantidad de VMs finalizadas.
 * @property {number} vms_exitosas - Cantidad de VMs finalizadas con éxito.
 * @property {number} vms_con_observaciones - Cantidad de VMs con advertencias.
 * @property {number} vms_discrepantes - Cantidad de VMs con discrepancia de nombre.
 * @property {number} peso_total_procesado_gb - Volumen acumulado en GB.
 * @property {string} tiempo_transcurrido_formateado - Tiempo transcurrido en HH:MM:SS o MM:SS.
 * @property {string|null} tiempo_restante_formateado - Estimación de tiempo restante (ETA).
 * @property {number} velocidad_vms_minuto - Tasa de procesamiento calculada.
 * @property {string} mensaje_estado - Mensaje textual de estado general.
 * @property {LogSupervision[]} [logs_recientes] - Entradas de bitácora recientes.
 */

/**
 * Gestor de telemetría y visualizador gráfico del motor de análisis multihilo.
 */
export class TelemetryManager {
  /**
   * Inicializa el gestor de telemetría mapeando las referencias a los elementos DOM.
   * @param {Object} domElements - Mapeo de elementos DOM de la interfaz.
   */
  constructor(domElements) {
    this.badgeFase = domElements.badgeFase;
    this.lblBigPorcentaje = domElements.lblBigPorcentaje;
    this.lblProgresoMsg = domElements.lblProgresoMsg;
    this.barGlobal = domElements.barGlobal;

    this.statVms = domElements.statVms;
    this.statExitosas = domElements.statExitosas;
    this.statObservaciones = domElements.statObservaciones;
    this.statTiempo = domElements.statTiempo;
    this.itemEta = domElements.itemEta;
    this.statEta = domElements.statEta;
    this.statVelocidad = domElements.statVelocidad;

    this.wrapperWorkers = domElements.wrapperWorkers;
    this.listWorkers = domElements.listWorkers;

    this.wrapperVmIndividual = domElements.wrapperVmIndividual;
    this.lblVmIndividualTitulo = domElements.lblVmIndividualTitulo;
    this.lblVmIndividualPorcentaje = domElements.lblVmIndividualPorcentaje;
    this.barVmIndividual = domElements.barVmIndividual;
    this.lblVmIndividualEtapa = domElements.lblVmIndividualEtapa;

    this.wrapperBitacora = domElements.wrapperBitacora;
    this.logConsole = domElements.logConsole;

    // Elementos del HUD Visual Gráfico
    this.donutSegOk = domElements.donutSegOk;
    this.donutSegWarn = domElements.donutSegWarn;
    this.donutSegActive = domElements.donutSegActive;
    this.hudDonutCenterVal = domElements.hudDonutCenterVal;
    this.hudDonutCenterSub = domElements.hudDonutCenterSub;
    this.hudLegOk = domElements.hudLegOk;
    this.hudLegWarn = domElements.hudLegWarn;
    this.hudLegActive = domElements.hudLegActive;
    this.hudLegPending = domElements.hudLegPending;
    this.hudThroughputText = domElements.hudThroughputText;

    this.stageStepDesc = domElements.stageStepDesc;
    this.stageStepDisk = domElements.stageStepDisk;
    this.stageStepFs = domElements.stageStepFs;
    this.stageStepSoft = domElements.stageStepSoft;
    this.hudCanvasWorkersBadge = domElements.hudCanvasWorkersBadge;
    this.hudCanvasLabel = domElements.hudCanvasLabel;
    this.canvas = domElements.canvasTelemetryVisual;

    // Estado interno del visualizador
    this.ultimoEstado = null;
    this.animFrameId = null;
    this.canvasOffset = 0;
    this.canvasCtx = this.canvas ? this.canvas.getContext('2d') : null;

    if (this.canvas) {
      this.iniciarAnimacionCanvas();
    }
  }

  /**
   * Actualiza todos los componentes de la interfaz de telemetría con el estado recibido del backend.
   *
   * @param {EstadoSupervision} estado - Paquete de datos de telemetría emitido por Tauri IPC.
   * @param {Object} config - Configuración activa de la aplicación.
   * @returns {void}
   */
  actualizar(estado, config) {
    if (!estado) return;
    this.ultimoEstado = estado;

    const progreso = Number(estado.progreso_global) || 0;
    const clamped = Math.min(100, Math.max(0, progreso));

    if (this.lblBigPorcentaje) {
      this.lblBigPorcentaje.textContent = `${progreso.toFixed(1)}%`;
    }
    if (this.barGlobal) {
      this.barGlobal.style.width = `${clamped}%`;
      if (estado.fase === 'finalizado') {
        this.barGlobal.classList.add('finished');
      } else {
        this.barGlobal.classList.remove('finished');
      }
    }
    if (this.lblProgresoMsg) {
      this.lblProgresoMsg.textContent = estado.mensaje_estado || '';
    }

    if (this.statVms) {
      this.statVms.textContent = `${estado.vms_procesadas || 0} / ${estado.total_vms || 0}`;
    }
    if (this.statExitosas) {
      this.statExitosas.textContent = `✓ ${estado.vms_exitosas || 0} exitosas`;
    }

    const lblSinObs = document.getElementById('lblSinObservaciones');
    if (this.statObservaciones) {
      if (estado.vms_con_observaciones > 0) {
        this.statObservaciones.style.display = 'inline-flex';
        this.statObservaciones.textContent = `⚠ ${estado.vms_con_observaciones} con observaciones`;
        if (lblSinObs) lblSinObs.style.display = 'none';
      } else {
        this.statObservaciones.style.display = 'none';
        if (lblSinObs) lblSinObs.style.display = 'inline';
      }
    }

    if (this.statTiempo) {
      this.statTiempo.textContent = estado.tiempo_transcurrido_formateado || '00:00';
    }

    const lblTiempoSub = document.getElementById('lblTiempoSub');
    if (this.itemEta && this.statEta) {
      if (estado.tiempo_restante_formateado && estado.fase !== 'finalizado') {
        this.itemEta.style.display = 'inline-flex';
        this.statEta.textContent = `ETA: ${estado.tiempo_restante_formateado}`;
        if (lblTiempoSub) lblTiempoSub.style.display = 'none';
      } else {
        this.itemEta.style.display = 'none';
        if (lblTiempoSub) lblTiempoSub.style.display = 'inline';
      }
    }

    if (this.statVelocidad) {
      const vel = Number(estado.velocidad_vms_minuto) || 0;
      this.statVelocidad.textContent = `${vel.toFixed(1)} VM/min`;
    }

    this.renderBadgeFase(estado.fase);

    // Actualizar HUD Gráfico (Donut, Pipeline, Throughput)
    this.actualizarHudGrafico(estado);

    // Progreso individual de VM
    if (config?.mostrar_progreso_individual && this.wrapperVmIndividual) {
      if (estado.vm_actual_indice > 0 && estado.vm_actual_nombre) {
        this.wrapperVmIndividual.style.display = 'flex';
        if (this.lblVmIndividualTitulo) {
          this.lblVmIndividualTitulo.textContent = `[#${estado.vm_actual_indice}] ${estado.vm_actual_nombre}`;
        }
        if (this.lblVmIndividualPorcentaje) {
          this.lblVmIndividualPorcentaje.textContent = `${estado.progreso_vm_actual || 0}%`;
        }
        if (this.barVmIndividual) {
          this.barVmIndividual.style.width = `${estado.progreso_vm_actual || 0}%`;
        }
        if (this.lblVmIndividualEtapa) {
          const detalle = estado.detalle_vm_actual ? ` (${estado.detalle_vm_actual})` : '';
          this.lblVmIndividualEtapa.textContent = `${estado.etapa_vm_actual || ''}${detalle}`;
        }
      } else {
        if (this.barVmIndividual) this.barVmIndividual.style.width = '0%';
        if (this.lblVmIndividualPorcentaje) this.lblVmIndividualPorcentaje.textContent = '0%';
        if (this.lblVmIndividualEtapa) this.lblVmIndividualEtapa.textContent = 'En espera';
      }
    }

    // Workers concurrentes en ejecución
    if (this.wrapperWorkers && this.listWorkers) {
      if (estado.vms_activas && estado.vms_activas.length > 1) {
        this.wrapperWorkers.style.display = 'flex';
        this.listWorkers.innerHTML = '';
        estado.vms_activas.forEach(v => {
          const row = document.createElement('div');
          row.className = 'worker-row';
          row.innerHTML = `<span><strong>[#${v.indice}]</strong> ${v.nombre_vm} <span style="color:#64748b;">(${v.etapa})</span></span> <span class="worker-tag">${v.porcentaje}%</span>`;
          this.listWorkers.appendChild(row);
        });
      } else {
        this.wrapperWorkers.style.display = 'none';
      }
    }

    // Bitácora en vivo
    if (config?.habilitar_bitacora && estado.logs_recientes && estado.logs_recientes.length > 0) {
      this.renderLogs(estado.logs_recientes);
    }
  }

  /**
   * Actualiza el gráfico dinámico Donut SVG, las fases del pipeline y las leyendas en vivo.
   *
   * @param {EstadoSupervision} estado - Estado de supervisión.
   */
  actualizarHudGrafico(estado) {
    const total = Math.max(1, estado.total_vms || 0);
    const exitosas = estado.vms_exitosas || 0;
    const conObs = estado.vms_con_observaciones || 0;
    const activas = estado.vms_activas ? estado.vms_activas.length : (estado.fase === 'analizando_v_ms' ? 1 : 0);
    const terminadas = estado.vms_procesadas || 0;
    const pendientes = Math.max(0, (estado.total_vms || 0) - terminadas - activas);

    // Actualizar leyendas numéricas
    if (this.hudLegOk) this.hudLegOk.textContent = exitosas;
    if (this.hudLegWarn) this.hudLegWarn.textContent = conObs;
    if (this.hudLegActive) this.hudLegActive.textContent = activas;
    if (this.hudLegPending) this.hudLegPending.textContent = pendientes;

    // Actualizar centro del Donut
    if (this.hudDonutCenterVal) {
      this.hudDonutCenterVal.textContent = `${terminadas}/${estado.total_vms || 0}`;
    }
    if (this.hudDonutCenterSub) {
      if (estado.fase === 'finalizado') {
        this.hudDonutCenterSub.textContent = 'Completado';
      } else if (estado.fase === 'analizando_v_ms') {
        this.hudDonutCenterSub.textContent = `En curso (${Math.round(estado.progreso_global || 0)}%)`;
      } else {
        this.hudDonutCenterSub.textContent = 'En espera';
      }
    }

    // Actualizar throughput / velocidad
    if (this.hudThroughputText) {
      const gb = Number(estado.peso_total_procesado_gb) || 0;
      const hilos = estado.hilos_activos || estado.hilos_configurados || 1;
      if (gb > 0) {
        this.hudThroughputText.textContent = `${gb.toFixed(1)} GB procesados`;
      } else if (estado.fase === 'analizando_v_ms') {
        this.hudThroughputText.textContent = `${hilos} hilos activos`;
      } else {
        this.hudThroughputText.textContent = 'En espera';
      }
    }

    // Calcular arcos del Donut SVG (Circunferencia: 2 * PI * 38 ≈ 238.76)
    const C = 238.76;
    const pctOk = exitosas / total;
    const pctWarn = conObs / total;
    const pctActive = activas / total;

    const lenOk = pctOk * C;
    const lenWarn = pctWarn * C;
    const lenActive = pctActive * C;

    if (this.donutSegOk) {
      this.donutSegOk.setAttribute('stroke-dasharray', `${lenOk.toFixed(2)} ${(C - lenOk).toFixed(2)}`);
      this.donutSegOk.setAttribute('stroke-dashoffset', '0');
    }

    if (this.donutSegWarn) {
      this.donutSegWarn.setAttribute('stroke-dasharray', `${lenWarn.toFixed(2)} ${(C - lenWarn).toFixed(2)}`);
      this.donutSegWarn.setAttribute('stroke-dashoffset', `${(-lenOk).toFixed(2)}`);
    }

    if (this.donutSegActive) {
      this.donutSegActive.setAttribute('stroke-dasharray', `${lenActive.toFixed(2)} ${(C - lenActive).toFixed(2)}`);
      this.donutSegActive.setAttribute('stroke-dashoffset', `${(-(lenOk + lenWarn)).toFixed(2)}`);
    }

    // Resaltar etapas del pipeline de inspección
    this.actualizarEtapasPipeline(estado);

    // Actualizar badge de workers en canvas
    if (this.hudCanvasWorkersBadge) {
      const hilos = estado.hilos_activos || estado.hilos_configurados || 4;
      this.hudCanvasWorkersBadge.textContent = `${hilos} workers`;
    }
  }

  /**
   * Resalta visualmente la etapa actual del pipeline de inspección.
   *
   * @param {EstadoSupervision} estado - Estado de supervisión.
   */
  actualizarEtapasPipeline(estado) {
    const etapa = (estado.etapa_vm_actual || '').toLowerCase();
    const fase = estado.fase;

    const steps = [this.stageStepDesc, this.stageStepDisk, this.stageStepFs, this.stageStepSoft];
    steps.forEach(s => {
      if (s) {
        s.classList.remove('active', 'completed');
      }
    });

    if (fase === 'finalizado') {
      steps.forEach(s => { if (s) s.classList.add('completed'); });
      return;
    }

    if (fase === 'escaneando_directorio' || etapa.includes('descriptor') || etapa.includes('vmx') || etapa.includes('vbox')) {
      if (this.stageStepDesc) this.stageStepDesc.classList.add('active');
    } else if (etapa.includes('disco') || etapa.includes('particion') || etapa.includes('mbr') || etapa.includes('gpt') || etapa.includes('vmdk') || etapa.includes('vdi')) {
      if (this.stageStepDesc) this.stageStepDesc.classList.add('completed');
      if (this.stageStepDisk) this.stageStepDisk.classList.add('active');
    } else if (etapa.includes('fs') || etapa.includes('filesystem') || etapa.includes('ntfs') || etapa.includes('ext4') || etapa.includes('sistema de archivos')) {
      if (this.stageStepDesc) this.stageStepDesc.classList.add('completed');
      if (this.stageStepDisk) this.stageStepDisk.classList.add('completed');
      if (this.stageStepFs) this.stageStepFs.classList.add('active');
    } else if (etapa.includes('soft') || etapa.includes('registro') || etapa.includes('software') || etapa.includes('system') || fase === 'generando_reporte') {
      if (this.stageStepDesc) this.stageStepDesc.classList.add('completed');
      if (this.stageStepDisk) this.stageStepDisk.classList.add('completed');
      if (this.stageStepFs) this.stageStepFs.classList.add('completed');
      if (this.stageStepSoft) this.stageStepSoft.classList.add('active');
    }
  }

  /**
   * Inicia el bucle de animación interactiva del osciloscopio en Canvas.
   */
  iniciarAnimacionCanvas() {
    const loop = () => {
      this.dibujarCanvasTelemetry();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Renderiza el espectro de actividad, ondas de escaneo y ecualizador de hilos.
   */
  dibujarCanvasTelemetry() {
    if (!this.canvas || !this.canvasCtx) return;
    const ctx = this.canvasCtx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Limpiar canvas con fondo oscuro técnico de monitor
    ctx.fillStyle = '#080f1d';
    ctx.fillRect(0, 0, width, height);

    // Dibujar cuadrícula tenue de radar
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x += 32) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += 18) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    const estado = this.ultimoEstado;
    const enEjecucion = estado && (estado.fase === 'analizando_v_ms' || estado.fase === 'escaneando_directorio' || estado.fase === 'iniciando' || estado.fase === 'generando_reporte');
    const finalizado = estado && estado.fase === 'finalizado';

    this.canvasOffset += enEjecucion ? 0.07 : 0.015;

    // Línea central / Osciloscopio de inspección técnica
    const numPuntos = 140;
    const step = (width - 120) / numPuntos;
    const midY = Math.floor(height / 2);

    // 1. Onda primaria de lectura de bloques (Cyan de alta definición)
    ctx.beginPath();
    ctx.strokeStyle = enEjecucion ? '#38bdf8' : (finalizado ? '#10b981' : '#475569');
    ctx.lineWidth = 2;
    ctx.shadowBlur = enEjecucion ? 8 : 0;
    ctx.shadowColor = '#38bdf8';

    for (let i = 0; i <= numPuntos; i++) {
      const x = i * step;
      let y = midY;
      if (enEjecucion) {
        const velMod = Math.max(0.6, Math.min(3, (estado?.velocidad_vms_minuto || 1) / 2));
        const amp1 = 12 * Math.sin(i * 0.14 + this.canvasOffset * 2 * velMod);
        const amp2 = 7 * Math.cos(i * 0.28 - this.canvasOffset * 1.6);
        const noise = (Math.sin(i * 1.3 + this.canvasOffset * 3.5) > 0.65) ? (Math.random() * 8 - 4) : 0;
        y = midY + amp1 + amp2 + noise;
      } else if (finalizado) {
        y = midY + 3 * Math.sin(i * 0.08 + this.canvasOffset);
      }
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 2. Onda secundaria de armónicos y sincronización (Ámbar / Naranja)
    if (enEjecucion) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.55)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i <= numPuntos; i++) {
        const x = i * step;
        const amp = 6 * Math.sin(i * 0.2 - this.canvasOffset * 1.3);
        const y = midY + amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 3. Ecualizador de actividad por worker en el extremo derecho
    const hilos = Math.min(16, Math.max(1, estado?.hilos_activos || estado?.hilos_configurados || 4));
    const eqWidth = 90;
    const startX = width - eqWidth - 12;
    const barW = Math.max(3, Math.floor((eqWidth - hilos * 3) / hilos));

    for (let h = 0; h < hilos; h++) {
      const bx = startX + h * (barW + 3);
      let barH = 6;
      if (enEjecucion) {
        const vmProg = estado?.vms_activas?.[h]?.porcentaje || ((estado?.progreso_vm_actual || 25) + h * 12) % 100;
        barH = Math.max(6, Math.min(height - 16, (vmProg / 100) * (height - 20) + Math.sin(this.canvasOffset * 3.2 + h) * 6));
      } else if (finalizado) {
        barH = height - 20;
      }

      ctx.fillStyle = enEjecucion
        ? (h % 2 === 0 ? '#0284c7' : '#38bdf8')
        : (finalizado ? '#10b981' : '#334155');
      ctx.fillRect(bx, height - barH - 6, barW, barH);
    }
  }

  /**
   * Actualiza el badge visual de fase del proceso.
   *
   * @param {string} fase - Identificador de fase recibido del supervisor.
   * @returns {void}
   */
  renderBadgeFase(fase) {
    if (!this.badgeFase) return;
    const mapa = {
      'inactivo': { text: 'Inactivo', cls: 'idle' },
      'iniciando': { text: 'Iniciando...', cls: 'running' },
      'escaneando_directorio': { text: 'Escaneando...', cls: 'running' },
      'analizando_v_ms': { text: 'Analizando...', cls: 'running' },
      'generando_reporte': { text: 'Consolidando...', cls: 'running' },
      'finalizado': { text: 'Finalizado', cls: 'finished' },
      'cancelado': { text: 'Cancelado', cls: 'cancelled' },
      'error': { text: 'Error', cls: 'error' }
    };
    const info = mapa[fase] || { text: fase, cls: 'idle' };
    this.badgeFase.className = `status-badge ${info.cls}`;
    this.badgeFase.textContent = info.text;
  }

  /**
   * Renderiza las entradas en la terminal virtual de bitácora.
   *
   * @param {LogSupervision[]} logs - Colección cronológica de registros.
   * @returns {void}
   */
  renderLogs(logs) {
    if (!this.logConsole) return;
    this.logConsole.innerHTML = '';
    logs.forEach(l => {
      const row = document.createElement('div');
      row.className = 'log-item';

      let tagCls = 'log-info';
      let tagText = 'INFO';
      if (l.nivel === 'exito') { tagCls = 'log-ok'; tagText = 'OK'; }
      if (l.nivel === 'advertencia') { tagCls = 'log-warn'; tagText = 'WARN'; }
      if (l.nivel === 'error') { tagCls = 'log-err'; tagText = 'ERR'; }

      const vmStr = l.vm ? ` [${l.vm}]` : '';
      row.innerHTML = `<span class="log-time">[${l.timestamp}]</span> <span class="${tagCls}">[${tagText}]</span>${vmStr} <span>${l.mensaje}</span>`;
      this.logConsole.appendChild(row);
    });
    this.logConsole.scrollTop = this.logConsole.scrollHeight;
  }
}
