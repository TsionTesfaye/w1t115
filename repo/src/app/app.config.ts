import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { SIMULATOR_BASE } from './core/services/integration.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    { provide: SIMULATOR_BASE, useValue: '/api/simulate' },
  ]
};
