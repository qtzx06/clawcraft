import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentManager } from './agent-manager.js';

describe('AgentManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new AgentManager({ mcHost: '127.0.0.1', mcPort: 25565, basePort: 4000, dryRun: true });
  });

  it('assigns sequential ports', () => {
    const p1 = mgr.allocatePort();
    const p2 = mgr.allocatePort();
    expect(p1).toBe(4000);
    expect(p2).toBe(4001);
  });

  it('tracks agent metadata', () => {
    mgr.register('alphaforge', { name: 'Zara', role: 'worker', port: 4000, display_name: '[AlphaForge] Zara' });
    const agent = mgr.getAgent('alphaforge', 'Zara');
    expect(agent).toBeTruthy();
    expect(agent.display_name).toBe('[AlphaForge] Zara');
  });

  it('lists agents for a team', () => {
    mgr.register('alphaforge', { name: 'Zara', role: 'worker', port: 4000 });
    mgr.register('alphaforge', { name: 'Rex', role: 'primary', port: 4001 });
    const agents = mgr.listAgents('alphaforge');
    expect(agents).toHaveLength(2);
  });

  it('removes agent', () => {
    mgr.register('alphaforge', { name: 'Zara', role: 'worker', port: 4000 });
    const removed = mgr.remove('alphaforge', 'Zara');
    expect(removed).toBe(true);
    expect(mgr.getAgent('alphaforge', 'Zara')).toBeNull();
  });
});
