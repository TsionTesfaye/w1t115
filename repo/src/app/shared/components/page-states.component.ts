import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({ selector: 'app-loading-state', standalone: true, imports: [CommonModule],
  template: `<div class="state-container"><div class="spinner"></div><p>{{ message }}</p></div>`,
  styles: [`.state-container { display: flex; flex-direction: column; align-items: center; padding: 3rem; color: #666; } .spinner { width: 40px; height: 40px; border: 3px solid #e0e0e0; border-top-color: #4040ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem; } @keyframes spin { to { transform: rotate(360deg); } }`]
})
export class LoadingStateComponent { @Input() message = 'Loading...'; }

@Component({ selector: 'app-error-state', standalone: true, imports: [CommonModule],
  template: `<div class="state-container"><p class="error-msg">{{ message }}</p>@if (retryable) { <button (click)="onRetry()">Retry</button> }</div>`,
  styles: [`.state-container { display: flex; flex-direction: column; align-items: center; padding: 3rem; } .error-msg { color: #cc0000; margin-bottom: 1rem; } button { padding: 0.5rem 1.5rem; border: 1px solid #4040ff; color: #4040ff; background: transparent; cursor: pointer; border-radius: 4px; }`]
})
export class ErrorStateComponent { @Input() message = 'An error occurred'; @Input() retryable = true; @Input() retryFn: (() => void) | undefined; onRetry(): void { this.retryFn?.(); } }

@Component({ selector: 'app-empty-state', standalone: true, imports: [CommonModule],
  template: `<div class="state-container"><p>{{ message }}</p></div>`,
  styles: [`.state-container { display: flex; flex-direction: column; align-items: center; padding: 3rem; color: #999; }`]
})
export class EmptyStateComponent { @Input() message = 'No data available'; }
