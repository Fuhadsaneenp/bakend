import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildPerformanceReport } from './performance.js';

export function createServer({
  baseUrl = process.env.STEMS_API_URL || 'https://api.secondtales.com',
  token = process.env.STEMS_ACCESS_TOKEN,
  fetchImpl = fetch,
  oauth = false,
} = {}) {
  const origin = new URL(baseUrl);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('STEMS_API_URL must be an origin without credentials, path, query, or fragment.');
  }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('STEMS_API_URL must use HTTPS (HTTP is allowed for localhost).');
  }

  const server = new McpServer({ name: 'stems', version: '1.0.0' });
  async function request(path, authenticated = true, query = {}) {
    if (authenticated && !token) {
      return { isError: true, content: [{ type: 'text', text: 'Set STEMS_ACCESS_TOKEN to a valid backend access token to use this tool.' }] };
    }
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const message = response.status === 401 ? 'Access token expired or invalid. Update STEMS_ACCESS_TOKEN and restart.'
          : response.status === 403 ? 'Your backend account does not have permission for this request.'
          : `Backend request failed (HTTP ${response.status}).`;
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
      const data = await response.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Could not read the backend response. Check connectivity, server health, and API URL.' }] };
    }
  }

  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const security = oauth ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['stems:read'] }] } } : {};
  server.registerTool('stems_health', {
    description: 'Check the Stems backend and database connection.', inputSchema: {}, annotations, ...security,
  }, () => request('/health', false));
  server.registerTool('stems_list_employees', {
    description: 'List employees visible to the authenticated backend account. Backend role and company permissions apply.',
    inputSchema: { companyId: z.string().min(1).max(128).optional().describe('Optional company ID; the backend checks access.') },
    annotations, ...security,
  }, ({ companyId }) => request('/api/employees', true, { companyId }));
  server.registerTool('stems_list_notifications', {
    description: 'Read the authenticated account’s latest 50 notifications.', inputSchema: {}, annotations, ...security,
  }, () => request('/api/notifications'));
  server.registerTool('stems_employee_performance', {
    description: 'Collect monthly employee attendance punches, designer task histories and start/finish status timestamps, and undated data-entry counts. Returns all visible employees or one employee ID. Missing sources and timing limitations are explicit.',
    inputSchema: {
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2020).max(2100),
      employeeId: z.string().min(1).max(128).optional(),
      companyId: z.string().min(1).max(128).optional().describe('Employee/attendance company filter. Work-track APIs use the token’s company; they have no company override.'),
    }, annotations, ...security,
  }, async ({ month, year, employeeId, companyId }) => {
    const employeeResult = await request('/api/employees', true, { companyId });
    if (employeeResult.isError) return employeeResult;
    try {
      const employees = JSON.parse(employeeResult.content[0].text);
      if (!Array.isArray(employees)) throw new Error('Unexpected employees response shape.');
      if (employeeId && !employees.some(employee => employee.id === employeeId)) {
        throw new Error('Employee not found in the employees visible to this account.');
      }
      const results = await Promise.all([
        request('/api/attendance/report', true, { month, year, companyId }),
        request('/api/work-track/cards', true, { assignedToId: employeeId }),
        request('/api/work-track/data-entry-sheets'),
        request('/api/auth/me/access'),
      ]);
      const sourceStatus = {};
      const values = results.map((result, index) => {
        const name = ['attendance', 'workCards', 'dataEntrySheets', 'accountContext'][index];
        if (result.isError) {
          sourceStatus[name] = { available: false, error: result.content[0].text };
          return null;
        }
        const value = JSON.parse(result.content[0].text);
        const valid = index < 2 ? Array.isArray(value) : value !== null && typeof value === 'object' && !Array.isArray(value);
        sourceStatus[name] = valid ? { available: true } : { available: false, error: 'Unexpected backend response shape.' };
        return valid ? value : null;
      });
      const workCompanyId = values[3]?.user?.companyId ?? null;
      const report = buildPerformanceReport({ employees, attendance: values[0], cards: values[1], sheets: values[2], workCompanyId, month, year, employeeId, sourceStatus });
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  return server;
}
