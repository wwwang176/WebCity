import { createSignal, Show } from 'solid-js';
import { Modal } from './Modal';
import { SummaryPage } from './overview/SummaryPage';
import { DemographicsPage } from './overview/DemographicsPage';
import { EconomyPage } from './overview/EconomyPage';
import { ServicesPage } from './overview/ServicesPage';
import { InfraPage } from './overview/InfraPage';
import { EnvironmentPage } from './overview/EnvironmentPage';
import { TrafficPage } from './overview/TrafficPage';
import { FreightPage } from './overview/FreightPage';

const NAV_ITEMS = [
  { id: 'summary', label: 'Summary', icon: '\uD83D\uDCCA' },
  { id: 'demographics', label: 'Demographics', icon: '\uD83D\uDC65' },
  { id: 'economy', label: 'Economy', icon: '$' },
  { id: 'services', label: 'Services', icon: '\uD83C\uDFDB' },
  { id: 'infrastructure', label: 'Infrastructure', icon: '\u26A1' },
  { id: 'freight', label: 'Freight', icon: '\uD83D\uDCE6' },
  { id: 'environment', label: 'Environment', icon: '\uD83C\uDF3F' },
  { id: 'traffic', label: 'Traffic', icon: '\uD83D\uDE97' },
] as const;

type PageId = (typeof NAV_ITEMS)[number]['id'];

export function OverviewModal(props: { open: boolean; onClose: () => void }) {
  const [activePage, setActivePage] = createSignal<PageId>('summary');

  return (
    <Modal id="overview-modal" title={'\uD83C\uDFD9 City Overview'} open={props.open} onClose={props.onClose}>
      <div class="overview-layout">
        <nav class="overview-sidebar">
          {NAV_ITEMS.map(item => (
            <button
              class="overview-nav-item"
              classList={{ active: activePage() === item.id }}
              onClick={() => setActivePage(item.id)}
            >
              <span class="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div class="overview-content">
          <Show when={activePage() === 'summary'}><SummaryPage /></Show>
          <Show when={activePage() === 'demographics'}><DemographicsPage /></Show>
          <Show when={activePage() === 'economy'}><EconomyPage open={props.open} /></Show>
          <Show when={activePage() === 'services'}><ServicesPage /></Show>
          <Show when={activePage() === 'infrastructure'}><InfraPage /></Show>
          <Show when={activePage() === 'freight'}><FreightPage /></Show>
          <Show when={activePage() === 'environment'}><EnvironmentPage /></Show>
          <Show when={activePage() === 'traffic'}><TrafficPage /></Show>
        </div>
      </div>
    </Modal>
  );
}
