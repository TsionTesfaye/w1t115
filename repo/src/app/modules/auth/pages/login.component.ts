import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SessionService } from '../../../core/services/session.service';
import { CaptchaRequiredError, LockoutError, AuthenticationError } from '../../../core/errors';
import { CaptchaDisplay } from '../../../core/models';

const REJECTION_MESSAGES: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  locked: 'Your session was locked. Please contact your administrator.',
  deactivated: 'Your account has been deactivated. Please contact your administrator.',
  superseded: 'You were logged out because another session was started.',
};

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-page">
      <div class="login-card" role="main">
        <h1 class="brand">TalentBridge</h1>
        <h2 class="subtitle">Sign In</h2>

        @if (sessionRejectionMessage()) {
          <div class="alert alert-info" role="alert" aria-live="polite">
            {{ sessionRejectionMessage() }}
          </div>
        }
        @if (errorMessage()) {
          <div class="alert alert-error" role="alert" aria-live="assertive">
            {{ errorMessage() }}
          </div>
        }
        @if (lockoutUntil()) {
          <div class="alert alert-warning" role="alert" aria-live="assertive">
            Account locked until {{ lockoutUntil() | date:'medium' }}. Please try again later.
          </div>
        }

        <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
          <!-- Username -->
          <div class="field" [class.field-error]="showError('username')">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              formControlName="username"
              autocomplete="username"
              [attr.aria-describedby]="showError('username') ? 'username-error' : null"
              [attr.aria-invalid]="showError('username') ? 'true' : null"
            >
            @if (showError('username')) {
              <span id="username-error" class="field-error-msg" role="alert">Username is required</span>
            }
          </div>

          <!-- Password -->
          <div class="field" [class.field-error]="showError('password')">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [attr.aria-describedby]="showError('password') ? 'password-error' : null"
              [attr.aria-invalid]="showError('password') ? 'true' : null"
            >
            @if (showError('password')) {
              <span id="password-error" class="field-error-msg" role="alert">Password is required</span>
            }
          </div>

          <!-- CAPTCHA (shown after 3 failed attempts) -->
          @if (captcha()) {
            <div class="captcha-block" role="group" aria-labelledby="captcha-label">
              <p id="captcha-label" class="captcha-label">
                Security check — type the characters shown below:
              </p>
              <img
                [src]="captcha()!.imageDataUrl || ''"
                alt="CAPTCHA challenge image"
                class="captcha-img"
              >
              <div class="field" [class.field-error]="showError('captchaAnswer')">
                <label for="captchaAnswer" class="sr-only">CAPTCHA answer</label>
                <input
                  id="captchaAnswer"
                  type="text"
                  formControlName="captchaAnswer"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Enter characters above"
                  aria-required="true"
                >
              </div>
            </div>
          }

          <!-- Remember me -->
          <div class="field-check">
            <label class="check-label">
              <input type="checkbox" formControlName="rememberSession">
              <span>Remember me for 7 days</span>
            </label>
          </div>

          <button
            type="submit"
            class="btn-primary"
            [disabled]="submitting()"
            [attr.aria-busy]="submitting()"
          >
            {{ submitting() ? 'Signing in…' : 'Sign In' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5fa;
      padding: 1rem;
    }
    .login-card {
      background: white;
      padding: 2.5rem;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      width: 100%;
      max-width: 420px;
    }
    .brand {
      text-align: center;
      color: #1a1a2e;
      margin: 0 0 0.25rem;
      font-size: 1.6rem;
    }
    .subtitle {
      text-align: center;
      color: #888;
      font-weight: 400;
      margin: 0 0 1.75rem;
      font-size: 1rem;
    }
    .alert {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    .alert-error { background: #fff0f0; color: #cc0000; border-left: 3px solid #ff4444; }
    .alert-warning { background: #fff8e0; color: #885500; border-left: 3px solid #ffaa00; }
    .alert-info { background: #f0f4ff; color: #2244aa; border-left: 3px solid #4466dd; }
    .field { margin-bottom: 1.1rem; }
    .field label { display: block; margin-bottom: 0.3rem; font-size: 0.9rem; font-weight: 500; color: #444; }
    .field input[type="text"],
    .field input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 0.95rem;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }
    .field input:focus {
      outline: none;
      border-color: #4040ff;
      box-shadow: 0 0 0 2px rgba(64,64,255,0.12);
    }
    .field.field-error input { border-color: #cc0000; }
    .field-error-msg { display: block; margin-top: 0.25rem; font-size: 0.8rem; color: #cc0000; }
    .captcha-block {
      background: #f9f9fc;
      border: 1px solid #e0e0ec;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.1rem;
    }
    .captcha-label { margin: 0 0 0.6rem; font-size: 0.85rem; color: #555; }
    .captcha-img { display: block; border-radius: 4px; margin-bottom: 0.6rem; max-width: 100%; }
    .captcha-block .field { margin-bottom: 0; }
    .captcha-block input {
      letter-spacing: 0.12em;
      font-size: 1rem;
    }
    .field-check { margin-bottom: 1.25rem; }
    .check-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-size: 0.9rem;
      color: #555;
    }
    .btn-primary {
      width: 100%;
      padding: 0.75rem;
      background: #4040ff;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary:hover:not(:disabled) { background: #2828dd; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0);
      white-space: nowrap; border: 0;
    }
  `],
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly sessionSvc = inject(SessionService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  form = this.fb.group({
    username:       ['', Validators.required],
    password:       ['', [Validators.required]],
    captchaAnswer:  [''],
    rememberSession: [false],
  });

  sessionRejectionMessage = signal<string | null>(null);
  errorMessage   = signal<string | null>(null);
  lockoutUntil   = signal<string | null>(null);
  captcha        = signal<CaptchaDisplay | null>(null);
  submitting     = signal(false);

  ngOnInit(): void {
    // Surface the reason a previous session was rejected (expired, locked, etc.)
    const reason = this.sessionSvc.sessionRejectionReason();
    if (reason) {
      this.sessionRejectionMessage.set(REJECTION_MESSAGES[reason] ?? 'Your session is no longer valid. Please sign in again.');
    }

    // If already authenticated, bypass the login page entirely.
    if (this.sessionSvc.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  showError(field: 'username' | 'password' | 'captchaAnswer'): boolean {
    const ctrl = this.form.get(field);
    return !!(ctrl?.invalid && (ctrl.dirty || ctrl.touched));
  }

  async onSubmit(): Promise<void> {
    // Mark all fields touched so validation messages appear.
    this.form.markAllAsTouched();
    if (this.form.invalid && !this.captcha()) return;
    if (this.captcha() && !this.form.value.captchaAnswer) return;

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { username, password, captchaAnswer, rememberSession } = this.form.value;
    const currentCaptcha = this.captcha();

    try {
      const result = await this.auth.login(
        username!,
        password!,
        currentCaptcha?.id,
        captchaAnswer || undefined,
        rememberSession ?? false,
      );
      this.sessionSvc.setSession(result.user, result.session);
      await this.router.navigate(['/dashboard']);
    } catch (e) {
      if (e instanceof LockoutError) {
        this.lockoutUntil.set(e.lockoutUntil);
        this.captcha.set(null);
        this.errorMessage.set(null); // lockout banner is shown instead
      } else if (e instanceof CaptchaRequiredError) {
        this.captcha.set(this.auth.generateCaptcha());
        this.form.patchValue({ captchaAnswer: '' });
        this.errorMessage.set('Security check required — please solve the CAPTCHA below.');
      } else if (e instanceof AuthenticationError) {
        if (currentCaptcha) {
          this.captcha.set(this.auth.generateCaptcha());
          this.form.patchValue({ captchaAnswer: '' });
        }
        this.errorMessage.set(e.message);
      } else {
        this.errorMessage.set('An unexpected error occurred. Please try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
