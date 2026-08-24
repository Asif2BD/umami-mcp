import type { ToolDef } from './common.js';
import { websiteTools } from './websites.js';
import { analyticsTools } from './analytics.js';
import { reportTools } from './reports.js';
import { adminTools } from './admin.js';

export const allTools: ToolDef[] = [...websiteTools, ...analyticsTools, ...reportTools, ...adminTools];

export * from './common.js';
