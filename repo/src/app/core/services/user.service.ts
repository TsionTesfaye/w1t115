import { Injectable } from '@angular/core';
import { UserRepository } from '../repositories';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { User } from '../models';
import { AuditAction, UserRole, NotificationEventType } from '../enums';
import { generateId, now } from '../utils/id';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../errors';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly audit: AuditService,
    private readonly notifSvc: NotificationService,
  ) {}

  private isMgmt(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.Employer || r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  /**
   * Fetch a single user profile.
   * RBAC: Management can look up any user in the same org.
   *       Candidates (non-management) can only look up themselves.
   * ABAC: Always enforces organizationId match.
   */
  async getUser(userId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<User> {
    const user = await this.userRepo.getById(userId);
    if (!user) throw new NotFoundError('User', userId);
    if (user.organizationId !== actorOrgId) throw new AuthorizationError('Cannot access user from different organization');
    if (!this.isMgmt(actorRoles) && userId !== actorId) {
      throw new AuthorizationError('Candidates can only access their own profile');
    }
    return user;
  }

  /**
   * List all users in the caller's organization.
   * ABAC: org is resolved from actorOrgId (session-derived), NOT from a UI parameter.
   * RBAC: any authenticated member of the org may list — needed for messaging and directory.
   *       Sensitive fields (passwordHash, passwordSalt, encryptionKeySalt) are stripped
   *       for non-administrators.
   */
  async listByOrganization(actorRoles: UserRole[], actorOrgId: string): Promise<Omit<User, 'passwordHash' | 'passwordSalt' | 'encryptionKeySalt' | 'pbkdf2Iterations'>[]> {
    const users = await this.userRepo.getByOrganization(actorOrgId);
    if (actorRoles.includes(UserRole.Administrator)) {
      // Administrators get full records
      return users as User[];
    }
    // All other roles get records stripped of credential material
    return users.map(({ passwordHash: _ph, passwordSalt: _ps, encryptionKeySalt: _ek, pbkdf2Iterations: _pi, ...safe }) => safe);
  }

  async updateProfile(userId: string, updates: { displayName?: string; departmentId?: string }, actorId: string, actorOrgId: string, expectedVersion: number): Promise<User> {
    const user = await this.userRepo.getById(userId);
    if (!user) throw new NotFoundError('User', userId);
    if (user.organizationId !== actorOrgId) throw new AuthorizationError('Cannot modify user from different organization');
    if (userId !== actorId) throw new AuthorizationError('Users can only update their own profile');
    if (user.version !== expectedVersion) throw new OptimisticLockError('User', userId);
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.departmentId !== undefined) user.departmentId = updates.departmentId;
    user.version += 1; user.updatedAt = now();
    await this.userRepo.put(user);
    return user;
  }

  async changeRoles(targetUserId: string, newRoles: UserRole[], actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<User> {
    if (!newRoles.length) throw new ValidationError('At least one role is required');
    const target = await this.userRepo.getById(targetUserId);
    if (!target) throw new NotFoundError('User', targetUserId);
    if (target.organizationId !== actorOrgId) throw new AuthorizationError('Cannot modify user from different organization');
    if (!actorRoles.includes(UserRole.Administrator)) {
      await this.audit.log(actorId, AuditAction.PrivilegeEscalation, 'user', targetUserId, actorOrgId, { attemptedRoles: newRoles, actorRoles });
      // Notify all admins in the org so the attempt surfaces in real-time, not just in the audit log
      this.userRepo.getByOrganization(actorOrgId).then(async (orgUsers) => {
        const admins = orgUsers.filter(u => (u.roles as string[]).includes(UserRole.Administrator));
        for (const admin of admins) {
          await this.notifSvc.createNotification(
            admin.id, actorOrgId,
            NotificationEventType.RoleChanged, // closest available event — represents access change
            'user', targetUserId,
            `priv_esc_${actorId}_${generateId()}`,
            `Security alert: ${actorId} attempted privilege escalation targeting user ${targetUserId}`,
          ).catch(() => {});
        }
      }).catch(() => {});
      throw new AuthorizationError('Only Administrators can change user roles');
    }
    const oldRoles = [...target.roles];
    target.roles = newRoles; target.version += 1; target.updatedAt = now();
    await this.userRepo.put(target);
    await this.audit.log(actorId, AuditAction.RoleChanged, 'user', targetUserId, actorOrgId, { oldRoles, newRoles });
    return target;
  }

  async deactivateUser(targetUserId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<User> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only Administrators can deactivate users');
    const target = await this.userRepo.getById(targetUserId);
    if (!target) throw new NotFoundError('User', targetUserId);
    if (target.organizationId !== actorOrgId) throw new AuthorizationError('Cannot deactivate user from different organization');
    if (target.id === actorId) throw new ValidationError('Cannot deactivate yourself');
    target.deactivatedAt = now(); target.version += 1; target.updatedAt = now();
    await this.userRepo.put(target);
    await this.audit.log(actorId, AuditAction.UserDeactivated, 'user', targetUserId, actorOrgId);
    return target;
  }
}
