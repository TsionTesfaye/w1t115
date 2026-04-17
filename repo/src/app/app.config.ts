import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { SIMULATOR_BASE } from './core/services/integration.service';
import { SeedService } from './core/services/seed.service';

function initSeed(seed: SeedService): () => Promise<void> {
  return () => seed.seed();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    { provide: SIMULATOR_BASE, useValue: '/api/simulate' },
    {
      provide: APP_INITIALIZER,
      useFactory: initSeed,
      deps: [SeedService],
      multi: true,
    },
  ]
};
