// Ordered list of migrations. Append new entries; do not reorder existing ones.

import * as m001 from './001_initial.js';
import * as m002 from './002_teams.js';
import * as m003 from './003_audit.js';
import * as m004 from './004_membership_v2.js';

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [m001, m002, m003, m004];
