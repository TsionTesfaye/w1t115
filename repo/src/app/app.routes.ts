import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { getRouteAccess } from './core/config/route-access.config';

/**
 * Application routes.
 *
 * EVERY authenticated route must use:
 *   canActivate: [authGuard, roleGuard]
 *   data: { roles: getRouteAccess('<path>').roles }
 *
 * Role arrays come from ROUTE_ACCESS (route-access.config.ts) — never duplicated
 * here.  getRouteAccess() throws at startup if the path is not registered,
 * preventing silent config drift.
 */
export const routes: Routes = [
  // ── Public ────────────────────────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () =>
      import('./modules/auth/pages/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./modules/auth/pages/setup.component').then(m => m.SetupComponent),
  },

  // ── Authenticated (all roles) ─────────────────────────────────────────────
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./modules/dashboard/pages/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('dashboard').roles },
  },
  {
    path: 'interviews',
    loadComponent: () =>
      import('./modules/interviews/pages/interview-list.component').then(m => m.InterviewListComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('interviews').roles },
  },
  {
    path: 'message-center',
    loadComponent: () =>
      import('./modules/messages/pages/message-center.component').then(m => m.MessageCenterComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('message-center').roles },
  },
  {
    path: 'notifications',
    loadComponent: () =>
      import('./modules/notifications/pages/notification-center.component').then(m => m.NotificationCenterComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('notifications').roles },
  },

  // ── Authenticated (restricted roles) ──────────────────────────────────────
  {
    path: 'jobs',
    loadComponent: () =>
      import('./modules/jobs/pages/job-list.component').then(m => m.JobListComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('jobs').roles },
  },
  {
    path: 'applications',
    loadComponent: () =>
      import('./modules/applications/pages/application-list.component').then(m => m.ApplicationListComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('applications').roles },
  },
  {
    path: 'application-packet/:applicationId',
    loadComponent: () =>
      import('./modules/application-packet/pages/application-packet.component').then(m => m.ApplicationPacketComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('application-packet').roles },
  },
  {
    path: 'documents',
    loadComponent: () =>
      import('./modules/documents/pages/document-list.component').then(m => m.DocumentListComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('documents').roles },
  },
  {
    path: 'content',
    loadComponent: () =>
      import('./modules/content/pages/content-list.component').then(m => m.ContentListComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('content').roles },
  },
  {
    path: 'moderation',
    loadComponent: () =>
      import('./modules/moderation/pages/moderation-panel.component').then(m => m.ModerationPanelComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('moderation').roles },
  },
  {
    path: 'governance',
    loadComponent: () =>
      import('./modules/governance/pages/governance.component').then(m => m.GovernanceComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('governance').roles },
  },
  {
    path: 'integration',
    loadComponent: () =>
      import('./modules/integration/pages/integration-console.component').then(m => m.IntegrationConsoleComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('integration').roles },
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./modules/admin/pages/admin-console.component').then(m => m.AdminConsoleComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('admin').roles },
  },

  // ── Detail routes ──────────────────────────────────────────────────────────
  {
    path: 'jobs/:jobId',
    loadComponent: () =>
      import('./modules/jobs/pages/job-detail.component').then(m => m.JobDetailComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('jobs/:jobId').roles },
  },
  {
    path: 'applications/:applicationId',
    loadComponent: () =>
      import('./modules/applications/pages/application-detail.component').then(m => m.ApplicationDetailComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('applications/:applicationId').roles },
  },
  {
    path: 'interviews/:interviewId',
    loadComponent: () =>
      import('./modules/interviews/pages/interview-detail.component').then(m => m.InterviewDetailComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: getRouteAccess('interviews/:interviewId').roles },
  },

  // ── Fallbacks ─────────────────────────────────────────────────────────────
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboard' },
];
