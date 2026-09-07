import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extraerInfoDisco, escapeHtml, truncarTexto, formatearBytes } from '../../src/js/utils.js';

describe('Utilidades (utils.js)', () => {
  describe('extraerInfoDisco', () => {
    it('debe identificar unidades de disco locales en Windows (C:\\)', () => {
      const res = extraerInfoDisco('C:\\VMs\\Windows10\\Win10.vmx');
      assert.equal(res.disco, 'Disco C:');
      assert.equal(res.ubicacion, 'C:\\VMs\\Windows10\\Win10.vmx');
    });

    it('debe identificar unidades con barra inclinada en Windows (D:/)', () => {
      const res = extraerInfoDisco('D:/VirtualMachines/Linux/disk.vmdk');
      assert.equal(res.disco, 'Disco D:');
      assert.equal(res.ubicacion, 'D:/VirtualMachines/Linux/disk.vmdk');
    });

    it('debe identificar rutas de red UNC en Windows (\\\\Servidor\\Share)', () => {
      const res = extraerInfoDisco('\\\\NasStorage\\VMs\\Ubuntu\\Ubuntu.vmx');
      assert.equal(res.disco, 'Red \\\\NasStorage');
      assert.equal(res.ubicacion, '\\\\NasStorage\\VMs\\Ubuntu\\Ubuntu.vmx');
    });

    it('debe identificar puntos de montaje Unix (/mnt/..., /media/..., /Volumes/...)', () => {
      const resMnt = extraerInfoDisco('/mnt/data/vms/debian.qcow2');
      assert.equal(resMnt.disco, '/mnt/data');
      assert.equal(resMnt.ubicacion, '/mnt/data/vms/debian.qcow2');

      const resMedia = extraerInfoDisco('/media/usb/backup/vm.vdi');
      assert.equal(resMedia.disco, '/media/usb');

      const resVol = extraerInfoDisco('/Volumes/MacHD/VMs/MacOS.vmdk');
      assert.equal(resVol.disco, '/Volumes/MacHD');
    });

    it('debe manejar rutas vacías o nulas retornando fallback seguro', () => {
      assert.deepEqual(extraerInfoDisco(''), { disco: 'Unidad Local', ubicacion: '' });
      assert.deepEqual(extraerInfoDisco(null), { disco: 'Unidad Local', ubicacion: '' });
      assert.deepEqual(extraerInfoDisco(undefined), { disco: 'Unidad Local', ubicacion: '' });
    });
  });

  describe('escapeHtml', () => {
    it('debe escapar caracteres especiales HTML para prevenir XSS', () => {
      const input = '<script>alert("xss" & \'hack\')</script>';
      const expected = '&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;hack&#039;)&lt;/script&gt;';
      assert.equal(escapeHtml(input), expected);
    });

    it('debe manejar null, undefined y tipos no-string', () => {
      assert.equal(escapeHtml(null), '');
      assert.equal(escapeHtml(undefined), '');
      assert.equal(escapeHtml(12345), '12345');
      assert.equal(escapeHtml(true), 'true');
    });
  });

  describe('truncarTexto', () => {
    it('debe truncar texto que excede la longitud especificada agregando elipsis', () => {
      const str = 'Microsoft SQL Server 2019 Developer Edition';
      assert.equal(truncarTexto(str, 25), 'Microsoft SQL Server 201…');
    });

    it('no debe truncar texto menor o igual al límite', () => {
      const str = 'PostgreSQL';
      assert.equal(truncarTexto(str, 20), 'PostgreSQL');
    });

    it('debe manejar cadenas vacías o nulas', () => {
      assert.equal(truncarTexto('', 10), '');
      assert.equal(truncarTexto(null, 10), '');
    });
  });

  describe('formatearBytes', () => {
    it('debe formatear cero y valores negativos o inválidos como "0 B"', () => {
      assert.equal(formatearBytes(0), '0 B');
      assert.equal(formatearBytes(-500), '0 B');
      assert.equal(formatearBytes('invalido'), '0 B');
      assert.equal(formatearBytes(null), '0 B');
    });

    it('debe formatear bytes simples sin decimales', () => {
      assert.equal(formatearBytes(512), '512 B');
    });

    it('debe formatear KB, MB, GB, TB con decimales por defecto (2)', () => {
      assert.equal(formatearBytes(1024), '1.00 KB');
      assert.equal(formatearBytes(1048576), '1.00 MB');
      assert.equal(formatearBytes(1073741824), '1.00 GB');
      assert.equal(formatearBytes(1099511627776), '1.00 TB');
      assert.equal(formatearBytes(53687091200), '50.00 GB');
    });

    it('debe respetar la cantidad de decimales configurada', () => {
      assert.equal(formatearBytes(1572864, 1), '1.5 MB');
      assert.equal(formatearBytes(1572864, 0), '2 MB');
    });
  });
});
