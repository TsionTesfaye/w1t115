import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { SessionService } from '../../../core/services/session.service';
import { InterviewService } from '../../../core/services/interview.service';
import { InterviewPlanService } from '../../../core/services/interview-plan.service';
import { ApplicationService } from '../../../core/services/application.service';
import { UserService } from '../../../core/services/user.service';
import { Interview, Application, User, InterviewPlan, InterviewPlanStage } from '../../../core/models';
import { InterviewStatus, UserRole } from '../../../core/enums';
import { LoadingStateComponent, ErrorStateComponent, EmptyStateComponent } from '../../../shared/components/page-states.component';

@Component({
  selector: 'app-interview-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>Interviews</h1>
        @if (isManagement()) {
          <button class="btn-primary" (click)="showScheduleForm.set(true)">Schedule Interview</button>
        }
      </header>

      @if (actionSuccess()) {
        <div class="alert alert-success">{{ actionSuccess() }}</div>
      }
      @if (actionError()) {
        <div class="alert alert-error">{{ actionError() }}</div>
      }

      @if (showScheduleForm() && isManagement()) {
        <div class="form-panel">
          <h2>Schedule Interview</h2>
          <form [formGroup]="scheduleForm" (ngSubmit)="onSchedule()">
            <div class="field">
              <label for="applicationId">Application *</label>
              <select id="applicationId" formControlName="applicationId" (change)="onApplicationSelected()">
                <option value="">Select an application</option>
                @for (app of orgApplications(); track app.id) {
                  <option [value]="app.id">{{ app.id }} (Job: {{ app.jobId }})</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="interviewerId">Interviewer *</label>
              <select id="interviewerId" formControlName="interviewerId">
                <option value="">Select an interviewer</option>
                @for (user of interviewers(); track user.id) {
                  <option [value]="user.id">{{ user.displayName }} ({{ user.username }})</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="startTime">Start Time *</label>
              <input id="startTime" type="datetime-local" formControlName="startTime">
            </div>
            <div class="field">
              <label for="endTime">End Time *</label>
              <input id="endTime" type="datetime-local" formControlName="endTime">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary" [disabled]="scheduleForm.invalid">Schedule</button>
              <button type="button" class="btn-secondary" (click)="cancelScheduleForm()">Cancel</button>
            </div>
          </form>
        </div>
      }

      @if (isLoading()) {
        <app-loading-state message="Loading interviews..." />
      } @else if (error()) {
        <app-error-state [message]="error()!" [retryFn]="loadInterviews.bind(this)" />
      } @else if (interviews().length === 0) {
        <app-empty-state message="No interviews scheduled" />
      } @else {
        <div class="list">
          @for (interview of interviews(); track interview.id) {
            <div class="card">
              <div class="card-header">
                <span class="status-badge" [attr.data-status]="interview.status">{{ interview.status }}</span>
                <span class="time">{{ interview.startTime | date:'short' }} - {{ interview.endTime | date:'shortTime' }}</span>
              </div>
              <div class="card-body">
                <p>Application: {{ interview.applicationId }}</p>
                <p>Interviewer: {{ interview.interviewerId }}</p>
                <p>Candidate: {{ interview.candidateId }}</p>
              </div>
              <div class="card-actions">
                @if (isManagement() && interview.status === 'scheduled') {
                  <button class="btn-sm btn-primary" (click)="onComplete(interview)">Complete</button>
                  <button class="btn-sm btn-danger" (click)="onCancel(interview)">Cancel</button>
                }
                @if (isInterviewer() && interview.status === 'scheduled' && interview.interviewerId === session.requireAuth().userId) {
                  <button class="btn-sm btn-primary" (click)="onComplete(interview)">Complete</button>
                }
              </div>
            </div>
          }
        </div>
      }

      @if (canManagePlans()) {
        <div class="plans-section">
          <div class="plans-header">
            <h2>Interview Plans</h2>
            <button class="btn-secondary" (click)="togglePlansPanel()">
              {{ showPlansPanel() ? 'Hide' : 'Manage Interview Plans' }}
            </button>
          </div>

          @if (showPlansPanel()) {
            @if (plansError()) {
              <div class="alert alert-error">{{ plansError() }}</div>
            }

            <div class="form-panel">
              <h3>Create Plan</h3>
              <form [formGroup]="planForm" (ngSubmit)="onCreatePlan()">
                <div class="field">
                  <label>Job ID *</label>
                  <input formControlName="jobId" placeholder="job-id">
                </div>
                <div formArrayName="stages">
                  <div class="stages-header">
                    <span class="stages-label">Stages</span>
                    <button type="button" class="btn-sm btn-secondary" (click)="addStage()">+ Add Stage</button>
                  </div>
                  @for (stageCtrl of planStages.controls; track $index; let i = $index) {
                    <div class="stage-row" [formGroupName]="i">
                      <input formControlName="name" placeholder="Stage name">
                      <input formControlName="durationMinutes" type="number" placeholder="Min" style="width:70px">
                      <input formControlName="interviewerRole" placeholder="Interviewer role">
                      <button type="button" class="btn-sm btn-danger" (click)="removeStage(i)" [disabled]="planStages.length <= 1">-</button>
                    </div>
                  }
                </div>
                <div class="form-actions" style="margin-top:0.75rem">
                  <button type="submit" class="btn-primary" [disabled]="planForm.invalid || isPlanLoading()">
                    {{ isPlanLoading() ? 'Creating...' : 'Create Plan' }}
                  </button>
                </div>
              </form>
            </div>

            @if (plans().length === 0) {
              <app-empty-state message="No interview plans yet" />
            } @else {
              <div class="list">
                @for (plan of plans(); track plan.id) {
                  <div class="card">
                    <div class="card-header">
                      <span><strong>Job:</strong> {{ plan.jobId }}</span>
                      <div class="card-actions">
                        <button class="btn-sm btn-secondary" (click)="toggleEditPlan(plan)">
                          {{ editingPlanId() === plan.id ? 'Cancel' : 'Edit' }}
                        </button>
                        <button class="btn-sm btn-danger" (click)="onDeletePlan(plan)" [disabled]="isPlanLoading()">Delete</button>
                      </div>
                    </div>
                    <div class="card-body">
                      <p>Stages: {{ plan.stages.length }} &nbsp;|&nbsp; Created by: {{ plan.createdBy }}</p>
                    </div>
                    @if (editingPlanId() === plan.id) {
                      <div class="edit-form">
                        <form [formGroup]="editPlanForm" (ngSubmit)="onUpdatePlan(plan)">
                          <div formArrayName="stages">
                            <div class="stages-header">
                              <span class="stages-label">Stages</span>
                              <button type="button" class="btn-sm btn-secondary" (click)="addEditStage()">+ Add Stage</button>
                            </div>
                            @for (stageCtrl of editPlanStages.controls; track $index; let i = $index) {
                              <div class="stage-row" [formGroupName]="i">
                                <input formControlName="name" placeholder="Stage name">
                                <input formControlName="durationMinutes" type="number" placeholder="Min" style="width:70px">
                                <input formControlName="interviewerRole" placeholder="Interviewer role">
                                <button type="button" class="btn-sm btn-danger" (click)="removeEditStage(i)" [disabled]="editPlanStages.length <= 1">-</button>
                              </div>
                            }
                          </div>
                          <div class="form-actions" style="margin-top:0.5rem">
                            <button type="submit" class="btn-primary" [disabled]="editPlanForm.invalid || isPlanLoading()">Save</button>
                          </div>
                        </form>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .page-header h1 { margin: 0; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }
    .alert-success { background: #e8ffe8; color: #008000; border: 1px solid #b0e0b0; }
    .alert-error { background: #ffe8e8; color: #cc0000; border: 1px solid #e0b0b0; }
    .form-panel {
      background: white; padding: 1.5rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 1.5rem;
    }
    .form-panel h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    .field { margin-bottom: 1rem; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .field input, .field select {
      width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;
      font-size: 0.9rem; box-sizing: border-box;
    }
    .form-actions { display: flex; gap: 0.5rem; }
    .btn-primary {
      padding: 0.5rem 1.25rem; background: #4040ff; color: white;
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      padding: 0.5rem 1.25rem; background: white; color: #333;
      border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 0.9rem;
    }
    .list { display: flex; flex-direction: column; gap: 0.75rem; }
    .card {
      background: white; padding: 1.25rem; border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .card-header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .status-badge {
      padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem;
      font-weight: 600; text-transform: capitalize; background: #e8e8ff;
    }
    .status-badge[data-status="scheduled"] { background: #e0e0ff; color: #4040ff; }
    .status-badge[data-status="completed"] { background: #e8ffe8; color: #008000; }
    .status-badge[data-status="canceled"] { background: #ffe8e8; color: #cc0000; }
    .time { font-size: 0.85rem; color: #666; }
    .card-body p { margin: 0.25rem 0; color: #666; font-size: 0.9rem; }
    .card-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    .btn-sm { padding: 0.3rem 0.75rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer; border: none; }
    .btn-sm.btn-primary { background: #4040ff; color: white; }
    .btn-sm.btn-danger { background: #cc0000; color: white; }
    .plans-section { margin-top: 2rem; }
    .plans-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .plans-header h2 { margin: 0; font-size: 1.1rem; }
    .stages-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .stages-label { font-weight: 600; font-size: 0.9rem; }
    .stage-row { display: flex; gap: 0.5rem; margin-bottom: 0.4rem; align-items: center; }
    .stage-row input { flex: 1; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; box-sizing: border-box; }
    .edit-form { padding-top: 0.75rem; border-top: 1px solid #eee; margin-top: 0.5rem; }
    .form-panel h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  `]
})
export class InterviewListComponent implements OnInit {
  readonly session = inject(SessionService);
  private readonly interviewSvc = inject(InterviewService);
  private readonly planSvc = inject(InterviewPlanService);
  private readonly appSvc = inject(ApplicationService);
  private readonly userSvc = inject(UserService);
  private readonly fb = inject(FormBuilder);

  interviews = signal<Interview[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  showScheduleForm = signal(false);
  actionError = signal<string | null>(null);
  actionSuccess = signal<string | null>(null);

  orgApplications = signal<Application[]>([]);
  interviewers = signal<Omit<User, 'passwordHash' | 'passwordSalt' | 'encryptionKeySalt' | 'pbkdf2Iterations'>[]>([]);
  private selectedPlanId: string | null = null;
  private selectedCandidateId: string | null = null;

  isManagement = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  isInterviewer = computed(() => {
    return this.session.activeRole() === UserRole.Interviewer;
  });

  canManagePlans = computed(() => {
    const role = this.session.activeRole();
    return role === UserRole.Employer || role === UserRole.HRCoordinator || role === UserRole.Administrator;
  });

  scheduleForm: FormGroup = this.fb.group({
    applicationId: ['', Validators.required],
    interviewerId: ['', Validators.required],
    startTime: ['', Validators.required],
    endTime: ['', Validators.required],
  });

  // Interview Plans
  plans = signal<InterviewPlan[]>([]);
  showPlansPanel = signal(false);
  isPlanLoading = signal(false);
  plansError = signal<string | null>(null);
  editingPlanId = signal<string | null>(null);

  planForm: FormGroup = this.fb.group({
    jobId: ['', Validators.required],
    stages: this.fb.array([this.createStageGroup()]),
  });

  editPlanForm: FormGroup = this.fb.group({
    stages: this.fb.array([this.createStageGroup()]),
  });

  get planStages(): FormArray {
    return this.planForm.get('stages') as FormArray;
  }

  get editPlanStages(): FormArray {
    return this.editPlanForm.get('stages') as FormArray;
  }

  private createStageGroup(stage?: Partial<InterviewPlanStage>) {
    return this.fb.group({
      name: [stage?.name ?? '', Validators.required],
      durationMinutes: [stage?.durationMinutes ?? 60, [Validators.required, Validators.min(1)]],
      interviewerRole: [stage?.interviewerRole ?? 'interviewer', Validators.required],
    });
  }

  addStage(): void {
    this.planStages.push(this.createStageGroup());
  }

  removeStage(i: number): void {
    if (this.planStages.length > 1) this.planStages.removeAt(i);
  }

  addEditStage(): void {
    this.editPlanStages.push(this.createStageGroup());
  }

  removeEditStage(i: number): void {
    if (this.editPlanStages.length > 1) this.editPlanStages.removeAt(i);
  }

  ngOnInit(): void {
    this.loadInterviews();
    if (this.canManagePlans()) {
      this.loadPlans();
    }
  }

  async loadInterviews(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const ctx = this.session.requireAuth();
      if (this.isManagement()) {
        this.interviews.set(await this.interviewSvc.listByOrganization(ctx.userId, ctx.roles, ctx.organizationId));
        // Pre-load data for scheduling form
        await this.loadSchedulingData(ctx);
      } else if (ctx.activeRole === UserRole.Interviewer) {
        this.interviews.set(await this.interviewSvc.getByInterviewer(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId));
      } else if (ctx.activeRole === UserRole.Candidate) {
        this.interviews.set(await this.interviewSvc.getByCandidate(ctx.userId, ctx.userId, ctx.roles, ctx.organizationId));
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load interviews');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadSchedulingData(ctx: { userId: string; organizationId: string; roles: UserRole[] }): Promise<void> {
    try {
      const [apps, users] = await Promise.all([
        this.appSvc.listByOrganization(ctx.userId, ctx.roles, ctx.organizationId),
        this.userSvc.listByOrganization(ctx.roles, ctx.organizationId),
      ]);
      this.orgApplications.set(apps.filter(a => a.status === 'active'));
      this.interviewers.set(users.filter(u => u.roles.includes(UserRole.Interviewer)));
    } catch {
      // Non-critical — form will have empty dropdowns
    }
  }

  async onApplicationSelected(): Promise<void> {
    const appId = this.scheduleForm.get('applicationId')?.value;
    if (!appId) return;
    const app = this.orgApplications().find(a => a.id === appId);
    if (!app) return;
    this.selectedCandidateId = app.candidateId;
    try {
      const ctx = this.session.requireAuth();
      const plan = await this.planSvc.ensurePlanForJob(app.jobId, ctx.roles, ctx.organizationId, ctx.userId);
      this.selectedPlanId = plan.id;
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to load interview plan');
      this.autoClearMessages();
    }
  }

  async onSchedule(): Promise<void> {
    if (this.scheduleForm.invalid) return;
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      const { applicationId, interviewerId, startTime, endTime } = this.scheduleForm.value;
      if (!this.selectedPlanId) {
        this.actionError.set('Please select an application first to load the interview plan');
        this.autoClearMessages();
        return;
      }
      if (!this.selectedCandidateId) {
        this.actionError.set('Could not determine candidate from application');
        this.autoClearMessages();
        return;
      }
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();
      await this.interviewSvc.scheduleInterview(
        applicationId, this.selectedPlanId, interviewerId, this.selectedCandidateId,
        startIso, endIso, ctx.userId, ctx.roles, ctx.organizationId,
      );
      this.showSuccess('Interview scheduled successfully');
      this.cancelScheduleForm();
      await this.loadInterviews();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to schedule interview');
      this.autoClearMessages();
    }
  }

  async onComplete(interview: Interview): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.interviewSvc.completeInterview(interview.id, ctx.userId, ctx.roles, ctx.organizationId, interview.version);
      this.showSuccess('Interview marked as completed');
      await this.loadInterviews();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to complete interview');
      this.autoClearMessages();
    }
  }

  async onCancel(interview: Interview): Promise<void> {
    this.clearMessages();
    try {
      const ctx = this.session.requireAuth();
      await this.interviewSvc.cancelInterview(interview.id, ctx.userId, ctx.roles, ctx.organizationId, interview.version);
      this.showSuccess('Interview canceled');
      await this.loadInterviews();
    } catch (e: any) {
      this.actionError.set(e.message ?? 'Failed to cancel interview');
      this.autoClearMessages();
    }
  }

  togglePlansPanel(): void {
    const opening = !this.showPlansPanel();
    this.showPlansPanel.set(opening);
    if (opening) this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.plansError.set(null);
    try {
      const ctx = this.session.requireAuth();
      this.plans.set(await this.planSvc.listPlans(ctx.roles, ctx.organizationId));
    } catch (e: any) {
      this.plansError.set(e.message ?? 'Failed to load plans');
    }
  }

  async onCreatePlan(): Promise<void> {
    if (this.planForm.invalid) return;
    this.isPlanLoading.set(true);
    this.plansError.set(null);
    try {
      const ctx = this.session.requireAuth();
      const { jobId, stages } = this.planForm.value;
      const planStages: InterviewPlanStage[] = (stages as any[]).map((s, idx) => ({
        name: s.name,
        order: idx + 1,
        durationMinutes: Number(s.durationMinutes),
        interviewerRole: s.interviewerRole,
      }));
      await this.planSvc.createPlan(jobId, planStages, ctx.userId, ctx.roles, ctx.organizationId);
      this.planForm.reset({ jobId: '', stages: [] });
      // Reset to one empty stage
      while (this.planStages.length) this.planStages.removeAt(0);
      this.planStages.push(this.createStageGroup());
      this.actionSuccess.set('Interview plan created');
      this.autoClearMessages();
      await this.loadPlans();
    } catch (e: any) {
      this.plansError.set(e.message ?? 'Failed to create plan');
    } finally {
      this.isPlanLoading.set(false);
    }
  }

  toggleEditPlan(plan: InterviewPlan): void {
    if (this.editingPlanId() === plan.id) {
      this.editingPlanId.set(null);
      return;
    }
    this.editingPlanId.set(plan.id);
    // Populate edit form
    while (this.editPlanStages.length) this.editPlanStages.removeAt(0);
    for (const s of plan.stages) {
      this.editPlanStages.push(this.createStageGroup(s));
    }
    if (this.editPlanStages.length === 0) {
      this.editPlanStages.push(this.createStageGroup());
    }
  }

  async onUpdatePlan(plan: InterviewPlan): Promise<void> {
    if (this.editPlanForm.invalid) return;
    this.isPlanLoading.set(true);
    this.plansError.set(null);
    try {
      const ctx = this.session.requireAuth();
      const stages: InterviewPlanStage[] = (this.editPlanForm.value.stages as any[]).map((s, idx) => ({
        name: s.name,
        order: idx + 1,
        durationMinutes: Number(s.durationMinutes),
        interviewerRole: s.interviewerRole,
      }));
      await this.planSvc.updatePlan(plan.id, stages, ctx.userId, ctx.roles, ctx.organizationId, plan.version);
      this.editingPlanId.set(null);
      this.actionSuccess.set('Plan updated');
      this.autoClearMessages();
      await this.loadPlans();
    } catch (e: any) {
      this.plansError.set(e.message ?? 'Failed to update plan');
    } finally {
      this.isPlanLoading.set(false);
    }
  }

  async onDeletePlan(plan: InterviewPlan): Promise<void> {
    this.isPlanLoading.set(true);
    this.plansError.set(null);
    try {
      const ctx = this.session.requireAuth();
      await this.planSvc.deletePlan(plan.id, ctx.userId, ctx.roles, ctx.organizationId);
      this.actionSuccess.set('Plan deleted');
      this.autoClearMessages();
      await this.loadPlans();
    } catch (e: any) {
      this.plansError.set(e.message ?? 'Failed to delete plan');
    } finally {
      this.isPlanLoading.set(false);
    }
  }

  cancelScheduleForm(): void {
    this.showScheduleForm.set(false);
    this.scheduleForm.reset();
    this.selectedPlanId = null;
    this.selectedCandidateId = null;
  }

  private clearMessages(): void {
    this.actionError.set(null);
    this.actionSuccess.set(null);
  }

  private showSuccess(msg: string): void {
    this.actionSuccess.set(msg);
    this.autoClearMessages();
  }

  private autoClearMessages(): void {
    setTimeout(() => {
      this.actionError.set(null);
      this.actionSuccess.set(null);
    }, 3000);
  }
}
