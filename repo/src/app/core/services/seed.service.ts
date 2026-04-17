import { Injectable } from '@angular/core';
import { UserRepository } from '../repositories';
import { AuthService } from './auth.service';
import { UserRole } from '../enums';
import { ConflictError } from '../errors';

export interface SeedAccount {
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
}

export const SEED_ACCOUNTS: SeedAccount[] = [
  { username: 'admin',       password: 'Admin@2025!',   displayName: 'Alice Admin',        role: UserRole.Administrator },
  { username: 'hr',          password: 'HrCoord@25!',   displayName: 'Hannah HR',          role: UserRole.HRCoordinator },
  { username: 'employer',    password: 'Employ@2025!',  displayName: 'Edward Employer',    role: UserRole.Employer },
  { username: 'interviewer', password: 'Intrvw@2025!',  displayName: 'Ivan Interviewer',   role: UserRole.Interviewer },
  { username: 'candidate',   password: 'Candidat@25!',  displayName: 'Carol Candidate',    role: UserRole.Candidate },
];

@Injectable({ providedIn: 'root' })
export class SeedService {
  constructor(
    private readonly auth: AuthService,
    private readonly userRepo: UserRepository,
  ) {}

  async seed(): Promise<void> {
    const existing = await this.userRepo.getAll();
    if (existing.length > 0) return;      // already seeded — skip silently
    for (const acct of SEED_ACCOUNTS) {
      try {
        await this.auth.register(
          acct.username,
          acct.password,
          acct.displayName,
          'demo-org',
          acct.role,          // departmentId = role string
          [acct.role],
        );
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
    }
  }
}
