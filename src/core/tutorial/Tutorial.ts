export interface TutorialStep {
  title: string;
  description: string;
  highlight?: string; // CSS selector to highlight
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to WebCity!',
    description: 'Build and manage your own city. This tutorial will guide you through the basics.',
  },
  {
    title: 'Build Roads',
    description: 'Select the Roads tool from the toolbar, then click and drag on the map to place roads. Roads are the foundation of your city — buildings can only grow next to them.',
    highlight: '[data-group="road"]',
  },
  {
    title: 'Zone Areas',
    description: 'Use the Zones tool to designate areas for Residential (green), Commercial (blue), and Industrial (orange) development. Zones must be placed adjacent to roads.',
    highlight: '[data-group="zone"]',
  },
  {
    title: 'Provide Utilities',
    description: 'Buildings need power and water to grow. Place a Power Plant and Water Pump from the Utility menu, then connect them to your road network.',
    highlight: '[data-group="utility"]',
  },
  {
    title: 'Watch Your City Grow',
    description: 'Once zones have road access, power, and water, buildings will start appearing automatically. Residents will move in and start working.',
  },
  {
    title: 'Add Civic Services',
    description: 'As your population grows, add Police, Fire, Hospital, and School buildings from the Civic menu to keep citizens happy and attract more residents.',
    highlight: '[data-group="civic"]',
  },
  {
    title: 'Manage Your Economy',
    description: 'Click the Economy button to view your budget. Balance tax income against service costs. Use the tax slider in the top-right to adjust rates.',
    highlight: '#btn-economy',
  },
  {
    title: 'Use Overlays',
    description: 'Click the Layers button to toggle map overlays — view traffic congestion, land value, pollution, crime, and service coverage at a glance.',
    highlight: '#btn-layers',
  },
  {
    title: 'You\'re Ready!',
    description: 'That\'s the basics! Explore districts, specializations, and more as your city grows. Use the Debug panel for testing. Have fun building!',
  },
];

export class Tutorial {
  private stepIndex = 0;
  private active = true;
  private complete = false;

  getCurrentStep(): TutorialStep | null {
    if (!this.active || this.stepIndex >= STEPS.length) return null;
    return STEPS[this.stepIndex]!;
  }

  getStepIndex(): number {
    return this.stepIndex;
  }

  getTotalSteps(): number {
    return STEPS.length;
  }

  isActive(): boolean {
    return this.active;
  }

  isComplete(): boolean {
    return this.complete;
  }

  next(): void {
    if (!this.active) return;
    this.stepIndex++;
    if (this.stepIndex >= STEPS.length) {
      this.active = false;
      this.complete = true;
    }
  }

  prev(): void {
    if (this.stepIndex > 0) this.stepIndex--;
  }

  dismiss(): void {
    this.active = false;
    this.complete = false;
  }

  restart(): void {
    this.stepIndex = 0;
    this.active = true;
    this.complete = false;
  }
}
