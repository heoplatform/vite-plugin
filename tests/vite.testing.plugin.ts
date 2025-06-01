import { BaseHooks } from 'base-plugin-system';
import { ExpressHooks } from 'express-plugin';
import { ViteHooks, VitePluginConfig, InitVite } from '../src/index'; // Path to vite plugin's own types
import type express from 'express';

export interface ViteTestingPluginActualHooks {
  configureViteCalled: boolean;
  initViteCalled: boolean;
  receivedViteConfig?: VitePluginConfig;
  receivedInitViteArgs?: InitVite;
}

export function createViteTestingPlugin(): 
  BaseHooks & ExpressHooks & ViteHooks & ViteTestingPluginActualHooks {
  
  const state: ViteTestingPluginActualHooks = {
    configureViteCalled: false,
    initViteCalled: false,
  };

  return {
    // Actual Hooks for assertions
    get configureViteCalled() { return state.configureViteCalled; },
    get initViteCalled() { return state.initViteCalled; },
    get receivedViteConfig() { return state.receivedViteConfig; },
    get receivedInitViteArgs() { return state.receivedInitViteArgs; },

    // BaseHooks
    async init(plugins: any[]) { /* ... */ },
    async postInit() { /* ... */ },

    // ExpressHooks
    async initExpress(app: express.Application, stop: () => void) { /* ... */ },
    async postInitExpress() { /* ... */ },

    // ViteHooks
    async configureVite(config: VitePluginConfig): Promise<VitePluginConfig> {
      state.configureViteCalled = true;
      state.receivedViteConfig = JSON.parse(JSON.stringify(config)); // Deep copy for inspection
      // Modify config if needed for a specific test, or just observe
      return config;
    },
    async initVite(vite: InitVite) {
      state.initViteCalled = true;
      state.receivedInitViteArgs = { ...vite }; // Shallow copy is fine for now
    },
  };
} 