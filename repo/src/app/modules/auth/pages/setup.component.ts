import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UserRepository } from '../../../core/repositories';
import { UserRole } from '../../../core/enums';

function passwordStrength(control: AbstractControl): ValidationErrors | null {
  const v: string = control.value ?? '';
  if (v.length < 10) return { tooShort: true };
  if (!/[A-Z]/.test(v)) return { noUppercase: true };
  if (!/[0-9]/.test(v)) return { noDigit: true };
  if (!/[^A-Za-z0-9]/.test(v)) return { noSymbol: true };
  return null;
}

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-page">
      <div class="login-card" role="main">
        <h1 class="brand">TalentBridge</h1>
        <h2 class="subtitle">First-Run Setup</h2>
        <p class="setup-intro">
          No administrator account exists. Create one to get started.
        </p>

        @if (successMessage()) {
          <div class="alert alert-success" role="status" aria-live="polite">
            {{ successMessage() }}
          </div>
        }
        @if (errorMessage()) {
          <div class="alert alert-error" role="alert" aria-live="assertive">
            {{ errorMessage() }}
          </div>
        }

        <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
          <div class="field" [class.field-error]="showError('displayName')">
            <label for="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              formControlName="displayName"
              autocomplete="name"
              [attr.aria-invalid]="showError('displayName') ? 'true' : null"
            >
            @if (showError('displayName')) {
              <span class="field-error-msg" role="alert">Display name is required</span>
            }
          </div>

          <div class="field" [class.field-error]="showError('username')">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              formControlName="username"
              autocomplete="username"
              [attr.aria-invalid]="showError('username') ? 'true' : null"
            >
            @if (showError('username')) {
              <span class="field-error-msg" role="alert">Username is required (min 3 characters)</span>
            }
          </div>

          <div class="field" [class.field-error]="showError('password')">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              autocomplete="new-password"
              [attr.aria-invalid]="showError('password') ? 'true' : null"
            >
            @if (showError('password')) {
              <span class="field-error-msg" role="alert">
                Password must be ≥10 characters with uppercase, number, and symbol.
              </span>
            }
          </div>

          <button
            type="submit"
            class="btn btn-primary btn-full"
            [disabled]="isSubmitting()"
          >
            {{ isSubmitting() ? 'Creating account…' : 'Create Administrator Account' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class SetupComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly userRepo = inject(UserRepository);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(1)]],
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, passwordStrength]],
  });

  async ngOnInit(): Promise<void> {
    // If an admin already exists, setup is not needed — redirect to login.
    try {
      const users = await this.userRepo.getAll();
      const hasAdmin = users.some(u => (u.roles as string[]).includes(UserRole.Administrator));
      if (hasAdmin) {
        await this.router.navigate(['/login']);
      }
    } catch { /* IDB unavailable — allow the form to render */ }
  }

  showError(field: string): boolean {
    const ctrl = this.form.get(field);
    return !!(ctrl?.invalid && (ctrl.dirty || ctrl.touched));
  }

  async onSubmit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const { displayName, username, password } = this.form.getRawValue();
    try {
      await this.auth.register(
        username!,
        password!,
        displayName!,
        'default-org',
        username!,
        [UserRole.Administrator],
      );
      this.successMessage.set('Administrator account created. Redirecting to login…');
      setTimeout(() => this.router.navigate(['/login']), 1500);
    } catch (e: any) {
      this.errorMessage.set(e?.message ?? 'Failed to create account. Please try again.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
