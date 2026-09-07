import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { CardsView } from '../../src/js/cards-view.js';

describe('Vista de Tarjetas (cards-view.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  const mockCoincidencia = {
    nombre_programa: 'Microsoft SQL Server 2019',
    version: '15.0.2000',
    editor: 'Microsoft Corporation',
    categoria: 'Bases de datos',
    tags: ['sql', 'rdbms'],
    nombre_vm: 'SRV-SQL-PROD',
    nombre_interno: 'SRV-SQL-INTERNAL',
    ruta_carpeta: 'D:\\Servidores\\SRV-SQL-PROD',
    propietario: 'Infraestructura',
    tipo_posesion: 'Servidores',
    elemento_asignado: 'Cluster-A',
    sistema_operativo: 'Windows Server 2022',
    peso_gb: 40.0,
    hipervisor: 'VMware',
    archivo_json: 'reporte1.json',
    fecha_relevamiento: '2026-09-07'
  };

  it('debe limpiar el contenedor cuando se recibe una lista vacía', () => {
    const container = new MockElement('div');
    container.innerHTML = '<span>Previo</span>';
    const cardsView = new CardsView(container);

    cardsView.render([]);
    assert.equal(container.children.length, 0);
  });

  it('debe renderizar los datos y badges de la tarjeta correctamente', () => {
    const container = new MockElement('div');
    const cardsView = new CardsView(container);

    cardsView.render([mockCoincidencia]);

    assert.equal(container.children.length, 1);
    const cardHtml = container.children[0].innerHTML;

    assert.ok(cardHtml.includes('Microsoft SQL Server 2019'));
    assert.ok(cardHtml.includes('v15.0.2000'));
    assert.ok(cardHtml.includes('Bases de datos'));
    assert.ok(cardHtml.includes('#sql'));
    assert.ok(cardHtml.includes('SRV-SQL-PROD'));
    assert.ok(cardHtml.includes('SRV-SQL-INTERNAL'));
    assert.ok(cardHtml.includes('Windows Server 2022'));
    assert.ok(cardHtml.includes('badge-servidor'));
    assert.ok(cardHtml.includes('Disco D:'));
  });

  it('debe manejar tipos de posesión de Personas y Discos adecuadamente', () => {
    const container = new MockElement('div');
    const cardsView = new CardsView(container);

    const personaItem = {
      ...mockCoincidencia,
      tipo_posesion: 'Personas',
      elemento_asignado: 'Juan Perez',
      ruta_carpeta: 'C:\\Users\\Juan\\VM'
    };

    const discoItem = {
      ...mockCoincidencia,
      tipo_posesion: 'Discos',
      elemento_asignado: 'Disco_Backup_01',
      ruta_carpeta: 'E:\\Discos_Sueltos\\VM'
    };

    cardsView.render([personaItem, discoItem]);
    assert.equal(container.children.length, 2);

    assert.ok(container.children[0].innerHTML.includes('badge-persona'));
    assert.ok(container.children[1].innerHTML.includes('badge-disco'));
  });

  it('debe soportar paginación progresiva y delegación del botón Cargar más', () => {
    const container = new MockElement('div');
    const cardsView = new CardsView(container);

    const items = [];
    for (let i = 1; i <= 75; i++) {
      items.push({
        ...mockCoincidencia,
        nombre_programa: `App #${i}`,
        nombre_vm: `VM-${i}`
      });
    }

    cardsView.render(items);

    // Primer lote: 50 tarjetas + 1 footer de paginación
    assert.equal(cardsView.renderedCount, 50);

    const footer = container.querySelector('.cards-pagination-footer');
    assert.ok(footer, 'Debe renderizar el pie de paginación');
    assert.ok(footer.innerHTML.includes('25 restantes'));

    // Simulamos clic en "Cargar más"
    const btnCargar = footer.querySelector('.btn-cargar-mas-cards');
    assert.ok(btnCargar);
    btnCargar.click();

    // Ahora deben estar renderizadas todas las 75 tarjetas
    assert.equal(cardsView.renderedCount, 75);
  });

  it('debe invocar onAbrirUbicacion al hacer clic en el botón de abrir carpeta', () => {
    const container = new MockElement('div');
    const cardsView = new CardsView(container);

    let rutaAbierta = null;
    cardsView.render([mockCoincidencia], (ruta) => {
      rutaAbierta = ruta;
    });

    const btnAbrir = container.querySelector('.btn-abrir-ubicacion-vm');
    assert.ok(btnAbrir);
    btnAbrir.click();

    assert.equal(rutaAbierta, 'D:\\Servidores\\SRV-SQL-PROD');
  });
});
